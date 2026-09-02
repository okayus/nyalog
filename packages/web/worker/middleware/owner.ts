import { and, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { spaceMembers } from "../db/schema";

type Db = ReturnType<typeof drizzle>;

// owner 判定は middleware にせず handler の中で呼ぶ。同じ prefix に member でも
// 通したい GET が同居するため (prefix で締めると member が 403 を食う)。
export async function isOwner(db: Db, userId: string, spaceId: string): Promise<boolean> {
  const rows = await db
    .select({ role: spaceMembers.role })
    .from(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)));
  return rows[0]?.role === "owner";
}
