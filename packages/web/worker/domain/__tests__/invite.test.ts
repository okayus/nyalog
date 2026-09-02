import { describe, expect, it } from "vitest";
import {
  INVITE_TTL_MS,
  inviteExpiresAt,
  inviteUrl,
  inviteUsability,
  isInviteTokenShape,
  type InviteRow,
} from "../invite";

const NOW = new Date("2026-09-02T00:00:00.000Z");

function row(overrides: Partial<InviteRow> = {}): InviteRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    spaceId: "22222222-2222-4222-8222-222222222222",
    expiresAt: "2026-09-09T00:00:00.000Z",
    consumedAt: null,
    ...overrides,
  };
}

describe("isInviteTokenShape", () => {
  it("randomTokenHex(32) の形 (64 桁の小文字 hex) だけを受け入れる", () => {
    expect(isInviteTokenShape("a".repeat(64))).toBe(true);
    expect(isInviteTokenShape("A".repeat(64))).toBe(false);
    expect(isInviteTokenShape("a".repeat(63))).toBe(false);
    expect(isInviteTokenShape("a".repeat(65))).toBe(false);
    expect(isInviteTokenShape("")).toBe(false);
  });
});

describe("inviteUsability", () => {
  it("未使用で期限内なら、招待 id とスペース id を返す", () => {
    const r = inviteUsability(row(), NOW);
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap()).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      spaceId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("行が無い = トークンの hash が引けない → invite_invalid", () => {
    expect(inviteUsability(undefined, NOW)._unsafeUnwrapErr().type).toBe("invite_invalid");
  });

  it("使用済みは期限より先に見る — 使い終わったリンクを開いた家族には「使用済み」が正しい説明", () => {
    const consumedAndExpired = row({
      consumedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-08-02T00:00:00.000Z",
    });
    expect(inviteUsability(consumedAndExpired, NOW)._unsafeUnwrapErr().type).toBe(
      "invite_consumed",
    );
  });

  it("未使用でも期限切れなら invite_expired", () => {
    const expired = row({ expiresAt: "2026-09-01T23:59:59.999Z" });
    expect(inviteUsability(expired, NOW)._unsafeUnwrapErr().type).toBe("invite_expired");
  });

  it("期限ちょうどは切れている扱い (境界は閉じる)", () => {
    const justExpired = row({ expiresAt: NOW.toISOString() });
    expect(inviteUsability(justExpired, NOW)._unsafeUnwrapErr().type).toBe("invite_expired");
  });
});

describe("inviteExpiresAt", () => {
  it("発行時刻から 7 日後", () => {
    expect(inviteExpiresAt(NOW)).toBe(new Date(NOW.getTime() + INVITE_TTL_MS).toISOString());
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("inviteUrl", () => {
  it("トークンはフラグメントに置く — クエリだとアクセスログと Referer に残る", () => {
    const url = inviteUrl("https://nyalog.example.workers.dev", "b".repeat(64));
    expect(url).toBe(`https://nyalog.example.workers.dev/invite#token=${"b".repeat(64)}`);
    expect(new URL(url).search).toBe("");
  });
});
