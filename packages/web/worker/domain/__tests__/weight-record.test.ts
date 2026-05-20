import { describe, expect, test } from "vitest";
import {
  parseCreateWeightRecord,
  parseUpdateWeightRecord,
  parseWeightRecordId,
} from "../weight-record";

describe("parseCreateWeightRecord", () => {
  test("正常な weightGrams + measuredAt を受け付ける", () => {
    const result = parseCreateWeightRecord({
      weightGrams: 4200,
      measuredAt: "2026-05-20T10:00:00.000Z",
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.weightGrams).toBe(4200);
      expect(result.value.measuredAt).toBe("2026-05-20T10:00:00.000Z");
    }
  });

  test("負の weightGrams は validation_error", () => {
    const result = parseCreateWeightRecord({
      weightGrams: -1,
      measuredAt: "2026-05-20T10:00:00.000Z",
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.type).toBe("validation_error");
  });

  test("ゼロの weightGrams は validation_error (positive 制約)", () => {
    const result = parseCreateWeightRecord({
      weightGrams: 0,
      measuredAt: "2026-05-20T10:00:00.000Z",
    });
    expect(result.isErr()).toBe(true);
  });

  test("小数の weightGrams は validation_error (int 制約)", () => {
    const result = parseCreateWeightRecord({
      weightGrams: 4200.5,
      measuredAt: "2026-05-20T10:00:00.000Z",
    });
    expect(result.isErr()).toBe(true);
  });

  test("50_001g は validation_error (上限超過)", () => {
    const result = parseCreateWeightRecord({
      weightGrams: 50_001,
      measuredAt: "2026-05-20T10:00:00.000Z",
    });
    expect(result.isErr()).toBe(true);
  });

  test("ぴったり 50_000g は OK (境界値)", () => {
    const result = parseCreateWeightRecord({
      weightGrams: 50_000,
      measuredAt: "2026-05-20T10:00:00.000Z",
    });
    expect(result.isOk()).toBe(true);
  });

  test("未来 5 分の measuredAt は validation_error", () => {
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const result = parseCreateWeightRecord({
      weightGrams: 4200,
      measuredAt: future,
    });
    expect(result.isErr()).toBe(true);
  });

  test("未来 30 秒の measuredAt は OK (60s 許容内)", () => {
    const nearFuture = new Date(Date.now() + 30 * 1000).toISOString();
    const result = parseCreateWeightRecord({
      weightGrams: 4200,
      measuredAt: nearFuture,
    });
    expect(result.isOk()).toBe(true);
  });

  test("不正な日時フォーマットは validation_error", () => {
    const result = parseCreateWeightRecord({
      weightGrams: 4200,
      measuredAt: "2026-05-20",
    });
    expect(result.isErr()).toBe(true);
  });
});

describe("parseUpdateWeightRecord", () => {
  test("両方 optional なので空オブジェクトは OK", () => {
    const result = parseUpdateWeightRecord({});
    expect(result.isOk()).toBe(true);
  });

  test("weightGrams のみの更新", () => {
    const result = parseUpdateWeightRecord({ weightGrams: 4300 });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.weightGrams).toBe(4300);
      expect(result.value.measuredAt).toBeUndefined();
    }
  });

  test("measuredAt のみの更新", () => {
    const result = parseUpdateWeightRecord({
      measuredAt: "2026-05-19T08:00:00.000Z",
    });
    expect(result.isOk()).toBe(true);
  });

  test("不正な値が混じれば validation_error", () => {
    const result = parseUpdateWeightRecord({ weightGrams: -100 });
    expect(result.isErr()).toBe(true);
  });
});

describe("parseWeightRecordId", () => {
  test("UUID は OK", () => {
    const result = parseWeightRecordId("550e8400-e29b-41d4-a716-446655440000");
    expect(result.isOk()).toBe(true);
  });

  test("UUID でない文字列は validation_error", () => {
    const result = parseWeightRecordId("not-a-uuid");
    expect(result.isErr()).toBe(true);
  });
});
