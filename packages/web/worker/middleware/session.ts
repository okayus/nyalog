import { createMiddleware } from "hono/factory";
import { sign, verify } from "hono/jwt";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { sessions, spaceMembers, spaces, users } from "../db/schema";
import { DisplayName, UserId } from "../domain/auth";
import { SpaceId } from "../domain/space";
import type { Env } from "../types";

// dev bypass user is auto-joined to this fixed space so dev-mode requests
// see a non-empty memberSpaceIds[]. Production uses the bootstrapped
// "nyalog family" space (different UUID); this constant is dev-only.
const DEV_SPACE_ID = "00000000-0000-4000-8000-000000000001";
const DEV_SPACE_NAME = "dev";

const COOKIE_NAME = "nyalog_session";
const SESSION_DAYS = 30;
const SESSION_AUD = "nyalog:session";

export const sessionCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
  path: "/",
  maxAge: SESSION_DAYS * 24 * 60 * 60,
};

type SessionPayload = {
  sid: string;
  aud: typeof SESSION_AUD;
  exp: number;
};

export async function issueSession(c: Context<Env>, userId: UserId): Promise<void> {
  const db = drizzle(c.env.DB);
  const sid = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    id: sid,
    userId,
    expiresAt: expiresAt.toISOString(),
    createdAt: now.toISOString(),
  });

  const token = await sign(
    { sid, aud: SESSION_AUD, exp: Math.floor(expiresAt.getTime() / 1000) },
    c.env.SESSION_SECRET,
  );
  setCookie(c, COOKIE_NAME, token, sessionCookieOptions);
}

export async function revokeSession(c: Context<Env>): Promise<void> {
  const token = getCookie(c, COOKIE_NAME);
  if (token) {
    try {
      const payload = (await verify(token, c.env.SESSION_SECRET, "HS256")) as SessionPayload;
      if (payload.aud === SESSION_AUD) {
        const db = drizzle(c.env.DB);
        await db.delete(sessions).where(eq(sessions.id, payload.sid));
      }
    } catch {
      // ignore
    }
  }
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}

function isLocalOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

async function loadMemberSpaceIds(
  db: ReturnType<typeof drizzle>,
  userId: UserId,
): Promise<SpaceId[]> {
  const rows = await db
    .select({ spaceId: spaceMembers.spaceId })
    .from(spaceMembers)
    .where(eq(spaceMembers.userId, userId));
  return rows.map((r) => SpaceId.parse(r.spaceId));
}

export function sessionMiddleware() {
  return createMiddleware<Env>(async (c, next) => {
    if (c.env.DEV_BYPASS_USER_ID && isLocalOrigin(c.env.ORIGIN)) {
      const db = drizzle(c.env.DB);
      const devId = c.env.DEV_BYPASS_USER_ID;
      const existing = await db.select().from(users).where(eq(users.id, devId));
      const now = new Date().toISOString();
      if (existing.length === 0) {
        await db.insert(users).values({
          id: devId,
          displayName: "dev",
          createdAt: now,
        });
      }
      // ensure dev space + membership exist so memberSpaceIds is non-empty
      // and dev-mode INSERTs have a space to bind to.
      await db
        .insert(spaces)
        .values({ id: DEV_SPACE_ID, name: DEV_SPACE_NAME, createdAt: now })
        .onConflictDoNothing();
      await db
        .insert(spaceMembers)
        .values({ spaceId: DEV_SPACE_ID, userId: devId, role: "owner", createdAt: now })
        .onConflictDoNothing();
      const userId = UserId.parse(devId);
      c.set("userId", userId);
      c.set("displayName", DisplayName.parse(existing[0]?.displayName ?? "dev"));
      c.set("memberSpaceIds", await loadMemberSpaceIds(db, userId));
      await next();
      return;
    }
    if (c.env.DEV_BYPASS_USER_ID) {
      console.error("DEV_BYPASS_USER_ID is set on a non-local ORIGIN; ignoring for safety");
    }

    const token = getCookie(c, COOKIE_NAME);
    if (!token) {
      return c.json({ error: { type: "unauthorized", message: "No session" } }, 401);
    }

    let payload: SessionPayload;
    try {
      payload = (await verify(token, c.env.SESSION_SECRET, "HS256")) as SessionPayload;
    } catch {
      return c.json({ error: { type: "unauthorized", message: "Invalid session token" } }, 401);
    }
    if (payload.aud !== SESSION_AUD) {
      return c.json({ error: { type: "unauthorized", message: "Wrong token audience" } }, 401);
    }

    const db = drizzle(c.env.DB);
    const rows = await db
      .select({
        sid: sessions.id,
        expiresAt: sessions.expiresAt,
        userId: sessions.userId,
        displayName: users.displayName,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.id, payload.sid));
    if (rows.length === 0) {
      deleteCookie(c, COOKIE_NAME, { path: "/" });
      return c.json({ error: { type: "session_expired" } }, 401);
    }
    const row = rows[0];
    if (new Date(row.expiresAt).getTime() < Date.now()) {
      await db.delete(sessions).where(eq(sessions.id, row.sid));
      deleteCookie(c, COOKIE_NAME, { path: "/" });
      return c.json({ error: { type: "session_expired" } }, 401);
    }

    const userId = UserId.parse(row.userId);
    c.set("userId", userId);
    c.set("displayName", DisplayName.parse(row.displayName));
    c.set("memberSpaceIds", await loadMemberSpaceIds(db, userId));

    // Sliding expiration: extend if less than half remaining
    const remaining = new Date(row.expiresAt).getTime() - Date.now();
    const totalMs = SESSION_DAYS * 24 * 60 * 60 * 1000;
    if (remaining < totalMs / 2) {
      const newExpires = new Date(Date.now() + totalMs);
      await db
        .update(sessions)
        .set({ expiresAt: newExpires.toISOString() })
        .where(eq(sessions.id, row.sid));
      const token = await sign(
        { sid: row.sid, aud: SESSION_AUD, exp: Math.floor(newExpires.getTime() / 1000) },
        c.env.SESSION_SECRET,
      );
      setCookie(c, COOKIE_NAME, token, sessionCookieOptions);
    }

    await next();
  });
}
