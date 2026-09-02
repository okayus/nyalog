import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { spaceMembers, spaces } from "../db/schema";
import type { Env } from "../types";

// /api/spaces — 自分が所属しているスペース。招待 UI が :spaceId を知るために要る。
// spaceMiddleware の外 (まだ id が分かっていない段階で呼ぶ)。
export const spaceRoutes = new Hono<Env>().get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({
      id: spaces.id,
      name: spaces.name,
      role: spaceMembers.role,
      joinedAt: spaceMembers.createdAt,
    })
    .from(spaceMembers)
    .innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId))
    .where(eq(spaceMembers.userId, c.get("userId")));
  return c.json(rows);
});
