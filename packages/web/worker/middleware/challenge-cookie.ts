import { sign, verify } from "hono/jwt";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context } from "hono";
import { z } from "zod";
import type { Env } from "../types";

const COOKIE_NAME = "nyalog_challenge";
const CHALLENGE_TTL_SEC = 5 * 60;
const CHALLENGE_AUD = "nyalog:challenge";

// verify 側が必要とするものは全部ここに署名して入れる。id の類をクライアントから
// 受け取らない — 招待の inviteId / spaceId をレスポンスに載せて信じ直すと、
// 未消費の inviteId を知った人がトークン無しで参加できてしまう。
const ChallengeState = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("authentication") }),
  z.object({ kind: z.literal("add-credential"), uid: z.string() }),
  z.object({ kind: z.literal("initial"), uid: z.string(), displayName: z.string() }),
  z.object({
    kind: z.literal("invite"),
    uid: z.string(),
    displayName: z.string(),
    inviteId: z.string(),
    spaceId: z.string(),
  }),
]);
export type ChallengeState = z.infer<typeof ChallengeState>;

const ChallengePayload = z.object({
  challenge: z.string(),
  state: ChallengeState,
  aud: z.literal(CHALLENGE_AUD),
  exp: z.number(),
});

const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
  path: "/",
  maxAge: CHALLENGE_TTL_SEC,
};

export async function issueChallenge(
  c: Context<Env>,
  challenge: string,
  state: ChallengeState,
): Promise<void> {
  const token = await sign(
    {
      challenge,
      state,
      aud: CHALLENGE_AUD,
      exp: Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SEC,
    },
    c.env.SESSION_SECRET,
  );
  setCookie(c, COOKIE_NAME, token, cookieOptions);
}

// 単回使用: 検証の前に cookie を消すので、失敗した verify を同じ challenge で再試行できない。
export async function consumeChallenge(
  c: Context<Env>,
): Promise<{ challenge: string; state: ChallengeState } | null> {
  const token = getCookie(c, COOKIE_NAME);
  deleteCookie(c, COOKIE_NAME, { path: "/" });
  if (!token) return null;
  try {
    const raw = await verify(token, c.env.SESSION_SECRET, "HS256");
    // 署名が通っても中身は改めて型で確かめる (未知の kind は弾く)
    const parsed = ChallengePayload.safeParse(raw);
    return parsed.success ? { challenge: parsed.data.challenge, state: parsed.data.state } : null;
  } catch {
    return null;
  }
}
