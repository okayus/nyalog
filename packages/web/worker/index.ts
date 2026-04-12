import { Hono } from "hono";
import { accessAuth } from "./access-auth";
import { catRoutes } from "./routes/cats";
import { toiletRoutes } from "./routes/toilet-records";
import type { Env } from "./types";

const app = new Hono<Env>();

// Public endpoints (not protected by Cloudflare Access)
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Protected endpoints
const authed = new Hono<Env>();
authed.use("/*", accessAuth());

authed.get("/me", (c) => {
  return c.json({ email: c.get("userEmail") });
});

authed.route("/cats", catRoutes);
authed.route("/cats/:catId/toilet-records", toiletRoutes);

app.route("/api", authed);

export type AppType = typeof app;
export default app;
