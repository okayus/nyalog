import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { parseCreateToken, parsePatId, patErrorResponse } from "../domain/pat";
import { createPat, listPats, patPepperAvailable, revokePat } from "../lib/pat";
import { sessionMiddleware } from "../middleware/session";
import type { Env } from "../types";

// /api/tokens — PAT の管理 (ADR-009)。cookie セッション限定: PAT で PAT を増やせない。
export const tokenRoutes = new Hono<Env>()
  .use("*", sessionMiddleware())
  .get("/", async (c) => {
    const db = drizzle(c.env.DB);
    return c.json(await listPats(db, c.get("userId"))); // hash は select していない
  })
  .post("/", async (c) => {
    if (!patPepperAvailable(c.env)) {
      const { body, status } = patErrorResponse({
        type: "pat_unavailable",
        message: "PAT_PEPPER is not configured on this deployment",
      });
      return c.json(body, status);
    }
    const parsed = parseCreateToken(await c.req.json().catch(() => undefined));
    if (parsed.isErr()) {
      const { body, status } = patErrorResponse(parsed.error);
      return c.json(body, status);
    }
    const db = drizzle(c.env.DB);
    const issued = await createPat(db, c.env, c.get("userId"), parsed.value.name);
    // 平文はこのレスポンスにしか出ない。log には id だけ。
    console.log("[tokens] issued", issued.id);
    return c.json(issued, 201);
  })
  .delete("/:id", async (c) => {
    const parsed = parsePatId(c.req.param("id"));
    if (parsed.isErr()) {
      const { body, status } = patErrorResponse(parsed.error);
      return c.json(body, status);
    }
    const db = drizzle(c.env.DB);
    const revoked = await revokePat(db, c.get("userId"), parsed.value);
    if (!revoked) {
      const { body, status } = patErrorResponse({ type: "not_found", message: "Token not found" });
      return c.json(body, status);
    }
    console.log("[tokens] revoked", parsed.value);
    return c.json({});
  });
