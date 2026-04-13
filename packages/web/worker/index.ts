import { Hono } from "hono";
import { authRoutes } from "./routes/auth";
import { catRoutes } from "./routes/cats";
import { toiletRoutes } from "./routes/toilet-records";
import { sessionMiddleware } from "./middleware/session";
import type { Env } from "./types";

const app = new Hono<Env>();

app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

const api = new Hono<Env>();

api.route("/auth", authRoutes);

const protectedApi = new Hono<Env>();
protectedApi.use("/*", sessionMiddleware());
protectedApi.route("/cats", catRoutes);
protectedApi.route("/cats/:catId/toilet-records", toiletRoutes);
api.route("/", protectedApi);

app.route("/api", api);

export type AppType = typeof app;
export default app;
