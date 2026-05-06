import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

export const authRateLimit = createMiddleware<Env>(async (c, next) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const { success } = await c.env.AUTH_RATE_LIMITER.limit({ key: ip });
  if (!success) {
    return c.json({ error: { type: "rate_limited", message: "Too many requests" } }, 429);
  }
  await next();
});
