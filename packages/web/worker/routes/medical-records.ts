import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, inArray } from "drizzle-orm";
import { cats, medicalRecordAttachments, medicalRecords } from "../db/schema";
import { CatId, type CatId as CatIdType } from "../domain/cat";
import type { SpaceId } from "../domain/space";
import {
  AttachmentContentType,
  MAX_ATTACHMENT_SIZE_BYTES,
  type MedicalRecord,
  type MedicalRecordAttachment,
  MedicalRecordAttachmentRowSchema,
  type MedicalRecordError,
  MedicalRecordRowSchema,
  parseAttachmentId,
  parseCreateMedicalRecord,
  parseMedicalRecordId,
  parseUpdateMedicalRecord,
} from "../domain/medical-record";
import type { Env } from "../types";

function errorResponse(error: MedicalRecordError) {
  switch (error.type) {
    case "validation_error":
      return { body: { error }, status: 400 as const };
    case "not_found":
      return {
        body: { error: { type: error.type, message: `Medical record ${error.id} not found` } },
        status: 404 as const,
      };
    case "cat_not_found":
      return {
        body: { error: { type: error.type, message: `Cat ${error.catId} not found` } },
        status: 404 as const,
      };
    case "attachment_not_found":
      return {
        body: { error: { type: error.type, message: `Attachment ${error.id} not found` } },
        status: 404 as const,
      };
    case "attachment_too_large":
      return {
        body: {
          error: {
            type: error.type,
            message: `File exceeds ${error.maxBytes} bytes (got ${error.sizeBytes})`,
          },
        },
        status: 413 as const,
      };
    case "attachment_type_not_allowed":
      return {
        body: {
          error: {
            type: error.type,
            message: `Content type ${error.contentType} not allowed`,
          },
        },
        status: 415 as const,
      };
  }
}

function toRecord(row: typeof medicalRecords.$inferSelect): MedicalRecord {
  return MedicalRecordRowSchema.parse(row);
}

function toAttachment(row: typeof medicalRecordAttachments.$inferSelect): MedicalRecordAttachment {
  return MedicalRecordAttachmentRowSchema.parse(row);
}

async function resolveCatId(
  db: ReturnType<typeof drizzle>,
  rawCatId: string,
  memberSpaceIds: SpaceId[],
): Promise<
  { ok: true; catId: CatIdType; spaceId: SpaceId } | { ok: false; error: MedicalRecordError }
> {
  const parsed = CatId.safeParse(rawCatId);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        type: "validation_error",
        message: "Invalid cat ID",
        issues: parsed.error.issues,
      },
    };
  }
  // 所属スペース外の cat は「存在しない」として 404 を返す (存在秘匿)
  if (memberSpaceIds.length === 0) {
    return { ok: false, error: { type: "cat_not_found", catId: parsed.data } };
  }
  const rows = await db
    .select({ id: cats.id, spaceId: cats.spaceId })
    .from(cats)
    .where(and(eq(cats.id, parsed.data), inArray(cats.spaceId, memberSpaceIds)));
  if (rows.length === 0) {
    return { ok: false, error: { type: "cat_not_found", catId: parsed.data } };
  }
  return { ok: true, catId: parsed.data, spaceId: rows[0].spaceId as SpaceId };
}

export const medicalRecordRoutes = new Hono<Env>()
  .get("/", async (c) => {
    const db = drizzle(c.env.DB);
    const cat = await resolveCatId(db, c.req.param("catId") ?? "", c.get("memberSpaceIds"));
    if (!cat.ok) {
      const { body, status } = errorResponse(cat.error);
      return c.json(body, status);
    }

    const rows = await db
      .select()
      .from(medicalRecords)
      .where(eq(medicalRecords.catId, cat.catId))
      .orderBy(desc(medicalRecords.recordedAt));
    return c.json(rows.map(toRecord));
  })
  .get("/:id", async (c) => {
    const db = drizzle(c.env.DB);
    const cat = await resolveCatId(db, c.req.param("catId") ?? "", c.get("memberSpaceIds"));
    if (!cat.ok) {
      const { body, status } = errorResponse(cat.error);
      return c.json(body, status);
    }

    const idResult = parseMedicalRecordId(c.req.param("id"));
    if (idResult.isErr()) {
      const { body, status } = errorResponse(idResult.error);
      return c.json(body, status);
    }

    const rows = await db
      .select()
      .from(medicalRecords)
      .where(and(eq(medicalRecords.id, idResult.value), eq(medicalRecords.catId, cat.catId)));
    if (rows.length === 0) {
      const { body, status } = errorResponse({ type: "not_found", id: idResult.value });
      return c.json(body, status);
    }

    return c.json(toRecord(rows[0]));
  })
  .post("/", async (c) => {
    const db = drizzle(c.env.DB);
    const cat = await resolveCatId(db, c.req.param("catId") ?? "", c.get("memberSpaceIds"));
    if (!cat.ok) {
      const { body, status } = errorResponse(cat.error);
      return c.json(body, status);
    }

    const parsed = parseCreateMedicalRecord(await c.req.json());
    if (parsed.isErr()) {
      const { body, status } = errorResponse(parsed.error);
      return c.json(body, status);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const input = parsed.value;
    const userId = c.get("userId");

    await db.insert(medicalRecords).values({
      id,
      catId: cat.catId,
      type: input.type,
      recordedAt: input.recordedAt,
      title: input.title ?? null,
      notes: input.notes ?? null,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    const rows = await db.select().from(medicalRecords).where(eq(medicalRecords.id, id));
    return c.json(toRecord(rows[0]), 201);
  })
  .put("/:id", async (c) => {
    const db = drizzle(c.env.DB);
    const cat = await resolveCatId(db, c.req.param("catId") ?? "", c.get("memberSpaceIds"));
    if (!cat.ok) {
      const { body, status } = errorResponse(cat.error);
      return c.json(body, status);
    }

    const idResult = parseMedicalRecordId(c.req.param("id"));
    if (idResult.isErr()) {
      const { body, status } = errorResponse(idResult.error);
      return c.json(body, status);
    }

    const existing = await db
      .select()
      .from(medicalRecords)
      .where(and(eq(medicalRecords.id, idResult.value), eq(medicalRecords.catId, cat.catId)));
    if (existing.length === 0) {
      const { body, status } = errorResponse({ type: "not_found", id: idResult.value });
      return c.json(body, status);
    }

    const bodyResult = parseUpdateMedicalRecord(await c.req.json());
    if (bodyResult.isErr()) {
      const { body, status } = errorResponse(bodyResult.error);
      return c.json(body, status);
    }

    // type 変更は禁止: 既存の type と一致しないと 400 (toilet-records と同パターン)
    if (bodyResult.value.type !== existing[0].type) {
      return c.json(
        {
          error: {
            type: "validation_error",
            message: "Cannot change record type",
            issues: [],
          },
        },
        400,
      );
    }

    const updates: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (bodyResult.value.recordedAt !== undefined) {
      updates.recordedAt = bodyResult.value.recordedAt;
    }
    if (bodyResult.value.title !== undefined) {
      updates.title = bodyResult.value.title ?? null;
    }
    if (bodyResult.value.notes !== undefined) {
      updates.notes = bodyResult.value.notes ?? null;
    }

    await db.update(medicalRecords).set(updates).where(eq(medicalRecords.id, idResult.value));

    const rows = await db
      .select()
      .from(medicalRecords)
      .where(eq(medicalRecords.id, idResult.value));
    return c.json(toRecord(rows[0]));
  })
  .delete("/:id", async (c) => {
    const db = drizzle(c.env.DB);
    const cat = await resolveCatId(db, c.req.param("catId") ?? "", c.get("memberSpaceIds"));
    if (!cat.ok) {
      const { body, status } = errorResponse(cat.error);
      return c.json(body, status);
    }

    const idResult = parseMedicalRecordId(c.req.param("id"));
    if (idResult.isErr()) {
      const { body, status } = errorResponse(idResult.error);
      return c.json(body, status);
    }

    const existing = await db
      .select()
      .from(medicalRecords)
      .where(and(eq(medicalRecords.id, idResult.value), eq(medicalRecords.catId, cat.catId)));
    if (existing.length === 0) {
      const { body, status } = errorResponse({ type: "not_found", id: idResult.value });
      return c.json(body, status);
    }

    // 関連 attachments の R2 key を取得
    const attRows = await db
      .select({ r2Key: medicalRecordAttachments.r2Key })
      .from(medicalRecordAttachments)
      .where(eq(medicalRecordAttachments.medicalRecordId, idResult.value));

    // R2 から全て削除 (best-effort、DB cascade と独立させる)
    await Promise.all(attRows.map((a) => c.env.MEDICAL_BUCKET.delete(a.r2Key)));

    // DB delete (attachments は cascade で消える)
    await db.delete(medicalRecords).where(eq(medicalRecords.id, idResult.value));
    return c.json({});
  })
  .get("/:id/attachments", async (c) => {
    const db = drizzle(c.env.DB);
    const cat = await resolveCatId(db, c.req.param("catId") ?? "", c.get("memberSpaceIds"));
    if (!cat.ok) {
      const { body, status } = errorResponse(cat.error);
      return c.json(body, status);
    }

    const idResult = parseMedicalRecordId(c.req.param("id"));
    if (idResult.isErr()) {
      const { body, status } = errorResponse(idResult.error);
      return c.json(body, status);
    }

    const recordRows = await db
      .select({ id: medicalRecords.id })
      .from(medicalRecords)
      .where(and(eq(medicalRecords.id, idResult.value), eq(medicalRecords.catId, cat.catId)));
    if (recordRows.length === 0) {
      const { body, status } = errorResponse({ type: "not_found", id: idResult.value });
      return c.json(body, status);
    }

    const attRows = await db
      .select()
      .from(medicalRecordAttachments)
      .where(eq(medicalRecordAttachments.medicalRecordId, idResult.value))
      .orderBy(desc(medicalRecordAttachments.createdAt));
    return c.json(attRows.map(toAttachment));
  })
  .post("/:id/attachments", async (c) => {
    const db = drizzle(c.env.DB);
    const cat = await resolveCatId(db, c.req.param("catId") ?? "", c.get("memberSpaceIds"));
    if (!cat.ok) {
      const { body, status } = errorResponse(cat.error);
      return c.json(body, status);
    }

    const idResult = parseMedicalRecordId(c.req.param("id"));
    if (idResult.isErr()) {
      const { body, status } = errorResponse(idResult.error);
      return c.json(body, status);
    }

    // record の存在 + cat に紐づく確認
    const recordRows = await db
      .select({ id: medicalRecords.id })
      .from(medicalRecords)
      .where(and(eq(medicalRecords.id, idResult.value), eq(medicalRecords.catId, cat.catId)));
    if (recordRows.length === 0) {
      const { body, status } = errorResponse({ type: "not_found", id: idResult.value });
      return c.json(body, status);
    }

    // multipart 解析。FormDataEntryValue は `string | File | null` だが、
    // worker tsconfig では `File` の instanceof 検査が効かない (TS2358) ので
    // null と string を弾いて File に narrow する。
    const formData = await c.req.formData();
    const file = formData.get("file");
    if (file === null || typeof file === "string") {
      return c.json(
        {
          error: {
            type: "validation_error",
            message: "field 'file' must be a file",
            issues: [],
          },
        },
        400,
      );
    }

    // size 検証
    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      const { body, status } = errorResponse({
        type: "attachment_too_large",
        sizeBytes: file.size,
        maxBytes: MAX_ATTACHMENT_SIZE_BYTES,
      });
      return c.json(body, status);
    }

    // content-type 検証 (白リスト)
    const contentTypeResult = AttachmentContentType.safeParse(file.type);
    if (!contentTypeResult.success) {
      const { body, status } = errorResponse({
        type: "attachment_type_not_allowed",
        contentType: file.type,
      });
      return c.json(body, status);
    }

    // R2 key 生成 (medical/<spaceId>/<catId>/<recordId>/<attachmentId>)
    const attachmentId = crypto.randomUUID();
    const r2Key = `medical/${cat.spaceId}/${cat.catId}/${idResult.value}/${attachmentId}`;

    // R2 put
    await c.env.MEDICAL_BUCKET.put(r2Key, await file.arrayBuffer(), {
      httpMetadata: { contentType: contentTypeResult.data },
    });

    // DB insert
    const now = new Date().toISOString();
    await db.insert(medicalRecordAttachments).values({
      id: attachmentId,
      medicalRecordId: idResult.value,
      r2Key,
      contentType: contentTypeResult.data,
      sizeBytes: file.size,
      originalFilename: file.name || null,
      createdAt: now,
    });

    const insertedRows = await db
      .select()
      .from(medicalRecordAttachments)
      .where(eq(medicalRecordAttachments.id, attachmentId));
    return c.json(toAttachment(insertedRows[0]), 201);
  })
  .get("/:id/attachments/:attachmentId", async (c) => {
    const db = drizzle(c.env.DB);
    const cat = await resolveCatId(db, c.req.param("catId") ?? "", c.get("memberSpaceIds"));
    if (!cat.ok) {
      const { body, status } = errorResponse(cat.error);
      return c.json(body, status);
    }

    const idResult = parseMedicalRecordId(c.req.param("id"));
    if (idResult.isErr()) {
      const { body, status } = errorResponse(idResult.error);
      return c.json(body, status);
    }

    const aidResult = parseAttachmentId(c.req.param("attachmentId") ?? "");
    if (aidResult.isErr()) {
      const { body, status } = errorResponse(aidResult.error);
      return c.json(body, status);
    }

    // record + cat の整合確認
    const recordRows = await db
      .select({ id: medicalRecords.id })
      .from(medicalRecords)
      .where(and(eq(medicalRecords.id, idResult.value), eq(medicalRecords.catId, cat.catId)));
    if (recordRows.length === 0) {
      const { body, status } = errorResponse({ type: "not_found", id: idResult.value });
      return c.json(body, status);
    }

    // attachment + record の紐付き確認
    const attRows = await db
      .select()
      .from(medicalRecordAttachments)
      .where(
        and(
          eq(medicalRecordAttachments.id, aidResult.value),
          eq(medicalRecordAttachments.medicalRecordId, idResult.value),
        ),
      );
    if (attRows.length === 0) {
      const { body, status } = errorResponse({
        type: "attachment_not_found",
        id: aidResult.value,
      });
      return c.json(body, status);
    }

    const attachment = toAttachment(attRows[0]);

    // R2 get → 認可付き proxy 配信
    const obj = await c.env.MEDICAL_BUCKET.get(attachment.r2Key);
    if (obj === null) {
      // DB に row はあるが R2 に object がない (= 不整合)。404 を返す。
      const { body, status } = errorResponse({
        type: "attachment_not_found",
        id: aidResult.value,
      });
      return c.json(body, status);
    }

    return new Response(obj.body, {
      headers: {
        "Content-Type": attachment.contentType,
        "Content-Length": String(attachment.sizeBytes),
        "Cache-Control": "private, max-age=3600",
      },
    });
  })
  .delete("/:id/attachments/:attachmentId", async (c) => {
    const db = drizzle(c.env.DB);
    const cat = await resolveCatId(db, c.req.param("catId") ?? "", c.get("memberSpaceIds"));
    if (!cat.ok) {
      const { body, status } = errorResponse(cat.error);
      return c.json(body, status);
    }

    const idResult = parseMedicalRecordId(c.req.param("id"));
    if (idResult.isErr()) {
      const { body, status } = errorResponse(idResult.error);
      return c.json(body, status);
    }

    const aidResult = parseAttachmentId(c.req.param("attachmentId") ?? "");
    if (aidResult.isErr()) {
      const { body, status } = errorResponse(aidResult.error);
      return c.json(body, status);
    }

    const recordRows = await db
      .select({ id: medicalRecords.id })
      .from(medicalRecords)
      .where(and(eq(medicalRecords.id, idResult.value), eq(medicalRecords.catId, cat.catId)));
    if (recordRows.length === 0) {
      const { body, status } = errorResponse({ type: "not_found", id: idResult.value });
      return c.json(body, status);
    }

    const attRows = await db
      .select()
      .from(medicalRecordAttachments)
      .where(
        and(
          eq(medicalRecordAttachments.id, aidResult.value),
          eq(medicalRecordAttachments.medicalRecordId, idResult.value),
        ),
      );
    if (attRows.length === 0) {
      const { body, status } = errorResponse({
        type: "attachment_not_found",
        id: aidResult.value,
      });
      return c.json(body, status);
    }

    const attachment = toAttachment(attRows[0]);

    // R2 delete (best-effort、DB delete と独立)
    await c.env.MEDICAL_BUCKET.delete(attachment.r2Key);

    // DB delete
    await db
      .delete(medicalRecordAttachments)
      .where(eq(medicalRecordAttachments.id, aidResult.value));

    return c.json({});
  });
