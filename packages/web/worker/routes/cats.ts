import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { cats } from "../db/schema";
import { type Cat, type CatError, parseCatId, parseCreateCat, parseUpdateCat } from "../domain/cat";
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

function toCat(row: typeof cats.$inferSelect): Cat {
  return row as unknown as Cat;
}

export const catRoutes = new Hono<Env>()
  .get("/", async (c) => {
    const db = drizzle(c.env.DB);
    const result = await db.select().from(cats);
    return c.json(result.map(toCat));
  })
  .get("/:id", async (c) => {
    const parsed = parseCatId(c.req.param("id"));
    if (parsed.isErr()) {
      const { body, status } = catErrorResponse(parsed.error);
      return c.json(body, status);
    }

    const db = drizzle(c.env.DB);
    const rows = await db.select().from(cats).where(eq(cats.id, parsed.value));
    if (rows.length === 0) {
      const { body, status } = catErrorResponse({ type: "not_found", id: parsed.value });
      return c.json(body, status);
    }

    return c.json(toCat(rows[0]));
  })
  .post("/", async (c) => {
    const parsed = parseCreateCat(await c.req.json());
    if (parsed.isErr()) {
      const { body, status } = catErrorResponse(parsed.error);
      return c.json(body, status);
    }

    const { name, birthday } = parsed.value;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const db = drizzle(c.env.DB);
    await db.insert(cats).values({
      id,
      name,
      birthday,
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

    const bodyResult = parseUpdateCat(await c.req.json());
    if (bodyResult.isErr()) {
      const { body, status } = catErrorResponse(bodyResult.error);
      return c.json(body, status);
    }

    const db = drizzle(c.env.DB);
    const existing = await db.select().from(cats).where(eq(cats.id, idResult.value));
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

    await db.update(cats).set(updates).where(eq(cats.id, idResult.value));

    const rows = await db.select().from(cats).where(eq(cats.id, idResult.value));
    return c.json(toCat(rows[0]));
  })
  .delete("/:id", async (c) => {
    const parsed = parseCatId(c.req.param("id"));
    if (parsed.isErr()) {
      const { body, status } = catErrorResponse(parsed.error);
      return c.json(body, status);
    }

    const db = drizzle(c.env.DB);
    const existing = await db.select().from(cats).where(eq(cats.id, parsed.value));
    if (existing.length === 0) {
      const { body, status } = catErrorResponse({
        type: "not_found",
        id: parsed.value,
      });
      return c.json(body, status);
    }

    await db.delete(cats).where(eq(cats.id, parsed.value));
    return c.json({});
  });
