import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, inArray } from "drizzle-orm";
import { cats, weightRecords } from "../db/schema";
import { CatId, type CatId as CatIdType } from "../domain/cat";
import type { SpaceId } from "../domain/space";
import {
  type WeightRecord,
  type WeightRecordError,
  WeightRecordRowSchema,
  parseWeightRecordId,
  parseCreateWeightRecord,
  parseUpdateWeightRecord,
} from "../domain/weight-record";
import type { Env } from "../types";

function errorResponse(error: WeightRecordError) {
  switch (error.type) {
    case "validation_error":
      return { body: { error }, status: 400 as const };
    case "not_found":
      return {
        body: {
          error: {
            type: error.type,
            message: `Weight record ${error.id} not found`,
          },
        },
        status: 404 as const,
      };
    case "cat_not_found":
      return {
        body: {
          error: {
            type: error.type,
            message: `Cat ${error.catId} not found`,
          },
        },
        status: 404 as const,
      };
  }
}

function toRecord(row: typeof weightRecords.$inferSelect): WeightRecord {
  return WeightRecordRowSchema.parse(row);
}

async function resolveCatId(
  db: ReturnType<typeof drizzle>,
  rawCatId: string,
  memberSpaceIds: SpaceId[],
): Promise<{ ok: true; catId: CatIdType } | { ok: false; error: WeightRecordError }> {
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

export const weightRoutes = new Hono<Env>()
  .get("/", async (c) => {
    const db = drizzle(c.env.DB);
    const cat = await resolveCatId(db, c.req.param("catId") ?? "", c.get("memberSpaceIds"));
    if (!cat.ok) {
      const { body, status } = errorResponse(cat.error);
      return c.json(body, status);
    }

    const rows = await db
      .select()
      .from(weightRecords)
      .where(eq(weightRecords.catId, cat.catId))
      .orderBy(desc(weightRecords.measuredAt));
    return c.json(rows.map(toRecord));
  })
  .get("/:id", async (c) => {
    const db = drizzle(c.env.DB);
    const cat = await resolveCatId(db, c.req.param("catId") ?? "", c.get("memberSpaceIds"));
    if (!cat.ok) {
      const { body, status } = errorResponse(cat.error);
      return c.json(body, status);
    }

    const idResult = parseWeightRecordId(c.req.param("id"));
    if (idResult.isErr()) {
      const { body, status } = errorResponse(idResult.error);
      return c.json(body, status);
    }

    const rows = await db
      .select()
      .from(weightRecords)
      .where(and(eq(weightRecords.id, idResult.value), eq(weightRecords.catId, cat.catId)));
    if (rows.length === 0) {
      const { body, status } = errorResponse({
        type: "not_found",
        id: idResult.value,
      });
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

    const parsed = parseCreateWeightRecord(await c.req.json());
    if (parsed.isErr()) {
      const { body, status } = errorResponse(parsed.error);
      return c.json(body, status);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const input = parsed.value;
    const userId = c.get("userId");

    await db.insert(weightRecords).values({
      id,
      catId: cat.catId,
      weightGrams: input.weightGrams,
      measuredAt: input.measuredAt,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    const rows = await db.select().from(weightRecords).where(eq(weightRecords.id, id));
    return c.json(toRecord(rows[0]), 201);
  })
  .put("/:id", async (c) => {
    const db = drizzle(c.env.DB);
    const cat = await resolveCatId(db, c.req.param("catId") ?? "", c.get("memberSpaceIds"));
    if (!cat.ok) {
      const { body, status } = errorResponse(cat.error);
      return c.json(body, status);
    }

    const idResult = parseWeightRecordId(c.req.param("id"));
    if (idResult.isErr()) {
      const { body, status } = errorResponse(idResult.error);
      return c.json(body, status);
    }

    const existing = await db
      .select()
      .from(weightRecords)
      .where(and(eq(weightRecords.id, idResult.value), eq(weightRecords.catId, cat.catId)));
    if (existing.length === 0) {
      const { body, status } = errorResponse({
        type: "not_found",
        id: idResult.value,
      });
      return c.json(body, status);
    }

    const bodyResult = parseUpdateWeightRecord(await c.req.json());
    if (bodyResult.isErr()) {
      const { body, status } = errorResponse(bodyResult.error);
      return c.json(body, status);
    }

    const updates: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (bodyResult.value.weightGrams !== undefined) {
      updates.weightGrams = bodyResult.value.weightGrams;
    }
    if (bodyResult.value.measuredAt !== undefined) {
      updates.measuredAt = bodyResult.value.measuredAt;
    }

    await db.update(weightRecords).set(updates).where(eq(weightRecords.id, idResult.value));

    const rows = await db.select().from(weightRecords).where(eq(weightRecords.id, idResult.value));
    return c.json(toRecord(rows[0]));
  })
  .delete("/:id", async (c) => {
    const db = drizzle(c.env.DB);
    const cat = await resolveCatId(db, c.req.param("catId") ?? "", c.get("memberSpaceIds"));
    if (!cat.ok) {
      const { body, status } = errorResponse(cat.error);
      return c.json(body, status);
    }

    const idResult = parseWeightRecordId(c.req.param("id"));
    if (idResult.isErr()) {
      const { body, status } = errorResponse(idResult.error);
      return c.json(body, status);
    }

    const existing = await db
      .select()
      .from(weightRecords)
      .where(and(eq(weightRecords.id, idResult.value), eq(weightRecords.catId, cat.catId)));
    if (existing.length === 0) {
      const { body, status } = errorResponse({
        type: "not_found",
        id: idResult.value,
      });
      return c.json(body, status);
    }

    await db.delete(weightRecords).where(eq(weightRecords.id, idResult.value));
    return c.json({});
  });
