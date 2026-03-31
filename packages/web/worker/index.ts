import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { cats } from "./db/schema";
import { accessAuth } from "./access-auth";

type Bindings = {
  DB: D1Database;
  TEAM_DOMAIN: string;
  POLICY_AUD: string;
  DEV_SKIP_AUTH?: string;
};

type Variables = {
  userEmail: string;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Public endpoints (not protected by Cloudflare Access)
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Protected endpoints
const authed = new Hono<{ Bindings: Bindings; Variables: Variables }>();
authed.use("/*", accessAuth());

authed.get("/me", (c) => {
  return c.json({ email: c.get("userEmail") });
});

authed.get("/cats", async (c) => {
  const db = drizzle(c.env.DB);
  const result = await db.select().from(cats);
  return c.json(result);
});

authed.post("/cats", async (c) => {
  const body = await c.req.json<{ name: string }>();
  const db = drizzle(c.env.DB);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(cats).values({ id, name: body.name, createdAt: now });
  return c.json({ id, name: body.name, createdAt: now }, 201);
});

app.route("/api", authed);

export type AppType = typeof app;
export default app;
