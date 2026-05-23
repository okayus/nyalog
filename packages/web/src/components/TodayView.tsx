import { useEffect, useState } from "react";
import { DEFAULT_THEME_COLOR, type Cat, type ThemeColor } from "../../worker/domain/cat";
import type { Recurrence } from "../../worker/domain/cat-task";
import type { StoolCondition, ToiletRecord } from "../../worker/domain/toilet-record";
import type { WeightRecord } from "../../worker/domain/weight-record";
import {
  type TodayTaskItem,
  completeTask,
  createCat,
  createToiletRecord,
  deleteCat,
  deleteToiletRecord,
  listCats,
  listTodayTasks,
  listToiletRecords,
  listWeightRecords,
  uncompleteTask,
  updateCat,
  updateToiletRecord,
} from "../api";
import { withViewTransition } from "../view-transition";
import { ConfirmButton } from "./ConfirmButton";
import { ThemeSwatchGroup } from "./ThemeSwatchGroup";

type Props = {
  onOpenDetail: (cat: Cat) => void;
  onOpenMedical: (cat: Cat) => void;
  onOpenWeight: (cat: Cat) => void;
  onOpenTasks: () => void;
};

type WeightSummary = {
  latest: WeightRecord | null;
  diffGrams: number | null;
};

function summarizeWeights(records: WeightRecord[]): WeightSummary {
  if (records.length === 0) return { latest: null, diffGrams: null };
  const sorted = [...records].sort((a, b) => (a.measuredAt < b.measuredAt ? 1 : -1));
  const latest = sorted[0];
  const previous = sorted[1];
  const diffGrams = previous ? latest.weightGrams - previous.weightGrams : null;
  return { latest, diffGrams };
}

function formatKg(grams: number): string {
  return `${(grams / 1000).toFixed(2)} kg`;
}

function formatDiff(grams: number): string {
  const kg = grams / 1000;
  if (Math.abs(kg) < 0.005) return "±0.00 kg";
  return `${kg >= 0 ? "+" : ""}${kg.toFixed(2)} kg`;
}

const STOOL_LABEL: Record<StoolCondition, string> = {
  normal: "普通",
  soft: "軟便",
  diarrhea: "下痢",
  hard: "硬い",
  bloody: "血便",
};

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function toHHMM(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function replaceHHMM(iso: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(iso);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

function typeLabel(r: ToiletRecord): string {
  if (r.type === "urination") return "💧";
  return `💩 (${STOOL_LABEL[r.condition]})`;
}

function todayDateOnly(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function recurrenceLabel(r: Recurrence): string {
  switch (r.type) {
    case "daily":
      return "毎日";
    case "interval_days":
      return `${r.days}日ごと`;
    case "interval_months":
      return `${r.months}か月ごと`;
    case "once":
      return "1回";
  }
}

type GroupedTodayTask = {
  taskId: string;
  title: string;
  recurrence: Recurrence;
  notes: string | null;
  items: TodayTaskItem[];
};

function groupByTask(items: TodayTaskItem[]): GroupedTodayTask[] {
  const map = new Map<string, GroupedTodayTask>();
  for (const item of items) {
    const existing = map.get(item.task.id);
    if (existing) {
      existing.items.push(item);
    } else {
      map.set(item.task.id, {
        taskId: item.task.id,
        title: item.task.title,
        recurrence: item.task.recurrence,
        notes: item.task.notes,
        items: [item],
      });
    }
  }
  return [...map.values()];
}

export function TodayView({ onOpenDetail, onOpenMedical, onOpenWeight, onOpenTasks }: Props) {
  const [cats, setCats] = useState<Cat[]>([]);
  const [recordsByCat, setRecordsByCat] = useState<Record<string, ToiletRecord[]>>({});
  const [weightsByCat, setWeightsByCat] = useState<Record<string, WeightSummary>>({});
  const [todayTasks, setTodayTasks] = useState<TodayTaskItem[]>([]);
  const [name, setName] = useState("");
  const [birthday, setBirthday] = useState("");
  const [newThemeColor, setNewThemeColor] = useState<ThemeColor>(DEFAULT_THEME_COLOR);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  useEffect(() => {
    (async () => {
      const catsResult = await listCats();
      if (catsResult.isErr()) {
        setError(catsResult.error.message);
        return;
      }
      const loaded = catsResult.value;
      setCats(loaded);
      const [recordResults, weightResults, tasksResult] = await Promise.all([
        Promise.all(loaded.map(async (c) => ({ id: c.id, result: await listToiletRecords(c.id) }))),
        Promise.all(loaded.map(async (c) => ({ id: c.id, result: await listWeightRecords(c.id) }))),
        listTodayTasks(todayDateOnly()),
      ]);
      const recordMap: Record<string, ToiletRecord[]> = {};
      for (const { id, result } of recordResults) {
        if (result.isErr()) {
          setError(result.error.message);
          return;
        }
        recordMap[id] = result.value;
      }
      const weightMap: Record<string, WeightSummary> = {};
      for (const { id, result } of weightResults) {
        if (result.isErr()) {
          setError(result.error.message);
          return;
        }
        weightMap[id] = summarizeWeights(result.value);
      }
      setRecordsByCat(recordMap);
      setWeightsByCat(weightMap);
      if (tasksResult.isErr()) {
        setError(tasksResult.error.message);
        return;
      }
      setTodayTasks(tasksResult.value);
    })();
  }, []);

  async function handleToggleTaskCheck(item: TodayTaskItem) {
    setError(null);
    if (item.completion === null) {
      const completedAt = new Date().toISOString();
      const result = await completeTask(item.task.id, {
        catId: item.cat.id,
        dueDate: item.dueDate,
        completedAt,
      });
      if (result.isErr()) {
        setError(result.error.message);
        return;
      }
      const created = result.value;
      withViewTransition(() => {
        setTodayTasks((prev) =>
          prev.map((it) =>
            it.task.id === item.task.id && it.cat.id === item.cat.id
              ? {
                  ...it,
                  completion: {
                    id: created.id,
                    taskId: created.taskId,
                    catId: created.catId,
                    dueDate: created.dueDate,
                    completedAt: created.completedAt,
                    completedBy: created.completedBy,
                    createdAt: created.createdAt,
                  },
                }
              : it,
          ),
        );
      });
      return;
    }
    const completionId = item.completion.id;
    const result = await uncompleteTask(item.task.id, completionId);
    if (result.isErr()) {
      setError(result.error.message);
      return;
    }
    withViewTransition(() => {
      setTodayTasks((prev) =>
        prev.map((it) =>
          it.task.id === item.task.id && it.cat.id === item.cat.id
            ? { ...it, completion: null }
            : it,
        ),
      );
    });
  }

  async function handleQuick(catId: string, type: "urination" | "defecation") {
    setError(null);
    const iso = new Date().toISOString();
    const result =
      type === "urination"
        ? await createToiletRecord(catId, { type: "urination", timestamp: iso })
        : await createToiletRecord(catId, {
            type: "defecation",
            timestamp: iso,
            condition: "normal",
          });
    if (result.isErr()) {
      setError(result.error.message);
      return;
    }
    const created = result.value;
    withViewTransition(() => {
      setRecordsByCat((prev) => ({
        ...prev,
        [catId]: [created, ...(prev[catId] ?? [])],
      }));
    });
  }

  async function handleDeleteRecord(catId: string, id: string) {
    setError(null);
    const result = await deleteToiletRecord(catId, id);
    if (result.isErr()) {
      setError(result.error.message);
      return;
    }
    withViewTransition(() => {
      setRecordsByCat((prev) => ({
        ...prev,
        [catId]: (prev[catId] ?? []).filter((r) => r.id !== id),
      }));
    });
  }

  function startEdit(r: ToiletRecord) {
    setEditingId(r.id);
    setEditingValue(toHHMM(r.timestamp));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingValue("");
  }

  async function saveEdit(catId: string, r: ToiletRecord) {
    if (!/^\d{2}:\d{2}$/.test(editingValue)) {
      cancelEdit();
      return;
    }
    const newIso = replaceHHMM(r.timestamp, editingValue);
    setError(null);
    const result = await updateToiletRecord(catId, r.id, {
      type: r.type,
      timestamp: newIso,
    });
    if (result.isErr()) {
      setError(result.error.message);
      return;
    }
    const updated = result.value;
    withViewTransition(() => {
      setRecordsByCat((prev) => ({
        ...prev,
        [catId]: (prev[catId] ?? []).map((x) => (x.id === r.id ? updated : x)),
      }));
      cancelEdit();
    });
  }

  async function handleCreateCat(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const result = await createCat({
      name,
      birthday: birthday || null,
      themeColor: newThemeColor,
    });
    if (result.isErr()) {
      setError(result.error.message);
      return;
    }
    const created = result.value;
    setCats((prev) => [...prev, created]);
    setRecordsByCat((prev) => ({ ...prev, [created.id]: [] }));
    setWeightsByCat((prev) => ({ ...prev, [created.id]: { latest: null, diffGrams: null } }));
    setName("");
    setBirthday("");
    setNewThemeColor(DEFAULT_THEME_COLOR);
  }

  async function handleChangeTheme(catId: string, themeColor: ThemeColor) {
    setError(null);
    const result = await updateCat(catId, { themeColor });
    if (result.isErr()) {
      setError(result.error.message);
      return;
    }
    const updated = result.value;
    withViewTransition(() => {
      setCats((prev) => prev.map((c) => (c.id === catId ? updated : c)));
    });
  }

  async function handleDeleteCat(id: string) {
    setError(null);
    const result = await deleteCat(id);
    if (result.isErr()) {
      setError(result.error.message);
      return;
    }
    setCats((prev) => prev.filter((c) => c.id !== id));
    setRecordsByCat((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setWeightsByCat((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  const startMs = startOfTodayMs();
  const todayItems = cats
    .flatMap((c) =>
      (recordsByCat[c.id] ?? [])
        .filter((r) => new Date(r.timestamp).getTime() >= startMs)
        .map((r) => ({ cat: c, record: r })),
    )
    .sort((a, b) => (a.record.timestamp < b.record.timestamp ? 1 : -1));

  const groupedTodayTasks = groupByTask(todayTasks);

  return (
    <section>
      <header className="section-header">
        <h2>今日のタスク</h2>
        <button type="button" className="link-button" onClick={onOpenTasks}>
          タスク管理 →
        </button>
      </header>

      {error ? <p className="error-text">エラー: {error}</p> : null}

      {groupedTodayTasks.length === 0 ? (
        <p>今日のタスクはありません</p>
      ) : (
        <ul className="task-today-list">
          {groupedTodayTasks.map((group) => (
            <li key={group.taskId} className="task-card">
              <div className="task-card-header">
                <strong>{group.title}</strong>
                <small>{recurrenceLabel(group.recurrence)}</small>
              </div>
              {group.notes ? <p className="task-card-notes">{group.notes}</p> : null}
              <ul className="task-cat-rows">
                {group.items.map((item) => {
                  const completed = item.completion !== null;
                  return (
                    <li
                      key={`${item.task.id}-${item.cat.id}`}
                      className="task-cat-row"
                      data-cat-theme={item.cat.themeColor}
                      data-completed={completed ? "true" : "false"}
                    >
                      <label>
                        <input
                          type="checkbox"
                          checked={completed}
                          onChange={() => handleToggleTaskCheck(item)}
                        />
                        <span>{item.cat.name}</span>
                      </label>
                      {item.completion ? (
                        <small>済 {toHHMM(item.completion.completedAt)}</small>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <h2>今日のトイレ記録</h2>

      {todayItems.length === 0 ? (
        <p>今日の記録はまだありません</p>
      ) : (
        <ul>
          {todayItems.map(({ cat, record }) => (
            <li
              key={record.id}
              className="record-item"
              data-cat-theme={cat.themeColor}
              style={{ viewTransitionName: `record-${record.id}` }}
            >
              <strong>{cat.name}</strong>
              <span>{typeLabel(record)}</span>
              {editingId === record.id ? (
                <>
                  <label className="visually-hidden" htmlFor={`time-${record.id}`}>
                    時刻
                  </label>
                  <input
                    id={`time-${record.id}`}
                    type="time"
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                  />
                  <button type="button" onClick={() => saveEdit(cat.id, record)}>
                    保存
                  </button>
                  <button type="button" onClick={cancelEdit}>
                    取消
                  </button>
                </>
              ) : (
                <>
                  <time dateTime={record.timestamp}>{toHHMM(record.timestamp)}</time>
                  <button type="button" aria-label="時刻を編集" onClick={() => startEdit(record)}>
                    ✏️
                  </button>
                  <ConfirmButton
                    popoverId={`del-rec-${record.id}`}
                    triggerLabel="🗑️"
                    triggerAriaLabel="記録を削除"
                    message="この記録を削除しますか？"
                    confirmLabel="削除する"
                    onConfirm={() => handleDeleteRecord(cat.id, record.id)}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2>クイック記録</h2>
      {cats.length === 0 ? (
        <p>先に猫を登録してください</p>
      ) : (
        <div className="quick-grid">
          {cats.map((cat) => {
            const summary = weightsByCat[cat.id];
            return (
              <div key={cat.id} className="quick-cell" data-cat-theme={cat.themeColor}>
                <div className="weight-summary">
                  {summary?.latest ? (
                    <>
                      <span aria-hidden="true">⚖️</span>
                      <strong>{formatKg(summary.latest.weightGrams)}</strong>
                      {summary.diffGrams !== null ? (
                        <small className="weight-diff">({formatDiff(summary.diffGrams)})</small>
                      ) : null}
                    </>
                  ) : (
                    <small>⚖️ 体重 未記録</small>
                  )}
                </div>
                <div className="quick-cell-actions">
                  <button
                    type="button"
                    aria-label={`${cat.name} の排尿を記録`}
                    onClick={() => handleQuick(cat.id, "urination")}
                  >
                    {cat.name} 💧
                  </button>
                  <button
                    type="button"
                    aria-label={`${cat.name} の排便を記録`}
                    onClick={() => handleQuick(cat.id, "defecation")}
                  >
                    {cat.name} 💩
                  </button>
                </div>
                <button type="button" className="link-button" onClick={() => onOpenDetail(cat)}>
                  詳細記録 →
                </button>
                <button type="button" className="link-button" onClick={() => onOpenMedical(cat)}>
                  医療記録 →
                </button>
                <button type="button" className="link-button" onClick={() => onOpenWeight(cat)}>
                  体重 →
                </button>
              </div>
            );
          })}
        </div>
      )}

      <details className="cat-manager">
        <summary>
          <h2>猫の管理</h2>
        </summary>
        <form onSubmit={handleCreateCat}>
          <label>
            名前
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            誕生日
            <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
          </label>
          <ThemeSwatchGroup
            legend="テーマカラー"
            value={newThemeColor}
            onChange={setNewThemeColor}
          />
          <button type="submit">追加</button>
        </form>
        {cats.length > 0 ? (
          <ul className="cat-list">
            {cats.map((cat) => (
              <li key={cat.id} data-cat-theme={cat.themeColor}>
                <strong>{cat.name}</strong>
                {cat.birthday ? <span>({cat.birthday})</span> : null}
                <ConfirmButton
                  popoverId={`del-cat-${cat.id}`}
                  triggerLabel="🗑️"
                  triggerAriaLabel={`${cat.name} を削除`}
                  message={`${cat.name} を削除しますか？ 紐づくトイレ記録と医療記録も消えます。`}
                  confirmLabel="削除する"
                  onConfirm={() => handleDeleteCat(cat.id)}
                />
                <ThemeSwatchGroup
                  legend={`${cat.name} のテーマカラー`}
                  hideLegend
                  value={cat.themeColor}
                  onChange={(tc) => handleChangeTheme(cat.id, tc)}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </details>
    </section>
  );
}
