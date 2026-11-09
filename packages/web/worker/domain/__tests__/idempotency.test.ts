import { describe, expect, test } from "vitest";
import {
  IDEMPOTENCY_TTL_MS,
  canonicalJson,
  idempotencyCutoff,
  parseIdempotencyKey,
  replayDecision,
} from "../idempotency";

describe("parseIdempotencyKey", () => {
  test("ヘッダ無しは null (冪等化しない)", () => {
    expect(parseIdempotencyKey(undefined)._unsafeUnwrap()).toBeNull();
  });

  test("1〜128 文字の表示可能 ASCII を通す", () => {
    expect(
      parseIdempotencyKey("019299f1-8c3e-7a21-9b4d-3f8a2c1e5d70/urination")._unsafeUnwrap(),
    ).toBe("019299f1-8c3e-7a21-9b4d-3f8a2c1e5d70/urination");
    expect(parseIdempotencyKey("x".repeat(128)).isOk()).toBe(true);
  });

  test("空、129 文字、空白、非 ASCII は 400", () => {
    for (const raw of ["", "x".repeat(129), "a b", "鍵", "a\tb"]) {
      expect(parseIdempotencyKey(raw)._unsafeUnwrapErr().type).toBe("validation_error");
    }
  });
});

describe("canonicalJson", () => {
  test("キー順を固定し、undefined を落とし、配列の順序は保つ", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });

  test("同じ内容ならキーの書き順が違っても一致する", () => {
    const x = canonicalJson({ type: "urination", timestamp: "2026-10-30T00:00:00.000Z" });
    const y = canonicalJson({ timestamp: "2026-10-30T00:00:00.000Z", type: "urination" });
    expect(x).toBe(y);
  });
});

describe("replayDecision", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  const stored = {
    requestHash: "h1",
    responseStatus: 201,
    responseBody: '{"id":"r1"}',
    createdAt: "2026-10-30T11:00:00Z",
  };

  test("行が無ければ fresh", () => {
    expect(replayDecision(undefined, "h1", now)).toEqual({ kind: "fresh" });
  });

  test("同じ hash なら保存した本文を 200 で", () => {
    expect(replayDecision(stored, "h1", now)).toEqual({
      kind: "replay",
      status: 200,
      body: { id: "r1" },
    });
  });

  test("違う hash なら mismatch", () => {
    expect(replayDecision(stored, "h2", now)).toEqual({ kind: "mismatch" });
  });

  test("30 日経った行は無いものとして扱う (mismatch にもしない)", () => {
    const old = {
      ...stored,
      createdAt: new Date(now.getTime() - IDEMPOTENCY_TTL_MS).toISOString(),
    };
    expect(replayDecision(old, "h1", now)).toEqual({ kind: "fresh" });
    expect(replayDecision(old, "h2", now)).toEqual({ kind: "fresh" });
    const almost = {
      ...stored,
      createdAt: new Date(now.getTime() - IDEMPOTENCY_TTL_MS + 1000).toISOString(),
    };
    expect(replayDecision(almost, "h1", now).kind).toBe("replay");
  });

  test("cutoff は now - 30 日", () => {
    expect(idempotencyCutoff(now)).toBe("2026-09-30T12:00:00.000Z");
  });
});
