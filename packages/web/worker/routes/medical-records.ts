import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, inArray } from "drizzle-orm";
import { cats, medicalRecords } from "../db/schema";
import { CatId, type CatId as CatIdType } from "../domain/cat";
import type { SpaceId } from "../domain/space";
import {
  type MedicalRecord,
  type MedicalRecordError,
  MedicalRecordRowSchema,
  parseMedicalRecordId,
  parseCreateMedicalRecord,
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

async function resolveCatId(
  db: ReturnType<typeof drizzle>,
  rawCatId: string,
  memberSpaceIds: SpaceId[],
): Promise<{ ok: true; catId: CatIdType } | { ok: false; error: MedicalRecordError }> {
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
    .select({ id: cats.id })
    .from(cats)
    .where(and(eq(cats.id, parsed.data), inArray(cats.spaceId, memberSpaceIds)));
  if (rows.length === 0) {
    return { ok: false, error: { type: "cat_not_found", catId: parsed.data } };
  }
  return { ok: true, catId: parsed.data };
}

// PR 2 stub: attachments 系は PR 3 で実装する。
const attachmentsNotImplemented = { error: { type: "not_implemented" as const } };

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

    // attachments は DB レベルの cascade で消える。R2 オブジェクトの掃除は PR 3 で追加する。
    await db.delete(medicalRecords).where(eq(medicalRecords.id, idResult.value));
    return c.json({});
  })
  .post("/:id/attachments", (c) => c.json(attachmentsNotImplemented, 501))
  .get("/:id/attachments/:attachmentId", (c) => c.json(attachmentsNotImplemented, 501))
  .delete("/:id/attachments/:attachmentId", (c) => c.json(attachmentsNotImplemented, 501));
