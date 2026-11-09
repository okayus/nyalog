import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { cats, toiletRecords } from "../db/schema";
import { CatId, type CatId as CatIdType } from "../domain/cat";
import { parseListQuery } from "../domain/list-query";
import type { SpaceId } from "../domain/space";
import {
  type ToiletRecord,
  type ToiletRecordError,
  ToiletRecordRowSchema,
  parseToiletRecordId,
  parseCreateToiletRecord,
  parseUpdateToiletRecord,
} from "../domain/toilet-record";
import {
  IDEMPOTENCY_KEY_HEADER,
  canonicalJson,
  idempotencyErrorResponse,
  parseIdempotencyKey,
  replayDecision,
} from "../domain/idempotency";
import {
  findStoredResponse,
  isUniqueViolation,
  purgeExpiredStatement,
  storeResponseStatement,
} from "../lib/idempotency";
import { sha256Hex } from "../lib/token";
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
  return ToiletRecordRowSchema.parse(row);
}

function mismatchResponse() {
  return idempotencyErrorResponse({
    type: "idempotency_key_mismatch",
    message: "Idempotency-Key was already used with a different request",
  });
}

async function resolveCatId(
  db: ReturnType<typeof drizzle>,
  rawCatId: string,
  memberSpaceIds: SpaceId[],
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

export const toiletRoutes = new Hono<Env>()
  .get("/", async (c) => {
    const db = drizzle(c.env.DB);
    const cat = await resolveCatId(db, c.req.param("catId") ?? "", c.get("memberSpaceIds"));
    if (!cat.ok) {
      const { body, status } = errorResponse(cat.error);
      return c.json(body, status);
    }

    const query = parseListQuery({
      since: c.req.query("since"),
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
    });
    if (query.isErr()) {
      const { body, status } = errorResponse(query.error);
      return c.json(body, status);
    }
    const { since, limit, offset } = query.value;

    // timestamp は ISO 8601 UTC の TEXT なので、辞書順比較がそのまま時刻順になる
    // (書き込みは全て toISOString())。既存の orderBy も同じ前提に乗っている。
    // id を第 2 キーに置くのは、同時刻の記録があっても offset ページングが
    // ずれないようにするため。
    const base = db
      .select()
      .from(toiletRecords)
      .where(
        since
          ? and(eq(toiletRecords.catId, cat.catId), gte(toiletRecords.timestamp, since))
          : eq(toiletRecords.catId, cat.catId),
      )
      .orderBy(desc(toiletRecords.timestamp), desc(toiletRecords.id));
    const rows = limit === undefined ? await base : await base.limit(limit).offset(offset ?? 0);
    return c.json(rows.map(toRecord));
  })
  .get("/:id", async (c) => {
    const db = drizzle(c.env.DB);
    const cat = await resolveCatId(db, c.req.param("catId") ?? "", c.get("memberSpaceIds"));
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
    // Idempotency-Key (ADR-009 §2)。ヘッダ無しなら従来どおり毎回 201。
    const keyResult = parseIdempotencyKey(c.req.header(IDEMPOTENCY_KEY_HEADER));
    if (keyResult.isErr()) {
      const { body, status } = idempotencyErrorResponse(keyResult.error);
      return c.json(body, status);
    }

    const db = drizzle(c.env.DB);
    const cat = await resolveCatId(db, c.req.param("catId") ?? "", c.get("memberSpaceIds"));
    if (!cat.ok) {
      const { body, status } = errorResponse(cat.error);
      return c.json(body, status);
    }

    const parsed = parseCreateToiletRecord(await c.req.json());
    if (parsed.isErr()) {
      const { body, status } = errorResponse(parsed.error);
      return c.json(body, status);
    }

    const now = new Date();
    const input = parsed.value;
    const userId = c.get("userId");
    const row = {
      id: crypto.randomUUID(),
      catId: cat.catId,
      type: input.type,
      timestamp: input.timestamp,
      condition: input.type === "defecation" ? input.condition : null,
      createdBy: userId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    // 応答は INSERT する値から作る (再 select しない)。冪等キーと同じ batch で入れるため。
    const record = toRecord(row);

    const key = keyResult.value;
    if (key === null) {
      await db.insert(toiletRecords).values(row);
      return c.json(record, 201);
    }

    // 同じ key でも cat や本文が違えば別のリクエスト。検証後の値で hash する。
    const requestHash = await sha256Hex(canonicalJson({ catId: cat.catId, body: input }));
    const first = replayDecision(await findStoredResponse(db, userId, key), requestHash, now);
    if (first.kind === "replay") return c.json(first.body, first.status);
    if (first.kind === "mismatch") {
      const { body, status } = mismatchResponse();
      return c.json(body, status);
    }

    try {
      await db.batch([
        purgeExpiredStatement(db, userId, now),
        db.insert(toiletRecords).values(row),
        storeResponseStatement(db, { userId, key, requestHash, status: 201, body: record, now }),
      ]);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // 同時到着で負けた側。batch は丸ごと巻き戻っているので記録は作られていない。
      const again = replayDecision(await findStoredResponse(db, userId, key), requestHash, now);
      if (again.kind === "replay") return c.json(again.body, again.status);
      if (again.kind === "mismatch") {
        const { body, status } = mismatchResponse();
        return c.json(body, status);
      }
      throw e;
    }
    return c.json(record, 201);
  })
  .put("/:id", async (c) => {
    const db = drizzle(c.env.DB);
    const cat = await resolveCatId(db, c.req.param("catId") ?? "", c.get("memberSpaceIds"));
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
    const cat = await resolveCatId(db, c.req.param("catId") ?? "", c.get("memberSpaceIds"));
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
