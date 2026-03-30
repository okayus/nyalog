import { Hono } from "hono";
import { cors } from "hono/cors";

type Bindings = {
  DB: D1Database;
};

const ALLOWED_ORIGINS = [
  "https://nyalog-web.pages.dev",
  "http://localhost:5173",
];

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  "/*",
  cors({
    origin: ALLOWED_ORIGINS,
  }),
);

app.get("/api/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

export type AppType = typeof app;
export default app;
