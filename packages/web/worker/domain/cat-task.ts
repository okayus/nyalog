import { z } from "zod";
import { ok, err, type Result } from "neverthrow";
import { CatId } from "./cat";
import { SpaceId } from "./space";

// --- Branded Types ---

export type CatTaskId = string & { readonly __brand: unique symbol };
export const CatTaskId = z
  .string()
  .uuid()
  .transform((v) => v as CatTaskId);

export type TaskCompletionId = string & { readonly __brand: unique symbol };
export const TaskCompletionId = z
  .string()
  .uuid()
  .transform((v) => v as TaskCompletionId);

// カレンダー日付 (YYYY-MM-DD)。タイムゾーン非依存に扱う前提で、UTC 0:00 として
// Date 化したものを差分計算に使う (ローカルタイムを跨いだ day shift を避ける)。
export type DateOnly = string & { readonly __brand: unique symbol };
export const DateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "DateOnly must be YYYY-MM-DD")
  // 入力文字列を Date 経由で round-trip させて実在性を検証する。
  // 単に Date.parse 成功で済ますと 2026-02-30 が 2026-03-02 に rollover してすり抜けるため。
  .refine(
    (d) => {
      const dt = new Date(`${d}T00:00:00Z`);
      return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d;
    },
    { message: "Invalid date" },
  )
  .transform((v) => v as DateOnly);

export type TaskTitle = string & { readonly __brand: unique symbol };
export const TaskTitle = z
  .string()
  .min(1)
  .max(100)
  .transform((v) => v as TaskTitle);

export type TaskNotes = string & { readonly __brand: unique symbol };
export const TaskNotes = z
  .string()
  .max(2000)
  .transform((v) => v as TaskNotes);

// 完了時刻 (ISO datetime)。toilet-record の Timestamp と同じく未来 60s まで許容。
export type CompletedAt = string & { readonly __brand: unique symbol };
export const CompletedAt = z
  .string()
  .datetime({ offset: true })
  .refine((v) => Date.parse(v) <= Date.now() + 60_000, {
    message: "completedAt must not be in the future",
  })
  .transform((v) => v as CompletedAt);

// --- Recurrence (Discriminated Union) ---
//
// daily         — 毎日
// interval_days — N 日ごと (startDate 起点で diff % N == 0 の日にだけ発火)
// interval_months — M 月ごと (startDate の day-of-month と一致しつつ月差 % M == 0)
//                   末日問題は許容: 1/31 の月次タスクは 31 日のない月では発火しない。
//                   "毎月末日" UX が必要になったら recurrence の variant を増やす
// once          — startDate 当日のみ

export const Recurrence = z.discriminatedUnion("type", [
  z.object({ type: z.literal("daily") }),
  z.object({
    type: z.literal("interval_days"),
    days: z.number().int().min(1).max(365),
  }),
  z.object({
    type: z.literal("interval_months"),
    months: z.number().int().min(1).max(60),
  }),
  z.object({ type: z.literal("once") }),
]);
export type Recurrence = z.infer<typeof Recurrence>;

const RecurrenceTypeEnum = z.enum(["daily", "interval_days", "interval_months", "once"]);
export type RecurrenceType = z.infer<typeof RecurrenceTypeEnum>;

// --- Domain Type ---

export type CatTask = {
  id: CatTaskId;
  spaceId: SpaceId;
  title: TaskTitle;
  recurrence: Recurrence;
  startDate: DateOnly;
  endDate: DateOnly | null;
  notes: TaskNotes | null;
  catIds: CatId[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskCompletion = {
  id: TaskCompletionId;
  taskId: CatTaskId;
  catId: CatId;
  dueDate: DateOnly;
  completedAt: CompletedAt;
  completedBy: string | null;
  createdAt: string;
};

// --- Error ---

export type CatTaskError =
  | { type: "validation_error"; message: string; issues: z.ZodIssue[] }
  | { type: "not_found"; id: string }
  | { type: "cat_not_found"; catId: string }
  | { type: "completion_not_found"; id: string };

// --- API Input Schemas ---

export const CreateCatTaskSchema = z
  .object({
    title: TaskTitle,
    recurrence: Recurrence,
    startDate: DateOnly,
    endDate: DateOnly.nullable().optional().default(null),
    notes: TaskNotes.nullable().optional().default(null),
    catIds: z.array(CatId).min(1, "At least one cat is required").max(50),
  })
  .refine((v) => v.endDate === null || v.endDate >= v.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  });
export type CreateCatTaskInput = z.infer<typeof CreateCatTaskSchema>;

// 更新は recurrence / startDate を変えない (履歴と due-date の整合を壊さないため)。
// 変更したい場合は新規タスクを作成し直す前提。
export const UpdateCatTaskSchema = z.object({
  title: TaskTitle.optional(),
  endDate: DateOnly.nullable().optional(),
  notes: TaskNotes.nullable().optional(),
  catIds: z.array(CatId).min(1).max(50).optional(),
});
export type UpdateCatTaskInput = z.infer<typeof UpdateCatTaskSchema>;

export const CreateCompletionSchema = z.object({
  catId: CatId,
  dueDate: DateOnly,
  // completedAt は通常 now、ただし「過去の済を後付け」もあり得るのでクライアントが送る
  completedAt: CompletedAt,
});
export type CreateCompletionInput = z.infer<typeof CreateCompletionSchema>;

// --- DB Row Schema (境界での再パース用) ---

export const CatTaskRowSchema = z
  .object({
    id: CatTaskId,
    spaceId: SpaceId,
    title: TaskTitle,
    recurrenceType: RecurrenceTypeEnum,
    recurrenceValue: z.number().int().nullable(),
    startDate: DateOnly,
    endDate: DateOnly.nullable(),
    notes: TaskNotes.nullable(),
    createdBy: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .refine(
    (row) => {
      if (row.recurrenceType === "interval_days" || row.recurrenceType === "interval_months") {
        return row.recurrenceValue !== null && row.recurrenceValue >= 1;
      }
      return true;
    },
    { message: "recurrence_value must be >=1 for interval_* recurrence" },
  );
export type CatTaskRow = z.infer<typeof CatTaskRowSchema>;

export const TaskCompletionRowSchema = z.object({
  id: TaskCompletionId,
  taskId: CatTaskId,
  catId: CatId,
  dueDate: DateOnly,
  completedAt: CompletedAt,
  completedBy: z.string().nullable(),
  createdAt: z.string(),
});

// --- Row <-> Domain conversion ---

export function rowToRecurrence(
  recurrenceType: RecurrenceType,
  recurrenceValue: number | null,
): Recurrence {
  switch (recurrenceType) {
    case "daily":
      return { type: "daily" };
    case "once":
      return { type: "once" };
    case "interval_days":
      // CatTaskRowSchema の refine で保証済み
      return { type: "interval_days", days: recurrenceValue as number };
    case "interval_months":
      return { type: "interval_months", months: recurrenceValue as number };
  }
}

export function recurrenceToColumns(recurrence: Recurrence): {
  recurrenceType: RecurrenceType;
  recurrenceValue: number | null;
} {
  switch (recurrence.type) {
    case "daily":
      return { recurrenceType: "daily", recurrenceValue: null };
    case "once":
      return { recurrenceType: "once", recurrenceValue: null };
    case "interval_days":
      return { recurrenceType: "interval_days", recurrenceValue: recurrence.days };
    case "interval_months":
      return { recurrenceType: "interval_months", recurrenceValue: recurrence.months };
  }
}

// --- Pure Validation Functions ---

export function parseCatTaskId(input: string): Result<CatTaskId, CatTaskError> {
  const r = CatTaskId.safeParse(input);
  if (!r.success) {
    return err({ type: "validation_error", message: "Invalid task ID", issues: r.error.issues });
  }
  return ok(r.data);
}

export function parseTaskCompletionId(input: string): Result<TaskCompletionId, CatTaskError> {
  const r = TaskCompletionId.safeParse(input);
  if (!r.success) {
    return err({
      type: "validation_error",
      message: "Invalid completion ID",
      issues: r.error.issues,
    });
  }
  return ok(r.data);
}

export function parseDateOnly(input: string): Result<DateOnly, CatTaskError> {
  const r = DateOnly.safeParse(input);
  if (!r.success) {
    return err({ type: "validation_error", message: "Invalid date", issues: r.error.issues });
  }
  return ok(r.data);
}

export function parseCreateCatTask(input: unknown): Result<CreateCatTaskInput, CatTaskError> {
  const r = CreateCatTaskSchema.safeParse(input);
  if (!r.success) {
    return err({ type: "validation_error", message: "Invalid task data", issues: r.error.issues });
  }
  return ok(r.data);
}

export function parseUpdateCatTask(input: unknown): Result<UpdateCatTaskInput, CatTaskError> {
  const r = UpdateCatTaskSchema.safeParse(input);
  if (!r.success) {
    return err({ type: "validation_error", message: "Invalid task data", issues: r.error.issues });
  }
  return ok(r.data);
}

export function parseCreateCompletion(input: unknown): Result<CreateCompletionInput, CatTaskError> {
  const r = CreateCompletionSchema.safeParse(input);
  if (!r.success) {
    return err({
      type: "validation_error",
      message: "Invalid completion data",
      issues: r.error.issues,
    });
  }
  return ok(r.data);
}

// --- Pure Scheduling Logic ---

function dateOnlyToUtcEpoch(d: DateOnly): number {
  return Date.parse(`${d}T00:00:00Z`);
}

function dayDiff(a: DateOnly, b: DateOnly): number {
  const ms = dateOnlyToUtcEpoch(a) - dateOnlyToUtcEpoch(b);
  return Math.round(ms / 86_400_000);
}

function inRange(date: DateOnly, start: DateOnly, end: DateOnly | null): boolean {
  if (date < start) return false;
  if (end !== null && date > end) return false;
  return true;
}

export type TaskSchedule = {
  recurrence: Recurrence;
  startDate: DateOnly;
  endDate: DateOnly | null;
};

export function isDueOn(task: TaskSchedule, date: DateOnly): boolean {
  if (!inRange(date, task.startDate, task.endDate)) return false;
  switch (task.recurrence.type) {
    case "daily":
      return true;
    case "once":
      return date === task.startDate;
    case "interval_days": {
      const diff = dayDiff(date, task.startDate);
      return diff >= 0 && diff % task.recurrence.days === 0;
    }
    case "interval_months": {
      // 同 day-of-month + 月差 % M == 0。
      // 1/31 のタスクは 31 日のない月では発火しない (許容仕様)。
      const [sy, sm, sd] = task.startDate.split("-").map(Number);
      const [dy, dm, dd] = date.split("-").map(Number);
      if (sd !== dd) return false;
      const monthDiff = (dy - sy) * 12 + (dm - sm);
      return monthDiff >= 0 && monthDiff % task.recurrence.months === 0;
    }
  }
}

// from..to の閉区間 (両端含む) を 1 日ずつ走査して due-date を抽出。
// 月カレンダー 1 画面で高々 ~31 日なのでループのコストは無視できる。
export function enumerateDueDates(
  task: TaskSchedule,
  range: { from: DateOnly; to: DateOnly },
): DateOnly[] {
  const fromMs = dateOnlyToUtcEpoch(range.from);
  const toMs = dateOnlyToUtcEpoch(range.to);
  if (fromMs > toMs) return [];
  const result: DateOnly[] = [];
  for (let t = fromMs; t <= toMs; t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10) as DateOnly;
    if (isDueOn(task, d)) result.push(d);
  }
  return result;
}
