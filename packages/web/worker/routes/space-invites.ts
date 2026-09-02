import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { invites } from "../db/schema";
import { authErrorResponse, type AuthError } from "../domain/auth";
import { InviteId, inviteExpiresAt, inviteUrl } from "../domain/invite";
import { randomTokenHex, sha256Hex } from "../lib/token";
import { isOwner } from "../middleware/owner";
import type { SpaceEnv } from "../types";

function fail(error: AuthError) {
  return authErrorResponse(error);
}

// /api/spaces/:spaceId/invites — spaceMiddleware の内側。すべて owner 限定。
export const spaceInviteRoutes = new Hono<SpaceEnv>()
  .post("/", async (c) => {
    const db = drizzle(c.env.DB);
    if (!(await isOwner(db, c.get("userId"), c.get("spaceId")))) {
      const { body, status } = fail({ type: "forbidden", message: "Owner only" });
      return c.json(body, status);
    }
    const token = randomTokenHex();
    const inviteId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = inviteExpiresAt(now);
    await db.insert(invites).values({
      id: inviteId,
      spaceId: c.get("spaceId"),
      tokenHash: await sha256Hex(token),
      role: "member",
      expiresAt,
      createdByUserId: c.get("userId"),
      createdAt: now.toISOString(),
    });
    // observability の head_sampling_rate=1 で console 出力は全部残る。トークンは絶対に出さない。
    console.log("[invites] issued", inviteId);
    return c.json({ inviteId, expiresAt, url: inviteUrl(c.env.ORIGIN, token) }, 201);
  })
  .get("/", async (c) => {
    const db = drizzle(c.env.DB);
    if (!(await isOwner(db, c.get("userId"), c.get("spaceId")))) {
      const { body, status } = fail({ type: "forbidden", message: "Owner only" });
      return c.json(body, status);
    }
    const rows = await db
      .select({
        id: invites.id,
        expiresAt: invites.expiresAt,
        createdByUserId: invites.createdByUserId,
        createdAt: invites.createdAt,
      })
      .from(invites)
      .where(
        and(
          eq(invites.spaceId, c.get("spaceId")),
          isNull(invites.consumedAt),
          gt(invites.expiresAt, new Date().toISOString()),
        ),
      )
      .orderBy(desc(invites.createdAt));
    return c.json(rows); // hash しか持っていないのでトークンは出しようがない
  })
  .delete("/:inviteId", async (c) => {
    const db = drizzle(c.env.DB);
    if (!(await isOwner(db, c.get("userId"), c.get("spaceId")))) {
      const { body, status } = fail({ type: "forbidden", message: "Owner only" });
      return c.json(body, status);
    }
    const parsed = InviteId.safeParse(c.req.param("inviteId"));
    if (!parsed.success) {
      const { body, status } = fail({ type: "not_found", message: "Invite not found" });
      return c.json(body, status);
    }
    const deleted = await db
      .delete(invites)
      .where(and(eq(invites.id, parsed.data), eq(invites.spaceId, c.get("spaceId"))))
      .returning({ id: invites.id });
    if (deleted.length === 0) {
      const { body, status } = fail({ type: "not_found", message: "Invite not found" });
      return c.json(body, status);
    }
    return c.json({});
  });
