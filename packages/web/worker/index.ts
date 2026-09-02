import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { authRoutes } from "./routes/auth";
import { catRoutes } from "./routes/cats";
import { catTaskRoutes } from "./routes/cat-tasks";
import { medicalRecordRoutes } from "./routes/medical-records";
import { toiletRoutes } from "./routes/toilet-records";
import { weightRoutes } from "./routes/weight-records";
import { inviteAcceptRoutes } from "./routes/invite-accept";
import { spaceInviteRoutes } from "./routes/space-invites";
import { spaceRoutes } from "./routes/spaces";
import { sessionMiddleware } from "./middleware/session";
import { spaceMiddleware } from "./middleware/space";
import type { Env, SpaceEnv } from "./types";

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
protectedApi.route("/cats/:catId/weights", weightRoutes);
protectedApi.route("/tasks", catTaskRoutes);
// 一覧と参加は spaceMiddleware の外 — どちらもまだ :spaceId が決まっていない段階で呼ぶ
protectedApi.route("/spaces", spaceRoutes);
protectedApi.route("/invites", inviteAcceptRoutes);

// /api/spaces/:spaceId/* は所属を 1 回だけ確かめてから (所属外は 404)
const space = new Hono<SpaceEnv>();
space.use("*", spaceMiddleware);
space.route("/invites", spaceInviteRoutes);
protectedApi.route("/spaces/:spaceId", space);

api.route("/", protectedApi);

app.route("/api", api);

app.notFound(async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  return new Response(res.body, res);
});

export type AppType = typeof app;
export default app;

// Cloudflare Workflows class export. wrangler.jsonc の `workflows[].class_name` と一致させる必要あり。
// Worker default export と並列に置くのが Workflows の慣例。
export { AnalyzeBloodTestWorkflow } from "./lib/analyzer/workflow";
