import { useEffect, useState } from "react";
import type { StoolCondition, ToiletRecord } from "../../worker/domain/toilet-record";
import { createToiletRecord, deleteToiletRecord, listToiletRecords } from "../api";
import { withViewTransition } from "../view-transition";
import { ConfirmButton } from "./ConfirmButton";
import { ErrorText } from "./ErrorText";

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

// 1 ページぶん。本番は 1 匹で 1200 件超あるので、開いた瞬間に全部は取らない。
const PAGE_SIZE = 50;

// 一覧は timestamp の降順。作成した 1 件をその順序を保ったまま差し込む。
function insertSorted(records: ToiletRecord[], created: ToiletRecord): ToiletRecord[] {
  const i = records.findIndex((r) => r.timestamp < created.timestamp);
  return i === -1 ? [...records, created] : [...records.slice(0, i), created, ...records.slice(i)];
}

export function ToiletRecordView({ catId, catName, themeColor, onBack }: Props) {
  const [records, setRecords] = useState<ToiletRecord[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [type, setType] = useState<"urination" | "defecation">("urination");
  const [timestamp, setTimestamp] = useState(() => {
    const now = new Date();
    now.setSeconds(0, 0);
    const offset = now.getTimezoneOffset() * 60_000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 16);
  });
  const [condition, setCondition] = useState<StoolCondition>("normal");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await listToiletRecords(catId, { limit: PAGE_SIZE, offset: 0 });
      if (cancelled) return;
      if (result.isErr()) {
        setError(result.error.message);
        return;
      }
      setRecords(result.value);
      // ちょうど 1 ページぶん返ってきた時だけ「まだあるかもしれない」。
      // 総件数は数えない (COUNT のために毎回もう 1 往復する価値はない)。
      setHasMore(result.value.length === PAGE_SIZE);
    })();
    return () => {
      cancelled = true;
    };
  }, [catId]);

  async function handleLoadMore() {
    setLoadingMore(true);
    const result = await listToiletRecords(catId, { limit: PAGE_SIZE, offset: records.length });
    setLoadingMore(false);
    if (result.isErr()) {
      setError(result.error.message);
      return;
    }
    const page = result.value;
    setHasMore(page.length === PAGE_SIZE);
    withViewTransition(() => {
      setRecords((prev) => {
        // 読み込んだ後に自分で記録を足すと窓が 1 件ずれて既読が混ざる。id で弾く。
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...page.filter((r) => !seen.has(r.id))];
      });
    });
  }

  // 作成・削除の後に一覧を取り直さないのは、読み込み済みのページが 1 ページ目に
  // 巻き戻ってしまうため。返ってきた 1 件をその場で入れ／抜きする。
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
    const created = createResult.value;
    withViewTransition(() => setRecords((prev) => insertSorted(prev, created)));
  }

  async function handleDelete(id: string) {
    const deleteResult = await deleteToiletRecord(catId, id);
    if (deleteResult.isErr()) {
      setError(deleteResult.error.message);
      return;
    }
    withViewTransition(() => setRecords((prev) => prev.filter((r) => r.id !== id)));
  }

  return (
    <section>
      <button type="button" onClick={onBack}>
        ← 戻る
      </button>

      <h2 tabIndex={-1} data-view-heading>
        {catName} のトイレ記録
      </h2>

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

      {error && <ErrorText>{`エラー: ${error}`}</ErrorText>}

      {records.length === 0 ? (
        <p>記録がありません</p>
      ) : (
        <>
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
          {hasMore ? (
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              aria-busy={loadingMore}
            >
              {loadingMore ? "読み込み中…" : `もっと見る (次の ${PAGE_SIZE} 件)`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
