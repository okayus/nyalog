import { sign, verify } from "hono/jwt";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context } from "hono";
import type { Env } from "../types";

const COOKIE_NAME = "nyalog_challenge";
const CHALLENGE_TTL_SEC = 5 * 60;
const CHALLENGE_AUD = "nyalog:challenge";

export type ChallengeKind = "registration" | "authentication" | "add-credential";

type ChallengePayload = {
  challenge: string;
  kind: ChallengeKind;
  uid?: string;
  aud: typeof CHALLENGE_AUD;
  exp: number;
};

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
  kind: ChallengeKind,
  uid?: string,
): Promise<void> {
  const token = await sign(
    {
      challenge,
      kind,
      ...(uid ? { uid } : {}),
      aud: CHALLENGE_AUD,
      exp: Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SEC,
    },
    c.env.SESSION_SECRET,
  );
  setCookie(c, COOKIE_NAME, token, cookieOptions);
}

export async function consumeChallenge(
  c: Context<Env>,
  kind: ChallengeKind,
): Promise<{ challenge: string; uid?: string } | null> {
  const token = getCookie(c, COOKIE_NAME);
  deleteCookie(c, COOKIE_NAME, { path: "/" });
  if (!token) return null;
  try {
    const payload = (await verify(token, c.env.SESSION_SECRET, "HS256")) as ChallengePayload;
    if (payload.aud !== CHALLENGE_AUD || payload.kind !== kind) return null;
    return { challenge: payload.challenge, uid: payload.uid };
  } catch {
    return null;
  }
}
