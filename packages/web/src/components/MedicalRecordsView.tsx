import { useEffect, useState } from "react";
import type { MedicalRecord } from "../../worker/domain/medical-record";
import {
  createMedicalRecord,
  deleteMedicalRecord,
  listMedicalRecords,
  updateMedicalRecord,
} from "../api";
import { withViewTransition } from "../view-transition";
import { ConfirmButton } from "./ConfirmButton";

type Props = {
  catId: string;
  catName: string;
  themeColor: string;
  onBack: () => void;
};

const TYPE_OPTIONS: { value: MedicalRecord["type"]; label: string; emoji: string }[] = [
  { value: "blood_test", label: "血液検査", emoji: "🩸" },
  { value: "other", label: "その他", emoji: "📋" },
];

function typeLabel(t: MedicalRecord["type"]): string {
  return TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;
}

function typeEmoji(t: MedicalRecord["type"]): string {
  return TYPE_OPTIONS.find((o) => o.value === t)?.emoji ?? "📄";
}

function nowDateTimeLocal(): string {
  const now = new Date();
  now.setSeconds(0, 0);
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

function isoToDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  d.setSeconds(0, 0);
  const offset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

export function MedicalRecordsView({ catId, catName, themeColor, onBack }: Props) {
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [type, setType] = useState<MedicalRecord["type"]>("blood_test");
  const [recordedAt, setRecordedAt] = useState(nowDateTimeLocal);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRecordedAt, setEditRecordedAt] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");

  useEffect(() => {
    (async () => {
      const result = await listMedicalRecords(catId);
      if (result.isErr()) {
        setError(result.error.message);
        return;
      }
      setRecords(result.value);
    })();
  }, [catId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const iso = new Date(recordedAt).toISOString();
    const result = await createMedicalRecord(catId, {
      type,
      recordedAt: iso,
      title: title.trim() === "" ? null : title.trim(),
      notes: notes.trim() === "" ? null : notes.trim(),
    });
    if (result.isErr()) {
      setError(result.error.message);
      return;
    }
    const created = result.value;
    withViewTransition(() => {
      setRecords((prev) =>
        [created, ...prev].sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1)),
      );
      setTitle("");
      setNotes("");
    });
  }

  function startEdit(r: MedicalRecord) {
    setEditingId(r.id);
    setEditRecordedAt(isoToDateTimeLocal(r.recordedAt));
    setEditTitle(r.title ?? "");
    setEditNotes(r.notes ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditRecordedAt("");
    setEditTitle("");
    setEditNotes("");
  }

  async function saveEdit(r: MedicalRecord) {
    setError(null);
    const iso = new Date(editRecordedAt).toISOString();
    const result = await updateMedicalRecord(catId, r.id, {
      type: r.type,
      recordedAt: iso,
      title: editTitle.trim() === "" ? null : editTitle.trim(),
      notes: editNotes.trim() === "" ? null : editNotes.trim(),
    });
    if (result.isErr()) {
      setError(result.error.message);
      return;
    }
    const updated = result.value;
    withViewTransition(() => {
      setRecords((prev) =>
        prev
          .map((x) => (x.id === r.id ? updated : x))
          .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1)),
      );
      cancelEdit();
    });
  }

  async function handleDelete(id: string) {
    setError(null);
    const result = await deleteMedicalRecord(catId, id);
    if (result.isErr()) {
      setError(result.error.message);
      return;
    }
    withViewTransition(() => {
      setRecords((prev) => prev.filter((r) => r.id !== id));
    });
  }

  return (
    <section>
      <button type="button" onClick={onBack}>
        ← 戻る
      </button>

      <h2>{catName} の医療記録</h2>

      <form onSubmit={handleCreate}>
        <fieldset>
          <legend>種類</legend>
          {TYPE_OPTIONS.map((o) => (
            <label key={o.value} aria-label={o.label}>
              <input
                type="radio"
                name="type"
                value={o.value}
                checked={type === o.value}
                onChange={() => setType(o.value)}
              />
              {o.emoji} {o.label}
            </label>
          ))}
        </fieldset>

        <label>
          検査日
          <input
            type="datetime-local"
            value={recordedAt}
            onChange={(e) => setRecordedAt(e.target.value)}
            required
          />
        </label>

        <label>
          タイトル
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例: 春の定期健診"
            maxLength={100}
          />
        </label>

        <label>
          メモ
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="検査結果の所見など"
            maxLength={2000}
            rows={4}
          />
        </label>

        <button type="submit">追加</button>
      </form>

      {error && <p className="error-text">エラー: {error}</p>}

      {records.length === 0 ? (
        <p>記録がありません</p>
      ) : (
        <ul>
          {records.map((r) => (
            <li
              key={r.id}
              className="record-item"
              data-cat-theme={themeColor}
              style={{ viewTransitionName: `medical-${r.id}` }}
            >
              {editingId === r.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveEdit(r);
                  }}
                >
                  <label>
                    検査日
                    <input
                      type="datetime-local"
                      value={editRecordedAt}
                      onChange={(e) => setEditRecordedAt(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    タイトル
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      maxLength={100}
                    />
                  </label>
                  <label>
                    メモ
                    <textarea
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      maxLength={2000}
                      rows={4}
                    />
                  </label>
                  <button type="submit">保存</button>
                  <button type="button" onClick={cancelEdit}>
                    取消
                  </button>
                </form>
              ) : (
                <>
                  <div>
                    <time dateTime={r.recordedAt}>{new Date(r.recordedAt).toLocaleString()}</time>{" "}
                    {typeEmoji(r.type)} {typeLabel(r.type)}
                    {r.title ? `: ${r.title}` : ""}
                  </div>
                  {r.notes && <p>{r.notes}</p>}
                  <button type="button" aria-label="記録を編集" onClick={() => startEdit(r)}>
                    ✏️
                  </button>
                  <ConfirmButton
                    popoverId={`del-medical-${r.id}`}
                    triggerLabel="🗑️"
                    triggerAriaLabel="記録を削除"
                    message="この医療記録を削除しますか？"
                    confirmLabel="削除する"
                    onConfirm={() => handleDelete(r.id)}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
