import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { authRoutes } from "./routes/auth";
import { catRoutes } from "./routes/cats";
import { medicalRecordRoutes } from "./routes/medical-records";
import { toiletRoutes } from "./routes/toilet-records";
import { sessionMiddleware } from "./middleware/session";
import type { Env } from "./types";

const app = new Hono<Env>();

app.use(
  "*",
  secureHeaders({
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    referrerPolicy: "strict-origin-when-cross-origin",
    xFrameOptions: "DENY",
    contentSecurityPolicy: {
      frameAncestors: ["'none'"],
      frameSrc: ["https://calendar.google.com", "https://accounts.google.com"],
    },
    crossOriginEmbedderPolicy: false,
  }),
);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: { type: "internal" } }, 500);
});

app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

const api = new Hono<Env>();

api.route("/auth", authRoutes);

const protectedApi = new Hono<Env>();
protectedApi.use("/*", sessionMiddleware());
protectedApi.route("/cats", catRoutes);
protectedApi.route("/cats/:catId/toilet-records", toiletRoutes);
protectedApi.route("/cats/:catId/medical-records", medicalRecordRoutes);
api.route("/", protectedApi);

app.route("/api", api);

app.notFound(async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  return new Response(res.body, res);
});

export type AppType = typeof app;
export default app;
