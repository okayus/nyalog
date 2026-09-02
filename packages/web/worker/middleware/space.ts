import { createMiddleware } from "hono/factory";
import { SpaceId } from "../domain/space";
import type { SpaceEnv } from "../types";

// 壊れた id も、存在しない id も、所属外の id も同じ本文で返す。403 にすると
// 「その id は在る」ことが漏れる (ADR-005)。
// console.error は残す — 404 の原因を追える唯一の手がかりで、本文には出さない。
export const spaceMiddleware = createMiddleware<SpaceEnv>(async (c, next) => {
  const raw = c.req.param("spaceId") ?? "";
  const parsed = SpaceId.safeParse(raw);
  if (!parsed.success) {
    console.error("[spaceMiddleware] 404: malformed spaceId", raw);
    return c.json({ error: { type: "not_found", message: "Not found" } }, 404);
  }
  if (!c.var.memberSpaceIds.includes(parsed.data)) {
    console.error("[spaceMiddleware] 404: not a member", parsed.data, c.var.userId);
    return c.json({ error: { type: "not_found", message: "Not found" } }, 404);
  }
  c.set("spaceId", parsed.data);
  await next();
});
