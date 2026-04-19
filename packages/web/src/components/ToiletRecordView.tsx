import { useEffect, useState } from "react";
import type { StoolCondition, ToiletRecord } from "../../worker/domain/toilet-record";
import { createToiletRecord, deleteToiletRecord, listToiletRecords } from "../api";
import { withViewTransition } from "../view-transition";
import { ConfirmButton } from "./ConfirmButton";

type Props = {
  catId: string;
  catName: string;
  themeColor: string;
  onBack: () => void;
};

const STOOL_OPTIONS: { value: StoolCondition; label: string }[] = [
  { value: "normal", label: "普通" },
  { value: "soft", label: "軟便" },
  { value: "diarrhea", label: "下痢" },
  { value: "hard", label: "硬い" },
  { value: "bloody", label: "血便" },
];

export function ToiletRecordView({ catId, catName, themeColor, onBack }: Props) {
  const [records, setRecords] = useState<ToiletRecord[]>([]);
  const [type, setType] = useState<"urination" | "defecation">("urination");
  const [timestamp, setTimestamp] = useState(() => {
    const now = new Date();
    now.setSeconds(0, 0);
    const offset = now.getTimezoneOffset() * 60_000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 16);
  });
  const [condition, setCondition] = useState<StoolCondition>("normal");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const result = await listToiletRecords(catId);
    if (result.isErr()) {
      setError(result.error.message);
      return;
    }
    setRecords(result.value);
  }

  useEffect(() => {
    void refresh();
  }, [catId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const iso = new Date(timestamp).toISOString();
    const createResult =
      type === "urination"
        ? await createToiletRecord(catId, { type: "urination", timestamp: iso })
        : await createToiletRecord(catId, {
            type: "defecation",
            timestamp: iso,
            condition,
          });
    if (createResult.isErr()) {
      setError(createResult.error.message);
      return;
    }
    const listResult = await listToiletRecords(catId);
    if (listResult.isErr()) {
      setError(listResult.error.message);
      return;
    }
    withViewTransition(() => setRecords(listResult.value));
  }

  async function handleDelete(id: string) {
    const deleteResult = await deleteToiletRecord(catId, id);
    if (deleteResult.isErr()) {
      setError(deleteResult.error.message);
      return;
    }
    const listResult = await listToiletRecords(catId);
    if (listResult.isErr()) {
      setError(listResult.error.message);
      return;
    }
    withViewTransition(() => setRecords(listResult.value));
  }

  return (
    <section>
      <button type="button" onClick={onBack}>
        ← 戻る
      </button>

      <h2>{catName} のトイレ記録</h2>

      <form onSubmit={handleCreate}>
        <fieldset>
          <legend>種類</legend>
          <label aria-label="排尿">
            <input
              type="radio"
              name="type"
              value="urination"
              checked={type === "urination"}
              onChange={() => setType("urination")}
            />
            💧
          </label>
          <label aria-label="排便">
            <input
              type="radio"
              name="type"
              value="defecation"
              checked={type === "defecation"}
              onChange={() => setType("defecation")}
            />
            💩
          </label>
        </fieldset>

        <label>
          日時
          <input
            type="datetime-local"
            value={timestamp}
            onChange={(e) => setTimestamp(e.target.value)}
            required
          />
        </label>

        {type === "defecation" && (
          <label>
            状態
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value as StoolCondition)}
            >
              {STOOL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <button type="submit">記録</button>
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
              style={{ viewTransitionName: `record-detail-${r.id}` }}
            >
              {new Date(r.timestamp).toLocaleString()} {r.type === "urination" ? "💧" : "💩"}
              {r.type === "defecation" &&
                ` (${STOOL_OPTIONS.find((o) => o.value === r.condition)?.label})`}{" "}
              <ConfirmButton
                popoverId={`del-detail-${r.id}`}
                triggerLabel="🗑️"
                triggerAriaLabel="記録を削除"
                message="この記録を削除しますか？"
                confirmLabel="削除する"
                onConfirm={() => handleDelete(r.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
