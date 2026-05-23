import { describe, expect, test } from "vitest";
import {
  type DateOnly,
  enumerateDueDates,
  isDueOn,
  parseCreateCatTask,
  parseUpdateCatTask,
  parseCreateCompletion,
  parseDateOnly,
  parseCatTaskId,
  recurrenceToColumns,
  rowToRecurrence,
} from "../cat-task";

// 型は branded だがテスト内では文字列リテラルから `as DateOnly` で生成して読みやすさ優先。
const d = (s: string): DateOnly => s as DateOnly;

const CAT_A = "550e8400-e29b-41d4-a716-446655440001";
const CAT_B = "550e8400-e29b-41d4-a716-446655440002";

describe("isDueOn — daily", () => {
  const task = {
    recurrence: { type: "daily" as const },
    startDate: d("2026-05-01"),
    endDate: null,
  };

  test("開始日 = due", () => {
    expect(isDueOn(task, d("2026-05-01"))).toBe(true);
  });

  test("開始日より前 = not due", () => {
    expect(isDueOn(task, d("2026-04-30"))).toBe(false);
  });

  test("開始日より後の任意日 = due", () => {
    expect(isDueOn(task, d("2026-12-31"))).toBe(true);
  });

  test("endDate を過ぎたら not due", () => {
    const ended = { ...task, endDate: d("2026-05-10") };
    expect(isDueOn(ended, d("2026-05-10"))).toBe(true);
    expect(isDueOn(ended, d("2026-05-11"))).toBe(false);
  });
});

describe("isDueOn — interval_days", () => {
  const task = {
    recurrence: { type: "interval_days" as const, days: 3 },
    startDate: d("2026-05-01"),
    endDate: null,
  };

  test("開始日 (diff 0) = due", () => {
    expect(isDueOn(task, d("2026-05-01"))).toBe(true);
  });

  test("diff 3 = due", () => {
    expect(isDueOn(task, d("2026-05-04"))).toBe(true);
  });

  test("diff 1 = not due", () => {
    expect(isDueOn(task, d("2026-05-02"))).toBe(false);
  });

  test("diff 9 (3 の倍数) = due", () => {
    expect(isDueOn(task, d("2026-05-10"))).toBe(true);
  });

  test("月跨ぎ diff 30 = due (3 で割れる)", () => {
    expect(isDueOn(task, d("2026-05-31"))).toBe(true);
  });

  test("開始日より前 = not due (負の diff)", () => {
    expect(isDueOn(task, d("2026-04-28"))).toBe(false);
  });
});

describe("isDueOn — interval_months", () => {
  const task = {
    recurrence: { type: "interval_months" as const, months: 1 },
    startDate: d("2026-05-15"),
    endDate: null,
  };

  test("開始日 = due", () => {
    expect(isDueOn(task, d("2026-05-15"))).toBe(true);
  });

  test("翌月同日 = due", () => {
    expect(isDueOn(task, d("2026-06-15"))).toBe(true);
  });

  test("翌月別日 = not due", () => {
    expect(isDueOn(task, d("2026-06-16"))).toBe(false);
  });

  test("3 ヶ月毎タスクの 2 ヶ月後 = not due", () => {
    const q = { ...task, recurrence: { type: "interval_months" as const, months: 3 } };
    expect(isDueOn(q, d("2026-07-15"))).toBe(false);
    expect(isDueOn(q, d("2026-08-15"))).toBe(true);
  });

  test("1/31 のタスクは 2 月には発火しない (末日問題は許容仕様)", () => {
    const jan31 = {
      recurrence: { type: "interval_months" as const, months: 1 },
      startDate: d("2026-01-31"),
      endDate: null,
    };
    expect(isDueOn(jan31, d("2026-02-28"))).toBe(false);
    expect(isDueOn(jan31, d("2026-03-31"))).toBe(true);
  });

  test("年跨ぎ 12 ヶ月毎", () => {
    const yearly = {
      recurrence: { type: "interval_months" as const, months: 12 },
      startDate: d("2026-05-15"),
      endDate: null,
    };
    expect(isDueOn(yearly, d("2027-05-15"))).toBe(true);
    expect(isDueOn(yearly, d("2027-06-15"))).toBe(false);
  });
});

describe("isDueOn — once", () => {
  const task = {
    recurrence: { type: "once" as const },
    startDate: d("2026-05-15"),
    endDate: null,
  };

  test("当日のみ due", () => {
    expect(isDueOn(task, d("2026-05-15"))).toBe(true);
    expect(isDueOn(task, d("2026-05-14"))).toBe(false);
    expect(isDueOn(task, d("2026-05-16"))).toBe(false);
  });
});

describe("enumerateDueDates", () => {
  test("daily で 7 日分 = 7 dates", () => {
    const dates = enumerateDueDates(
      { recurrence: { type: "daily" }, startDate: d("2026-05-01"), endDate: null },
      { from: d("2026-05-01"), to: d("2026-05-07") },
    );
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe("2026-05-01");
    expect(dates[6]).toBe("2026-05-07");
  });

  test("interval_days(3) で 5/1〜5/10 = 4 dates (1, 4, 7, 10)", () => {
    const dates = enumerateDueDates(
      {
        recurrence: { type: "interval_days", days: 3 },
        startDate: d("2026-05-01"),
        endDate: null,
      },
      { from: d("2026-05-01"), to: d("2026-05-10") },
    );
    expect(dates).toEqual(["2026-05-01", "2026-05-04", "2026-05-07", "2026-05-10"]);
  });

  test("range が開始日より前から始まる場合、開始日以降のみ列挙", () => {
    const dates = enumerateDueDates(
      { recurrence: { type: "daily" }, startDate: d("2026-05-05"), endDate: null },
      { from: d("2026-05-01"), to: d("2026-05-07") },
    );
    expect(dates).toEqual(["2026-05-05", "2026-05-06", "2026-05-07"]);
  });

  test("from > to なら空配列", () => {
    const dates = enumerateDueDates(
      { recurrence: { type: "daily" }, startDate: d("2026-05-01"), endDate: null },
      { from: d("2026-05-10"), to: d("2026-05-01") },
    );
    expect(dates).toEqual([]);
  });

  test("endDate で打ち切り", () => {
    const dates = enumerateDueDates(
      { recurrence: { type: "daily" }, startDate: d("2026-05-01"), endDate: d("2026-05-03") },
      { from: d("2026-05-01"), to: d("2026-05-07") },
    );
    expect(dates).toEqual(["2026-05-01", "2026-05-02", "2026-05-03"]);
  });
});

describe("parseCreateCatTask", () => {
  const base = {
    title: "朝の薬",
    startDate: "2026-05-01",
    catIds: [CAT_A],
  };

  test("daily 最小入力 OK", () => {
    const r = parseCreateCatTask({ ...base, recurrence: { type: "daily" } });
    expect(r.isOk()).toBe(true);
  });

  test("interval_days(3) OK", () => {
    const r = parseCreateCatTask({
      ...base,
      recurrence: { type: "interval_days", days: 3 },
    });
    expect(r.isOk()).toBe(true);
  });

  test("interval_months(1) OK + 複数猫", () => {
    const r = parseCreateCatTask({
      ...base,
      recurrence: { type: "interval_months", months: 1 },
      catIds: [CAT_A, CAT_B],
    });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value.catIds).toHaveLength(2);
  });

  test("once OK + notes/endDate あり", () => {
    const r = parseCreateCatTask({
      ...base,
      recurrence: { type: "once" },
      endDate: "2026-05-01",
      notes: "予防接種 (3 種混合)",
    });
    expect(r.isOk()).toBe(true);
  });

  test("interval_days で days 欠落 → validation_error", () => {
    const r = parseCreateCatTask({
      ...base,
      recurrence: { type: "interval_days" },
    });
    expect(r.isErr()).toBe(true);
  });

  test("interval_days で days=0 → validation_error", () => {
    const r = parseCreateCatTask({
      ...base,
      recurrence: { type: "interval_days", days: 0 },
    });
    expect(r.isErr()).toBe(true);
  });

  test("catIds が空配列 → validation_error", () => {
    const r = parseCreateCatTask({
      ...base,
      recurrence: { type: "daily" },
      catIds: [],
    });
    expect(r.isErr()).toBe(true);
  });

  test("catIds に非 UUID → validation_error", () => {
    const r = parseCreateCatTask({
      ...base,
      recurrence: { type: "daily" },
      catIds: ["not-a-uuid"],
    });
    expect(r.isErr()).toBe(true);
  });

  test("endDate < startDate → validation_error", () => {
    const r = parseCreateCatTask({
      ...base,
      recurrence: { type: "daily" },
      endDate: "2026-04-30",
    });
    expect(r.isErr()).toBe(true);
  });

  test("endDate = startDate は OK", () => {
    const r = parseCreateCatTask({
      ...base,
      recurrence: { type: "daily" },
      endDate: "2026-05-01",
    });
    expect(r.isOk()).toBe(true);
  });

  test("title 空文字 → validation_error", () => {
    const r = parseCreateCatTask({
      ...base,
      title: "",
      recurrence: { type: "daily" },
    });
    expect(r.isErr()).toBe(true);
  });

  test("不正な startDate フォーマット → validation_error", () => {
    const r = parseCreateCatTask({
      ...base,
      startDate: "2026/05/01",
      recurrence: { type: "daily" },
    });
    expect(r.isErr()).toBe(true);
  });
});

describe("parseUpdateCatTask", () => {
  test("空 object OK (全 optional)", () => {
    expect(parseUpdateCatTask({}).isOk()).toBe(true);
  });

  test("title のみ", () => {
    const r = parseUpdateCatTask({ title: "夜の薬" });
    expect(r.isOk()).toBe(true);
  });

  test("catIds 空配列 → validation_error", () => {
    expect(parseUpdateCatTask({ catIds: [] }).isErr()).toBe(true);
  });

  test("recurrence は更新スキーマに含まれず無視される", () => {
    const r = parseUpdateCatTask({ recurrence: { type: "daily" } });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect("recurrence" in r.value).toBe(false);
  });
});

describe("parseCreateCompletion", () => {
  test("正常入力", () => {
    const r = parseCreateCompletion({
      catId: CAT_A,
      dueDate: "2026-05-23",
      completedAt: new Date().toISOString(),
    });
    expect(r.isOk()).toBe(true);
  });

  test("未来の completedAt は弾く", () => {
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const r = parseCreateCompletion({
      catId: CAT_A,
      dueDate: "2026-05-23",
      completedAt: future,
    });
    expect(r.isErr()).toBe(true);
  });
});

describe("parseDateOnly", () => {
  test("YYYY-MM-DD は OK", () => {
    expect(parseDateOnly("2026-05-23").isOk()).toBe(true);
  });

  test("実在しない日付 (2/30) は validation_error", () => {
    expect(parseDateOnly("2026-02-30").isErr()).toBe(true);
  });

  test("YYYY/MM/DD は validation_error", () => {
    expect(parseDateOnly("2026/05/23").isErr()).toBe(true);
  });
});

describe("parseCatTaskId", () => {
  test("UUID OK", () => {
    expect(parseCatTaskId(CAT_A).isOk()).toBe(true);
  });

  test("non-UUID NG", () => {
    expect(parseCatTaskId("nope").isErr()).toBe(true);
  });
});

describe("rowToRecurrence / recurrenceToColumns 往復", () => {
  test("daily", () => {
    expect(rowToRecurrence("daily", null)).toEqual({ type: "daily" });
    expect(recurrenceToColumns({ type: "daily" })).toEqual({
      recurrenceType: "daily",
      recurrenceValue: null,
    });
  });

  test("once", () => {
    expect(rowToRecurrence("once", null)).toEqual({ type: "once" });
    expect(recurrenceToColumns({ type: "once" })).toEqual({
      recurrenceType: "once",
      recurrenceValue: null,
    });
  });

  test("interval_days", () => {
    expect(rowToRecurrence("interval_days", 3)).toEqual({ type: "interval_days", days: 3 });
    expect(recurrenceToColumns({ type: "interval_days", days: 3 })).toEqual({
      recurrenceType: "interval_days",
      recurrenceValue: 3,
    });
  });

  test("interval_months", () => {
    expect(rowToRecurrence("interval_months", 1)).toEqual({ type: "interval_months", months: 1 });
    expect(recurrenceToColumns({ type: "interval_months", months: 6 })).toEqual({
      recurrenceType: "interval_months",
      recurrenceValue: 6,
    });
  });
});
