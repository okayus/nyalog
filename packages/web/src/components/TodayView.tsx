import { useEffect, useState } from "react";
import { DEFAULT_THEME_COLOR, type Cat, type ThemeColor } from "../../worker/domain/cat";
import type { StoolCondition, ToiletRecord } from "../../worker/domain/toilet-record";
import {
  createCat,
  createToiletRecord,
  deleteCat,
  deleteToiletRecord,
  listCats,
  listToiletRecords,
  updateCat,
  updateToiletRecord,
} from "../api";
import { withViewTransition } from "../view-transition";
import { ConfirmButton } from "./ConfirmButton";
import { ThemeSwatchGroup } from "./ThemeSwatchGroup";

type Props = {
  onOpenDetail: (cat: Cat) => void;
};

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

export function TodayView({ onOpenDetail }: Props) {
  const [cats, setCats] = useState<Cat[]>([]);
  const [recordsByCat, setRecordsByCat] = useState<Record<string, ToiletRecord[]>>({});
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
      const recordResults = await Promise.all(
        loaded.map(async (c) => ({ id: c.id, result: await listToiletRecords(c.id) })),
      );
      const map: Record<string, ToiletRecord[]> = {};
      for (const { id, result } of recordResults) {
        if (result.isErr()) {
          setError(result.error.message);
          return;
        }
        map[id] = result.value;
      }
      setRecordsByCat(map);
    })();
  }, []);

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
  }

  const startMs = startOfTodayMs();
  const todayItems = cats
    .flatMap((c) =>
      (recordsByCat[c.id] ?? [])
        .filter((r) => new Date(r.timestamp).getTime() >= startMs)
        .map((r) => ({ cat: c, record: r })),
    )
    .sort((a, b) => (a.record.timestamp < b.record.timestamp ? 1 : -1));

  return (
    <section>
      <h2>今日のトイレ記録</h2>

      {error ? <p className="error-text">エラー: {error}</p> : null}

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
          {cats.map((cat) => (
            <div key={cat.id} className="quick-cell" data-cat-theme={cat.themeColor}>
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
            </div>
          ))}
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
                  message={`${cat.name} を削除しますか？ 紐づくトイレ記録も消えます。`}
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
