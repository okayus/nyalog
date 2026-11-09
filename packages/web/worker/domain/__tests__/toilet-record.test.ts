import { describe, expect, test } from "vitest";
import { parseCreateToiletRecord, parseUpdateToiletRecord } from "../toilet-record";
import { parseListQuery } from "../list-query";

describe("timestamp の正規化 (ADR-009 §4)", () => {
  test("オフセット付きは UTC Z に直して保存する", () => {
    const r = parseCreateToiletRecord({
      type: "urination",
      timestamp: "2026-10-30T09:00:00+09:00",
    })._unsafeUnwrap();
    expect(r.timestamp).toBe("2026-10-30T00:00:00.000Z");
  });

  test("Z 表記は秒以下も含めて toISOString の形に揃う", () => {
    const r = parseCreateToiletRecord({
      type: "defecation",
      timestamp: "2026-10-30T00:00:00Z",
      condition: "soft",
    })._unsafeUnwrap();
    expect(r).toEqual({
      type: "defecation",
      timestamp: "2026-10-30T00:00:00.000Z",
      condition: "soft",
    });
  });

  test("更新の timestamp も同じ", () => {
    const r = parseUpdateToiletRecord({
      type: "urination",
      timestamp: "2026-10-29T23:30:00-01:00",
    })._unsafeUnwrap();
    expect(r.timestamp).toBe("2026-10-30T00:30:00.000Z");
  });

  test("未来 (60 秒超) は拒否", () => {
    const future = new Date(Date.now() + 5 * 60_000).toISOString();
    expect(parseCreateToiletRecord({ type: "urination", timestamp: future }).isErr()).toBe(true);
  });

  test("since も UTC Z に揃える (保存値との文字列比較のため)", () => {
    expect(parseListQuery({ since: "2026-10-30T09:00:00+09:00" })._unsafeUnwrap().since).toBe(
      "2026-10-30T00:00:00.000Z",
    );
  });
});
