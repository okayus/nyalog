import { Hono } from "hono";
import type { Env } from "../types";

// PR 1 stub: 全ハンドラは 501 Not Implemented を返す。
// PR 2 で記録の CRUD、PR 3 で添付ファイル (multipart upload + 認可付き proxy 配信) を実装する。
const notImplemented = { error: { type: "not_implemented" as const } };

export const medicalRecordRoutes = new Hono<Env>()
  .get("/", (c) => c.json(notImplemented, 501))
  .get("/:id", (c) => c.json(notImplemented, 501))
  .post("/", (c) => c.json(notImplemented, 501))
  .put("/:id", (c) => c.json(notImplemented, 501))
  .delete("/:id", (c) => c.json(notImplemented, 501))
  .post("/:id/attachments", (c) => c.json(notImplemented, 501))
  .get("/:id/attachments/:attachmentId", (c) => c.json(notImplemented, 501))
  .delete("/:id/attachments/:attachmentId", (c) => c.json(notImplemented, 501));
