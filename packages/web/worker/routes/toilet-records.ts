import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq } from "drizzle-orm";
import { cats, toiletRecords } from "../db/schema";
import { CatId, type CatId as CatIdType } from "../domain/cat";
import {
  type ToiletRecord,
  type ToiletRecordError,
  parseToiletRecordId,
  parseCreateToiletRecord,
  parseUpdateToiletRecord,
} from "../domain/toilet-record";
import type { Env } from "../types";

function errorResponse(error: ToiletRecordError) {
  switch (error.type) {
    case "validation_error":
      return { body: { error }, status: 400 as const };
    case "not_found":
      return {
        body: {
          error: {
            type: error.type,
            message: `Toilet record ${error.id} not found`,
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

function toRecord(row: typeof toiletRecords.$inferSelect): ToiletRecord {
  const base = {
    id: row.id as ToiletRecord["id"],
    catId: row.catId as CatIdType,
    timestamp: row.timestamp as ToiletRecord["timestamp"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (row.type === "defecation") {
    // condition が null なら DB の不整合。アプリ書き込み経路では発生しない
    return {
      ...base,
      type: "defecation",
      condition: (row.condition ?? "normal") as ToiletRecord extends {
        condition: infer C;
      }
        ? C
        : never,
    };
  }
  return { ...base, type: "urination" };
}

async function resolveCatId(
  db: ReturnType<typeof drizzle>,
  rawCatId: string,
): Promise<{ ok: true; catId: CatIdType } | { ok: false; error: ToiletRecordError }> {
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
  const rows = await db.select().from(cats).where(eq(cats.id, parsed.data));
  if (rows.length === 0) {
    return { ok: false, error: { type: "cat_not_found", catId: parsed.data } };
  }
  return { ok: true, catId: parsed.data };
}

export const toiletRoutes = new Hono<Env>()
  .get("/", async (c) => {
    const db = drizzle(c.env.DB);
    const cat = await resolveCatId(db, c.req.param("catId") ?? "");
    if (!cat.ok) {
      const { body, status } = errorResponse(cat.error);
      return c.json(body, status);
    }

    const rows = await db
      .select()
      .from(toiletRecords)
      .where(eq(toiletRecords.catId, cat.catId))
      .orderBy(desc(toiletRecords.timestamp));
    return c.json(rows.map(toRecord));
  })
  .get("/:id", async (c) => {
    const db = drizzle(c.env.DB);
    const cat = await resolveCatId(db, c.req.param("catId") ?? "");
    if (!cat.ok) {
      const { body, status } = errorResponse(cat.error);
      return c.json(body, status);
    }

    const idResult = parseToiletRecordId(c.req.param("id"));
    if (idResult.isErr()) {
      const { body, status } = errorResponse(idResult.error);
      return c.json(body, status);
    }

    const rows = await db
      .select()
      .from(toiletRecords)
      .where(and(eq(toiletRecords.id, idResult.value), eq(toiletRecords.catId, cat.catId)));
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
    const cat = await resolveCatId(db, c.req.param("catId") ?? "");
    if (!cat.ok) {
      const { body, status } = errorResponse(cat.error);
      return c.json(body, status);
    }

    const parsed = parseCreateToiletRecord(await c.req.json());
    if (parsed.isErr()) {
      const { body, status } = errorResponse(parsed.error);
      return c.json(body, status);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const input = parsed.value;

    await db.insert(toiletRecords).values({
      id,
      catId: cat.catId,
      type: input.type,
      timestamp: input.timestamp,
      condition: input.type === "defecation" ? input.condition : null,
      createdAt: now,
      updatedAt: now,
    });

    const rows = await db.select().from(toiletRecords).where(eq(toiletRecords.id, id));
    return c.json(toRecord(rows[0]), 201);
  })
  .put("/:id", async (c) => {
    const db = drizzle(c.env.DB);
    const cat = await resolveCatId(db, c.req.param("catId") ?? "");
    if (!cat.ok) {
      const { body, status } = errorResponse(cat.error);
      return c.json(body, status);
    }

    const idResult = parseToiletRecordId(c.req.param("id"));
    if (idResult.isErr()) {
      const { body, status } = errorResponse(idResult.error);
      return c.json(body, status);
    }

    const existing = await db
      .select()
      .from(toiletRecords)
      .where(and(eq(toiletRecords.id, idResult.value), eq(toiletRecords.catId, cat.catId)));
    if (existing.length === 0) {
      const { body, status } = errorResponse({
        type: "not_found",
        id: idResult.value,
      });
      return c.json(body, status);
    }

    const bodyResult = parseUpdateToiletRecord(await c.req.json());
    if (bodyResult.isErr()) {
      const { body, status } = errorResponse(bodyResult.error);
      return c.json(body, status);
    }

    // type 変更は禁止: 既存の type と一致しないと 400
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
    if (bodyResult.value.timestamp !== undefined) {
      updates.timestamp = bodyResult.value.timestamp;
    }
    if (bodyResult.value.type === "defecation" && bodyResult.value.condition !== undefined) {
      updates.condition = bodyResult.value.condition;
    }

    await db.update(toiletRecords).set(updates).where(eq(toiletRecords.id, idResult.value));

    const rows = await db.select().from(toiletRecords).where(eq(toiletRecords.id, idResult.value));
    return c.json(toRecord(rows[0]));
  })
  .delete("/:id", async (c) => {
    const db = drizzle(c.env.DB);
    const cat = await resolveCatId(db, c.req.param("catId") ?? "");
    if (!cat.ok) {
      const { body, status } = errorResponse(cat.error);
      return c.json(body, status);
    }

    const idResult = parseToiletRecordId(c.req.param("id"));
    if (idResult.isErr()) {
      const { body, status } = errorResponse(idResult.error);
      return c.json(body, status);
    }

    const existing = await db
      .select()
      .from(toiletRecords)
      .where(and(eq(toiletRecords.id, idResult.value), eq(toiletRecords.catId, cat.catId)));
    if (existing.length === 0) {
      const { body, status } = errorResponse({
        type: "not_found",
        id: idResult.value,
      });
      return c.json(body, status);
    }

    await db.delete(toiletRecords).where(eq(toiletRecords.id, idResult.value));
    return c.json({});
  });
