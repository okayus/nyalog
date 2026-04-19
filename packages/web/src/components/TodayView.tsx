import { useEffect, useState } from "react";
import { THEME_COLORS, type Cat, type ThemeColor } from "../../worker/domain/cat";
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
  if (r.type === "urination") return "💧 排尿";
  return `💩 排便 (${STOOL_LABEL[r.condition]})`;
}

export function TodayView({ onOpenDetail }: Props) {
  const [cats, setCats] = useState<Cat[]>([]);
  const [recordsByCat, setRecordsByCat] = useState<Record<string, ToiletRecord[]>>({});
  const [name, setName] = useState("");
  const [birthday, setBirthday] = useState("");
  const [newThemeColor, setNewThemeColor] = useState<ThemeColor>(THEME_COLORS[0] as ThemeColor);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const loaded = await listCats();
        setCats(loaded);
        const entries = await Promise.all(
          loaded.map(async (c) => [c.id, await listToiletRecords(c.id)] as const),
        );
        setRecordsByCat(Object.fromEntries(entries));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  async function handleQuick(catId: string, type: "urination" | "defecation") {
    setError(null);
    try {
      const iso = new Date().toISOString();
      const created =
        type === "urination"
          ? await createToiletRecord(catId, { type: "urination", timestamp: iso })
          : await createToiletRecord(catId, {
              type: "defecation",
              timestamp: iso,
              condition: "normal",
            });
      withViewTransition(() => {
        setRecordsByCat((prev) => ({
          ...prev,
          [catId]: [created, ...(prev[catId] ?? [])],
        }));
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDeleteRecord(catId: string, id: string) {
    setError(null);
    try {
      await deleteToiletRecord(catId, id);
      withViewTransition(() => {
        setRecordsByCat((prev) => ({
          ...prev,
          [catId]: (prev[catId] ?? []).filter((r) => r.id !== id),
        }));
      });
    } catch (err) {
      setError((err as Error).message);
    }
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
    try {
      const updated = await updateToiletRecord(catId, r.id, {
        type: r.type,
        timestamp: newIso,
      });
      withViewTransition(() => {
        setRecordsByCat((prev) => ({
          ...prev,
          [catId]: (prev[catId] ?? []).map((x) => (x.id === r.id ? updated : x)),
        }));
        cancelEdit();
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleCreateCat(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await createCat({
        name,
        birthday: birthday || null,
        themeColor: newThemeColor,
      });
      setCats((prev) => [...prev, created]);
      setRecordsByCat((prev) => ({ ...prev, [created.id]: [] }));
      setName("");
      setBirthday("");
      setNewThemeColor(THEME_COLORS[0] as ThemeColor);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleChangeTheme(catId: string, themeColor: ThemeColor) {
    setError(null);
    try {
      const updated = await updateCat(catId, { themeColor });
      withViewTransition(() => {
        setCats((prev) => prev.map((c) => (c.id === catId ? updated : c)));
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDeleteCat(id: string) {
    setError(null);
    try {
      await deleteCat(id);
      setCats((prev) => prev.filter((c) => c.id !== id));
      setRecordsByCat((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setError((err as Error).message);
    }
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
                    編集
                  </button>
                  <ConfirmButton
                    popoverId={`del-rec-${record.id}`}
                    triggerLabel="削除"
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
                <button type="button" onClick={() => handleQuick(cat.id, "urination")}>
                  {cat.name} 💧 おしっこ
                </button>
                <button type="button" onClick={() => handleQuick(cat.id, "defecation")}>
                  {cat.name} 💩 うんち
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
                  triggerLabel="削除"
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
