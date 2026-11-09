import { describe, expect, test } from "vitest";
import {
  authorizePatRoute,
  isPatTokenShape,
  parseCreateToken,
  parsePatId,
  parseScopes,
  patRouteScope,
  patUsability,
  shouldTouchLastUsed,
  SCOPES,
} from "../pat";

const HEX64 = "a".repeat(64);

describe("token shape", () => {
  test("prefix + 64 hex だけ通す", () => {
    expect(isPatTokenShape(`nyalog_pat_${HEX64}`)).toBe(true);
    expect(isPatTokenShape(`nyalog_pat_${"A".repeat(64)}`)).toBe(false);
    expect(isPatTokenShape(`nyalog_pat_${HEX64}x`)).toBe(false);
    expect(isPatTokenShape(`mzo_pat_${HEX64}`)).toBe(false);
    expect(isPatTokenShape("")).toBe(false);
  });
});

describe("parseScopes", () => {
  test("既知の scope だけ残す", () => {
    expect(parseScopes(JSON.stringify([...SCOPES, "quiz:write"]))).toEqual([...SCOPES]);
  });

  test("壊れた JSON や配列でない値は空", () => {
    expect(parseScopes("not json")).toEqual([]);
    expect(parseScopes('{"a":1}')).toEqual([]);
    expect(parseScopes("[1, null]")).toEqual([]);
  });
});

describe("patUsability", () => {
  const now = new Date("2026-10-30T00:00:00Z");

  test("行が無い / 失効済み / 期限切れはすべて同じ 401", () => {
    for (const row of [
      undefined,
      { revokedAt: "2026-10-01T00:00:00Z", expiresAt: null },
      { revokedAt: null, expiresAt: "2026-10-30T00:00:00Z" },
      { revokedAt: null, expiresAt: "2026-01-01T00:00:00Z" },
    ]) {
      const r = patUsability(row, now);
      expect(r.isErr()).toBe(true);
      expect(r._unsafeUnwrapErr()).toEqual({ type: "unauthorized", message: "Invalid token" });
    }
  });

  test("生きている行は通る (無期限、期限内)", () => {
    expect(patUsability({ revokedAt: null, expiresAt: null }, now).isOk()).toBe(true);
    expect(patUsability({ revokedAt: null, expiresAt: "2026-10-30T00:00:01Z" }, now).isOk()).toBe(
      true,
    );
  });
});

describe("shouldTouchLastUsed", () => {
  const now = new Date("2026-10-30T12:00:00Z");

  test("未使用なら書く、1 時間以内なら書かない、超えたら書く", () => {
    expect(shouldTouchLastUsed(null, now)).toBe(true);
    expect(shouldTouchLastUsed("2026-10-30T11:30:00Z", now)).toBe(false);
    expect(shouldTouchLastUsed("2026-10-30T11:00:00Z", now)).toBe(false);
    expect(shouldTouchLastUsed("2026-10-30T10:59:59Z", now)).toBe(true);
  });
});

describe("PAT route table (default deny)", () => {
  const CAT = "550e8400-e29b-41d4-a716-446655440001";

  test("表にあるルートと scope", () => {
    expect(patRouteScope("GET", "/api/auth/me")).toEqual({ allowed: true, scope: null });
    expect(patRouteScope("POST", `/api/cats/${CAT}/toilet-records`)).toEqual({
      allowed: true,
      scope: "toilet:write",
    });
    expect(patRouteScope("DELETE", `/api/cats/${CAT}/toilet-records/${CAT}`)).toEqual({
      allowed: true,
      scope: "toilet:write",
    });
    expect(patRouteScope("GET", "/api/tasks/due")).toEqual({ allowed: true, scope: "tasks:read" });
    expect(patRouteScope("DELETE", `/api/tasks/${CAT}/completions/${CAT}`)).toEqual({
      allowed: true,
      scope: "tasks:write",
    });
    expect(patRouteScope("POST", `/api/tasks/${CAT}/completions`)).toEqual({
      allowed: true,
      scope: "tasks:write",
    });
  });

  test("表に無いものは method 違いも含めて拒否", () => {
    expect(patRouteScope("GET", `/api/cats/${CAT}/toilet-records`)).toEqual({ allowed: false });
    expect(patRouteScope("PUT", `/api/cats/${CAT}/toilet-records/${CAT}`)).toEqual({
      allowed: false,
    });
    expect(patRouteScope("DELETE", `/api/cats/${CAT}`)).toEqual({ allowed: false });
    expect(patRouteScope("DELETE", `/api/tasks/${CAT}`)).toEqual({ allowed: false });
    expect(patRouteScope("GET", "/api/cats")).toEqual({ allowed: false });
    expect(patRouteScope("GET", "/api/tasks")).toEqual({ allowed: false });
    expect(patRouteScope("GET", "/api/tasks/today")).toEqual({ allowed: false });
    expect(patRouteScope("POST", "/api/tokens")).toEqual({ allowed: false });
    expect(patRouteScope("POST", "/api/auth/logout")).toEqual({ allowed: false });
    expect(patRouteScope("GET", "/api/auth/me/")).toEqual({ allowed: false });
    expect(patRouteScope("POST", `/api/cats/${CAT}/toilet-records/`)).toEqual({
      allowed: false,
    });
  });

  test("authorizePatRoute: scope の有無で 403 を分ける", () => {
    expect(authorizePatRoute("GET", "/api/auth/me", []).isOk()).toBe(true);
    expect(
      authorizePatRoute("POST", `/api/cats/${CAT}/toilet-records`, ["toilet:write"]).isOk(),
    ).toBe(true);
    const lacking = authorizePatRoute("POST", `/api/cats/${CAT}/toilet-records`, ["tasks:read"]);
    expect(lacking._unsafeUnwrapErr()).toMatchObject({
      type: "insufficient_scope",
      scope: "toilet:write",
    });
    const denied = authorizePatRoute("GET", "/api/cats", [...SCOPES]);
    expect(denied._unsafeUnwrapErr()).toMatchObject({ type: "insufficient_scope", scope: null });
  });

  test("資格情報を変える領域は session_required (表に無い、ではなく)", () => {
    for (const [method, path] of [
      ["POST", "/api/tokens"],
      ["DELETE", "/api/tokens/550e8400-e29b-41d4-a716-446655440001"],
      ["POST", "/api/auth/logout"],
      ["GET", "/api/auth/credentials"],
    ] as const) {
      expect(authorizePatRoute(method, path, [...SCOPES])._unsafeUnwrapErr().type).toBe(
        "session_required",
      );
    }
    // /me は表にあるので通る
    expect(authorizePatRoute("GET", "/api/auth/me", []).isOk()).toBe(true);
  });
});

describe("parsers", () => {
  test("name は trim して 1〜100 文字", () => {
    expect(parseCreateToken({ name: "  ochanoma  " })._unsafeUnwrap()).toEqual({
      name: "ochanoma",
    });
    expect(parseCreateToken({ name: "   " }).isErr()).toBe(true);
    expect(parseCreateToken({ name: "x".repeat(101) }).isErr()).toBe(true);
    expect(parseCreateToken(undefined).isErr()).toBe(true);
  });

  test("id は uuid でなければ not_found (存在を漏らさない)", () => {
    expect(parsePatId("nope")._unsafeUnwrapErr().type).toBe("not_found");
    expect(parsePatId("550e8400-e29b-41d4-a716-446655440001").isOk()).toBe(true);
  });
});
