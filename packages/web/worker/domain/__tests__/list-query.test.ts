import { describe, expect, test } from "vitest";
import { MAX_LIST_LIMIT, parseListQuery } from "../list-query";

describe("parseListQuery", () => {
  test("パラメータ無しは全部 undefined — 窓を指定しない = 全件", () => {
    const result = parseListQuery({});
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toEqual({});
  });

  test("クエリ文字列由来の数値は数値になる", () => {
    const result = parseListQuery({ limit: "50", offset: "100" });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.limit).toBe(50);
      expect(result.value.offset).toBe(100);
    }
  });

  test("offset 単独は validation_error — limit の無い OFFSET は窓にならない", () => {
    const result = parseListQuery({ offset: "100" });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.type).toBe("validation_error");
  });

  test("offset=0 も limit が無ければ弾く", () => {
    expect(parseListQuery({ offset: "0" }).isErr()).toBe(true);
  });

  test("limit は 1 以上 MAX_LIST_LIMIT 以下", () => {
    expect(parseListQuery({ limit: "1" }).isOk()).toBe(true);
    expect(parseListQuery({ limit: String(MAX_LIST_LIMIT) }).isOk()).toBe(true);
    expect(parseListQuery({ limit: "0" }).isErr()).toBe(true);
    expect(parseListQuery({ limit: String(MAX_LIST_LIMIT + 1) }).isErr()).toBe(true);
  });

  test("負の offset は validation_error", () => {
    expect(parseListQuery({ limit: "10", offset: "-1" }).isErr()).toBe(true);
  });

  test("小数の limit は validation_error", () => {
    expect(parseListQuery({ limit: "1.5" }).isErr()).toBe(true);
  });

  test("数値でない limit は validation_error", () => {
    expect(parseListQuery({ limit: "abc" }).isErr()).toBe(true);
    expect(parseListQuery({ limit: "" }).isErr()).toBe(true);
  });

  test("since は ISO 8601 のみ受け付ける", () => {
    expect(parseListQuery({ since: "2026-08-04T00:00:00.000Z" }).isOk()).toBe(true);
    expect(parseListQuery({ since: "2026-08-04" }).isErr()).toBe(true);
    expect(parseListQuery({ since: "yesterday" }).isErr()).toBe(true);
  });

  test("since は未来でも通す — 記録の時刻ではなく絞り込みの下限なので", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(parseListQuery({ since: future }).isOk()).toBe(true);
  });
});
