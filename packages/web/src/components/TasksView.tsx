import { useEffect, useState } from "react";
import type { Cat } from "../../worker/domain/cat";
import type { Recurrence } from "../../worker/domain/cat-task";
import { type CatTask, createTask, deleteTask, listCats, listTasks, updateTask } from "../api";
import { withViewTransition } from "../view-transition";
import { ConfirmButton } from "./ConfirmButton";
import { ErrorText } from "./ErrorText";

type Props = { onBack: () => void };

type RecurrenceKind = "daily" | "interval_days" | "interval_months" | "once";

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

function todayDateOnly(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildRecurrence(kind: RecurrenceKind, value: number): Recurrence {
  switch (kind) {
    case "daily":
      return { type: "daily" };
    case "once":
      return { type: "once" };
    case "interval_days":
      return { type: "interval_days", days: value };
    case "interval_months":
      return { type: "interval_months", months: value };
  }
}

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function TasksView({ onBack }: Props) {
  const [tasks, setTasks] = useState<CatTask[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<RecurrenceKind>("daily");
  const [recurrenceValue, setRecurrenceValue] = useState(1);
  const [startDate, setStartDate] = useState(todayDateOnly());
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedCatIds, setSelectedCatIds] = useState<string[]>([]);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editCatIds, setEditCatIds] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const [tasksResult, catsResult] = await Promise.all([listTasks(), listCats()]);
      if (catsResult.isErr()) {
        setError(catsResult.error.message);
        return;
      }
      setCats(catsResult.value);
      if (tasksResult.isErr()) {
        setError(tasksResult.error.message);
        return;
      }
      setTasks(tasksResult.value);
    })();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (selectedCatIds.length === 0) {
      setError("対象の猫を1匹以上選択してください");
      return;
    }
    const result = await createTask({
      title,
      recurrence: buildRecurrence(kind, recurrenceValue),
      startDate,
      endDate: endDate || null,
      notes: notes || null,
      catIds: selectedCatIds,
    });
    if (result.isErr()) {
      setError(result.error.message);
      return;
    }
    const created = result.value;
    withViewTransition(() => {
      setTasks((prev) => [created, ...prev]);
    });
    setTitle("");
    setKind("daily");
    setRecurrenceValue(1);
    setStartDate(todayDateOnly());
    setEndDate("");
    setNotes("");
    setSelectedCatIds([]);
  }

  function startEdit(task: CatTask) {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditEndDate(task.endDate ?? "");
    setEditNotes(task.notes ?? "");
    setEditCatIds([...task.catIds]);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function handleSaveEdit(e: React.FormEvent, id: string) {
    e.preventDefault();
    setError(null);
    if (editCatIds.length === 0) {
      setError("対象の猫を1匹以上選択してください");
      return;
    }
    const result = await updateTask(id, {
      title: editTitle,
      endDate: editEndDate || null,
      notes: editNotes || null,
      catIds: editCatIds,
    });
    if (result.isErr()) {
      setError(result.error.message);
      return;
    }
    const updated = result.value;
    withViewTransition(() => {
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
      cancelEdit();
    });
  }

  async function handleDelete(id: string) {
    setError(null);
    const result = await deleteTask(id);
    if (result.isErr()) {
      setError(result.error.message);
      return;
    }
    withViewTransition(() => {
      setTasks((prev) => prev.filter((t) => t.id !== id));
    });
  }

  const catName = (id: string) => cats.find((c) => c.id === id)?.name ?? id;

  return (
    <section>
      <header className="section-header">
        <h2 tabIndex={-1} data-view-heading>
          タスク管理
        </h2>
        <button type="button" className="link-button" onClick={onBack}>
          ← 戻る
        </button>
      </header>

      {error ? <ErrorText>{`エラー: ${error}`}</ErrorText> : null}

      <h3>新規タスク</h3>
      <form onSubmit={handleCreate} className="task-form">
        <label>
          タイトル
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={100}
          />
        </label>

        <fieldset>
          <legend>繰り返し</legend>
          <label>
            <input
              type="radio"
              name="recurrence-kind"
              value="daily"
              checked={kind === "daily"}
              onChange={() => setKind("daily")}
            />
            毎日
          </label>
          <label>
            <input
              type="radio"
              name="recurrence-kind"
              value="interval_days"
              checked={kind === "interval_days"}
              onChange={() => setKind("interval_days")}
            />
            N日ごと
          </label>
          <label>
            <input
              type="radio"
              name="recurrence-kind"
              value="interval_months"
              checked={kind === "interval_months"}
              onChange={() => setKind("interval_months")}
            />
            Nか月ごと
          </label>
          <label>
            <input
              type="radio"
              name="recurrence-kind"
              value="once"
              checked={kind === "once"}
              onChange={() => setKind("once")}
            />
            1回だけ
          </label>
          {kind === "interval_days" || kind === "interval_months" ? (
            <label>
              N
              <input
                type="number"
                min={1}
                max={kind === "interval_days" ? 365 : 60}
                value={recurrenceValue}
                onChange={(e) => setRecurrenceValue(Number(e.target.value))}
                required
              />
            </label>
          ) : null}
        </fieldset>

        <label>
          開始日
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </label>
        <label>
          終了日 (任意)
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>

        <fieldset>
          <legend>対象の猫</legend>
          {cats.length === 0 ? (
            <small>先に猫を登録してください</small>
          ) : (
            cats.map((c) => (
              <label key={c.id} data-cat-theme={c.themeColor}>
                <input
                  type="checkbox"
                  checked={selectedCatIds.includes(c.id)}
                  onChange={() => setSelectedCatIds((prev) => toggleId(prev, c.id))}
                />
                {c.name}
              </label>
            ))
          )}
        </fieldset>

        <label>
          メモ (任意)
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={2000}
          />
        </label>

        <button type="submit">追加</button>
      </form>

      <h3>登録済みタスク</h3>
      {tasks.length === 0 ? (
        <p>タスクはまだありません</p>
      ) : (
        <ul className="task-list">
          {tasks.map((task) => (
            <li key={task.id} className="task-card">
              {editingId === task.id ? (
                <form onSubmit={(e) => handleSaveEdit(e, task.id)} className="task-form">
                  <label>
                    タイトル
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      required
                      maxLength={100}
                    />
                  </label>
                  <label>
                    終了日 (任意)
                    <input
                      type="date"
                      value={editEndDate}
                      onChange={(e) => setEditEndDate(e.target.value)}
                    />
                  </label>
                  <fieldset>
                    <legend>対象の猫</legend>
                    {cats.map((c) => (
                      <label key={c.id} data-cat-theme={c.themeColor}>
                        <input
                          type="checkbox"
                          checked={editCatIds.includes(c.id)}
                          onChange={() => setEditCatIds((prev) => toggleId(prev, c.id))}
                        />
                        {c.name}
                      </label>
                    ))}
                  </fieldset>
                  <label>
                    メモ (任意)
                    <textarea
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      rows={2}
                      maxLength={2000}
                    />
                  </label>
                  <button type="submit">保存</button>
                  <button type="button" onClick={cancelEdit}>
                    取消
                  </button>
                </form>
              ) : (
                <>
                  <div className="task-card-header">
                    <strong>{task.title}</strong>
                    <small>
                      {recurrenceLabel(task.recurrence)} ・ 開始 {task.startDate}
                      {task.endDate ? ` 〜 ${task.endDate}` : ""}
                    </small>
                  </div>
                  <small>対象: {task.catIds.map(catName).join(" / ")}</small>
                  {task.notes ? <p className="task-card-notes">{task.notes}</p> : null}
                  <div className="task-card-actions">
                    <button type="button" aria-label="編集" onClick={() => startEdit(task)}>
                      ✏️
                    </button>
                    <ConfirmButton
                      popoverId={`del-task-${task.id}`}
                      triggerLabel="🗑️"
                      triggerAriaLabel="タスクを削除"
                      message="このタスクを削除しますか？ 完了履歴も消えます。"
                      confirmLabel="削除する"
                      onConfirm={() => handleDelete(task.id)}
                    />
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
