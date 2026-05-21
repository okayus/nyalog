import { useEffect, useState } from "react";
import type { ThemeColor } from "../../worker/domain/cat";
import type { WeightRecord } from "../../worker/domain/weight-record";
import {
  createWeightRecord,
  deleteWeightRecord,
  listWeightRecords,
  updateWeightRecord,
} from "../api";
import { withViewTransition } from "../view-transition";
import { ConfirmButton } from "./ConfirmButton";
import { WeightChart } from "./WeightChart";

type Props = {
  catId: string;
  catName: string;
  themeColor: string;
  onBack: () => void;
};

function nowLocalForInput(): string {
  const now = new Date();
  now.setSeconds(0, 0);
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  d.setSeconds(0, 0);
  const offset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

function formatKg(grams: number): string {
  return `${(grams / 1000).toFixed(2)} kg`;
}

function kgInputToGrams(value: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000);
}

export function WeightRecordView({ catId, catName, themeColor, onBack }: Props) {
  const [records, setRecords] = useState<WeightRecord[]>([]);
  const [weightKg, setWeightKg] = useState("");
  const [measuredAt, setMeasuredAt] = useState<string>(nowLocalForInput);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingWeight, setEditingWeight] = useState("");
  const [editingMeasuredAt, setEditingMeasuredAt] = useState("");

  useEffect(() => {
    (async () => {
      const result = await listWeightRecords(catId);
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
    const grams = kgInputToGrams(weightKg);
    if (grams === null) {
      setError("体重は正の数値で入力してください");
      return;
    }
    const iso = new Date(measuredAt).toISOString();
    const createResult = await createWeightRecord(catId, {
      weightGrams: grams,
      measuredAt: iso,
    });
    if (createResult.isErr()) {
      setError(createResult.error.message);
      return;
    }
    const listResult = await listWeightRecords(catId);
    if (listResult.isErr()) {
      setError(listResult.error.message);
      return;
    }
    withViewTransition(() => {
      setRecords(listResult.value);
      setWeightKg("");
      setMeasuredAt(nowLocalForInput());
    });
  }

  async function handleDelete(id: string) {
    setError(null);
    const result = await deleteWeightRecord(catId, id);
    if (result.isErr()) {
      setError(result.error.message);
      return;
    }
    withViewTransition(() => {
      setRecords((prev) => prev.filter((r) => r.id !== id));
    });
  }

  function startEdit(r: WeightRecord) {
    setEditingId(r.id);
    setEditingWeight((r.weightGrams / 1000).toFixed(2));
    setEditingMeasuredAt(isoToLocalInput(r.measuredAt));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingWeight("");
    setEditingMeasuredAt("");
  }

  async function saveEdit(r: WeightRecord) {
    setError(null);
    const grams = kgInputToGrams(editingWeight);
    if (grams === null) {
      setError("体重は正の数値で入力してください");
      return;
    }
    const iso = new Date(editingMeasuredAt).toISOString();
    const result = await updateWeightRecord(catId, r.id, {
      weightGrams: grams,
      measuredAt: iso,
    });
    if (result.isErr()) {
      setError(result.error.message);
      return;
    }
    const listResult = await listWeightRecords(catId);
    if (listResult.isErr()) {
      setError(listResult.error.message);
      return;
    }
    withViewTransition(() => {
      setRecords(listResult.value);
      cancelEdit();
    });
  }

  return (
    <section>
      <button type="button" onClick={onBack}>
        ← 戻る
      </button>

      <h2>{catName} の体重</h2>

      <WeightChart
        data={records.map((r) => ({ measuredAt: r.measuredAt, weightGrams: r.weightGrams }))}
        themeColor={themeColor as ThemeColor}
        ariaLabel={`${catName} の体重推移`}
      />

      <form onSubmit={handleCreate}>
        <label>
          体重 (kg)
          <input
            type="number"
            step="0.01"
            min="0.1"
            max="50"
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            required
          />
        </label>
        <label>
          測定日時
          <input
            type="datetime-local"
            value={measuredAt}
            onChange={(e) => setMeasuredAt(e.target.value)}
            required
          />
        </label>
        <button type="submit">追加</button>
      </form>

      {error ? <p className="error-text">エラー: {error}</p> : null}

      {records.length === 0 ? (
        <p>記録がありません</p>
      ) : (
        <ul>
          {records.map((r) => (
            <li
              key={r.id}
              className="record-item"
              data-cat-theme={themeColor}
              style={{ viewTransitionName: `weight-${r.id}` }}
            >
              {editingId === r.id ? (
                <>
                  <label className="visually-hidden" htmlFor={`edit-w-${r.id}`}>
                    体重 (kg)
                  </label>
                  <input
                    id={`edit-w-${r.id}`}
                    type="number"
                    step="0.01"
                    min="0.1"
                    max="50"
                    value={editingWeight}
                    onChange={(e) => setEditingWeight(e.target.value)}
                  />
                  <label className="visually-hidden" htmlFor={`edit-m-${r.id}`}>
                    測定日時
                  </label>
                  <input
                    id={`edit-m-${r.id}`}
                    type="datetime-local"
                    value={editingMeasuredAt}
                    onChange={(e) => setEditingMeasuredAt(e.target.value)}
                  />
                  <button type="button" onClick={() => saveEdit(r)}>
                    保存
                  </button>
                  <button type="button" onClick={cancelEdit}>
                    取消
                  </button>
                </>
              ) : (
                <>
                  <strong>{formatKg(r.weightGrams)}</strong>
                  <time dateTime={r.measuredAt}>{new Date(r.measuredAt).toLocaleString()}</time>
                  <button type="button" aria-label="編集" onClick={() => startEdit(r)}>
                    ✏️
                  </button>
                  <ConfirmButton
                    popoverId={`del-weight-${r.id}`}
                    triggerLabel="🗑️"
                    triggerAriaLabel="記録を削除"
                    message="この記録を削除しますか？"
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
