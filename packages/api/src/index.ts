import { Hono } from "hono";
import { cors } from "hono/cors";
import { accessAuth } from "./middleware/access-auth";

type Bindings = {
  DB: D1Database;
  TEAM_DOMAIN: string;
  POLICY_AUD: string;
};

type Variables = {
  userEmail: string;
};

const ALLOWED_ORIGINS = [
  "https://nyalog-web.pages.dev",
  "http://localhost:5173",
];

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use(
  "/*",
  cors({
    origin: ALLOWED_ORIGINS,
  }),
);

// Public endpoints (outside /api, not protected by Cloudflare Access)
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Protected endpoints
const authed = new Hono<{ Bindings: Bindings; Variables: Variables }>();
authed.use("/*", accessAuth());

authed.get("/me", (c) => {
  return c.json({ email: c.get("userEmail") });
});

app.route("/api", authed);

export type AppType = typeof app;
export default app;
