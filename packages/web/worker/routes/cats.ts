import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, inArray } from "drizzle-orm";
import { cats } from "../db/schema";
import {
  type Cat,
  type CatError,
  CatRowSchema,
  parseCatId,
  parseCreateCat,
  parseUpdateCat,
} from "../domain/cat";
import type { Env } from "../types";

function catErrorResponse(error: CatError) {
  switch (error.type) {
    case "validation_error":
      return { body: { error }, status: 400 as const };
    case "not_found":
      return {
        body: { error: { type: error.type, message: `Cat ${error.id} not found` } },
        status: 404 as const,
      };
  }
}

function noSpaceResponse() {
  return {
    body: {
      error: {
        type: "forbidden" as const,
        message: "User does not belong to any space",
      },
    },
    status: 403 as const,
  };
}

function toCat(row: typeof cats.$inferSelect): Cat {
  return CatRowSchema.parse(row);
}

export const catRoutes = new Hono<Env>()
  .get("/", async (c) => {
    const memberSpaceIds = c.get("memberSpaceIds");
    if (memberSpaceIds.length === 0) return c.json([]);

    const db = drizzle(c.env.DB);
    const result = await db.select().from(cats).where(inArray(cats.spaceId, memberSpaceIds));
    return c.json(result.map(toCat));
  })
  .get("/:id", async (c) => {
    const parsed = parseCatId(c.req.param("id"));
    if (parsed.isErr()) {
      const { body, status } = catErrorResponse(parsed.error);
      return c.json(body, status);
    }

    const memberSpaceIds = c.get("memberSpaceIds");
    if (memberSpaceIds.length === 0) {
      const { body, status } = catErrorResponse({ type: "not_found", id: parsed.value });
      return c.json(body, status);
    }

    const db = drizzle(c.env.DB);
    const rows = await db
      .select()
      .from(cats)
      .where(and(eq(cats.id, parsed.value), inArray(cats.spaceId, memberSpaceIds)));
    if (rows.length === 0) {
      const { body, status } = catErrorResponse({ type: "not_found", id: parsed.value });
      return c.json(body, status);
    }

    return c.json(toCat(rows[0]));
  })
  .post("/", async (c) => {
    const memberSpaceIds = c.get("memberSpaceIds");
    if (memberSpaceIds.length === 0) {
      const { body, status } = noSpaceResponse();
      return c.json(body, status);
    }

    const parsed = parseCreateCat(await c.req.json());
    if (parsed.isErr()) {
      const { body, status } = catErrorResponse(parsed.error);
      return c.json(body, status);
    }

    const { name, birthday, themeColor } = parsed.value;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const userId = c.get("userId");
    // single-space UX: bind new cats to the user's primary (only) space.
    // multi-space membership is out of scope for the current UI.
    const spaceId = memberSpaceIds[0];

    const db = drizzle(c.env.DB);
    await db.insert(cats).values({
      id,
      name,
      birthday,
      themeColor,
      spaceId,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    const rows = await db.select().from(cats).where(eq(cats.id, id));
    return c.json(toCat(rows[0]), 201);
  })
  .put("/:id", async (c) => {
    const idResult = parseCatId(c.req.param("id"));
    if (idResult.isErr()) {
      const { body, status } = catErrorResponse(idResult.error);
      return c.json(body, status);
    }

    const memberSpaceIds = c.get("memberSpaceIds");
    if (memberSpaceIds.length === 0) {
      const { body, status } = catErrorResponse({ type: "not_found", id: idResult.value });
      return c.json(body, status);
    }

    const bodyResult = parseUpdateCat(await c.req.json());
    if (bodyResult.isErr()) {
      const { body, status } = catErrorResponse(bodyResult.error);
      return c.json(body, status);
    }

    const db = drizzle(c.env.DB);
    const existing = await db
      .select()
      .from(cats)
      .where(and(eq(cats.id, idResult.value), inArray(cats.spaceId, memberSpaceIds)));
    if (existing.length === 0) {
      const { body, status } = catErrorResponse({
        type: "not_found",
        id: idResult.value,
      });
      return c.json(body, status);
    }

    const updates: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (bodyResult.value.name !== undefined) {
      updates.name = bodyResult.value.name;
    }
    if (bodyResult.value.birthday !== undefined) {
      updates.birthday = bodyResult.value.birthday;
    }
    if (bodyResult.value.themeColor !== undefined) {
      updates.themeColor = bodyResult.value.themeColor;
    }

    await db
      .update(cats)
      .set(updates)
      .where(and(eq(cats.id, idResult.value), inArray(cats.spaceId, memberSpaceIds)));

    const rows = await db.select().from(cats).where(eq(cats.id, idResult.value));
    return c.json(toCat(rows[0]));
  })
  .delete("/:id", async (c) => {
    const parsed = parseCatId(c.req.param("id"));
    if (parsed.isErr()) {
      const { body, status } = catErrorResponse(parsed.error);
      return c.json(body, status);
    }

    const memberSpaceIds = c.get("memberSpaceIds");
    if (memberSpaceIds.length === 0) {
      const { body, status } = catErrorResponse({ type: "not_found", id: parsed.value });
      return c.json(body, status);
    }

    const db = drizzle(c.env.DB);
    const existing = await db
      .select()
      .from(cats)
      .where(and(eq(cats.id, parsed.value), inArray(cats.spaceId, memberSpaceIds)));
    if (existing.length === 0) {
      const { body, status } = catErrorResponse({
        type: "not_found",
        id: parsed.value,
      });
      return c.json(body, status);
    }

    await db
      .delete(cats)
      .where(and(eq(cats.id, parsed.value), inArray(cats.spaceId, memberSpaceIds)));
    return c.json({});
  });
