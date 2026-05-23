import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, gte, inArray, isNull, lte, or, desc } from "drizzle-orm";
import { catTaskCats, catTaskCompletions, catTasks, cats } from "../db/schema";
import { CatId } from "../domain/cat";
import {
  type CatTask,
  type CatTaskError,
  CatTaskRowSchema,
  TaskCompletionRowSchema,
  isDueOn,
  parseCatTaskId,
  parseCreateCatTask,
  parseCreateCompletion,
  parseDateOnly,
  parseTaskCompletionId,
  parseUpdateCatTask,
  recurrenceToColumns,
  rowToRecurrence,
} from "../domain/cat-task";
import type { Env } from "../types";

function errorResponse(error: CatTaskError) {
  switch (error.type) {
    case "validation_error":
      return { body: { error }, status: 400 as const };
    case "not_found":
      return {
        body: { error: { type: error.type, message: `Task ${error.id} not found` } },
        status: 404 as const,
      };
    case "cat_not_found":
      return {
        body: { error: { type: error.type, message: `Cat ${error.catId} not found` } },
        status: 404 as const,
      };
    case "completion_not_found":
      return {
        body: { error: { type: error.type, message: `Completion ${error.id} not found` } },
        status: 404 as const,
      };
  }
}

function noSpaceResponse() {
  return {
    body: {
      error: { type: "forbidden" as const, message: "User does not belong to any space" },
    },
    status: 403 as const,
  };
}

// DB row + cat_task_cats join → domain CatTask
function buildTask(row: typeof catTasks.$inferSelect, catIds: string[]): CatTask {
  const parsed = CatTaskRowSchema.parse(row);
  return {
    id: parsed.id,
    spaceId: parsed.spaceId,
    title: parsed.title,
    recurrence: rowToRecurrence(parsed.recurrenceType, parsed.recurrenceValue),
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    notes: parsed.notes,
    catIds: catIds.map((id) => CatId.parse(id)),
    createdBy: parsed.createdBy,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
  };
}

async function loadCatLinks(
  db: ReturnType<typeof drizzle>,
  taskIds: string[],
): Promise<Map<string, string[]>> {
  if (taskIds.length === 0) return new Map();
  const links = await db.select().from(catTaskCats).where(inArray(catTaskCats.taskId, taskIds));
  const map = new Map<string, string[]>();
  for (const link of links) {
    const arr = map.get(link.taskId) ?? [];
    arr.push(link.catId);
    map.set(link.taskId, arr);
  }
  return map;
}

// 指定 catIds が全部 memberSpaceIds 配下の cats かを検証。1 つでも外れていれば cat_not_found。
async function assertCatsInSpaces(
  db: ReturnType<typeof drizzle>,
  inputCatIds: string[],
  memberSpaceIds: string[],
): Promise<{ ok: true } | { ok: false; error: CatTaskError }> {
  if (memberSpaceIds.length === 0) {
    return { ok: false, error: { type: "cat_not_found", catId: inputCatIds[0] ?? "" } };
  }
  const rows = await db
    .select({ id: cats.id })
    .from(cats)
    .where(and(inArray(cats.id, inputCatIds), inArray(cats.spaceId, memberSpaceIds)));
  const foundIds = new Set(rows.map((r) => r.id));
  for (const id of inputCatIds) {
    if (!foundIds.has(id)) {
      return { ok: false, error: { type: "cat_not_found", catId: id } };
    }
  }
  return { ok: true };
}

export const catTaskRoutes = new Hono<Env>()
  .get("/", async (c) => {
    const memberSpaceIds = c.get("memberSpaceIds");
    if (memberSpaceIds.length === 0) return c.json([]);

    const db = drizzle(c.env.DB);
    const rows = await db
      .select()
      .from(catTasks)
      .where(inArray(catTasks.spaceId, memberSpaceIds))
      .orderBy(desc(catTasks.createdAt));

    const catLinks = await loadCatLinks(
      db,
      rows.map((r) => r.id),
    );
    return c.json(rows.map((row) => buildTask(row, catLinks.get(row.id) ?? [])));
  })
  .get("/today", async (c) => {
    const memberSpaceIds = c.get("memberSpaceIds");
    if (memberSpaceIds.length === 0) return c.json([]);

    const dateParam = c.req.query("date");
    if (!dateParam) {
      const { body, status } = errorResponse({
        type: "validation_error",
        message: "Missing 'date' query parameter",
        issues: [],
      });
      return c.json(body, status);
    }
    const dateResult = parseDateOnly(dateParam);
    if (dateResult.isErr()) {
      const { body, status } = errorResponse(dateResult.error);
      return c.json(body, status);
    }
    const today = dateResult.value;

    const db = drizzle(c.env.DB);

    // 1. 期間内のタスクのみ DB レベルで絞る
    const taskRows = await db
      .select()
      .from(catTasks)
      .where(
        and(
          inArray(catTasks.spaceId, memberSpaceIds),
          lte(catTasks.startDate, today),
          or(isNull(catTasks.endDate), gte(catTasks.endDate, today)),
        ),
      );

    // 2. isDueOn で recurrence をフィルタ
    const dueTasks = taskRows
      .map((row) => CatTaskRowSchema.parse(row))
      .filter((row) =>
        isDueOn(
          {
            recurrence: rowToRecurrence(row.recurrenceType, row.recurrenceValue),
            startDate: row.startDate,
            endDate: row.endDate,
          },
          today,
        ),
      );

    if (dueTasks.length === 0) return c.json([]);

    const dueIds = dueTasks.map((t) => t.id);
    const catLinks = await loadCatLinks(db, dueIds);
    const allCatIds = [...new Set([...catLinks.values()].flat())];
    if (allCatIds.length === 0) return c.json([]);

    const catRows = await db
      .select({ id: cats.id, name: cats.name, themeColor: cats.themeColor })
      .from(cats)
      .where(inArray(cats.id, allCatIds));
    const catMap = new Map(catRows.map((c) => [c.id, c]));

    const completionRows = await db
      .select()
      .from(catTaskCompletions)
      .where(
        and(inArray(catTaskCompletions.taskId, dueIds), eq(catTaskCompletions.dueDate, today)),
      );
    const completionKey = (tid: string, cid: string) => `${tid}|${cid}`;
    const completionMap = new Map(
      completionRows.map((r) => [
        completionKey(r.taskId, r.catId),
        TaskCompletionRowSchema.parse(r),
      ]),
    );

    // (task × cat) のフラット list を返す
    const items = dueTasks.flatMap((task) => {
      const linked = catLinks.get(task.id) ?? [];
      return linked
        .map((catId) => {
          const cat = catMap.get(catId);
          if (!cat) return null;
          const completion = completionMap.get(completionKey(task.id, catId)) ?? null;
          return {
            task: {
              id: task.id,
              title: task.title,
              recurrence: rowToRecurrence(task.recurrenceType, task.recurrenceValue),
              notes: task.notes,
            },
            cat: { id: cat.id, name: cat.name, themeColor: cat.themeColor },
            dueDate: today,
            completion,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
    });

    return c.json(items);
  })
  .get("/:id", async (c) => {
    const memberSpaceIds = c.get("memberSpaceIds");
    if (memberSpaceIds.length === 0) {
      const { body, status } = errorResponse({ type: "not_found", id: c.req.param("id") ?? "" });
      return c.json(body, status);
    }

    const idResult = parseCatTaskId(c.req.param("id") ?? "");
    if (idResult.isErr()) {
      const { body, status } = errorResponse(idResult.error);
      return c.json(body, status);
    }

    const db = drizzle(c.env.DB);
    const rows = await db
      .select()
      .from(catTasks)
      .where(and(eq(catTasks.id, idResult.value), inArray(catTasks.spaceId, memberSpaceIds)));
    if (rows.length === 0) {
      const { body, status } = errorResponse({ type: "not_found", id: idResult.value });
      return c.json(body, status);
    }

    const catLinks = await loadCatLinks(db, [idResult.value]);
    return c.json(buildTask(rows[0], catLinks.get(idResult.value) ?? []));
  })
  .post("/", async (c) => {
    const memberSpaceIds = c.get("memberSpaceIds");
    if (memberSpaceIds.length === 0) {
      const { body, status } = noSpaceResponse();
      return c.json(body, status);
    }

    const parsed = parseCreateCatTask(await c.req.json());
    if (parsed.isErr()) {
      const { body, status } = errorResponse(parsed.error);
      return c.json(body, status);
    }
    const input = parsed.value;

    const db = drizzle(c.env.DB);
    const catCheck = await assertCatsInSpaces(db, input.catIds, memberSpaceIds);
    if (!catCheck.ok) {
      const { body, status } = errorResponse(catCheck.error);
      return c.json(body, status);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const userId = c.get("userId");
    const spaceId = memberSpaceIds[0];
    const { recurrenceType, recurrenceValue } = recurrenceToColumns(input.recurrence);

    await db.insert(catTasks).values({
      id,
      spaceId,
      title: input.title,
      recurrenceType,
      recurrenceValue,
      startDate: input.startDate,
      endDate: input.endDate,
      notes: input.notes,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(catTaskCats).values(input.catIds.map((catId) => ({ taskId: id, catId })));

    const rows = await db.select().from(catTasks).where(eq(catTasks.id, id));
    return c.json(buildTask(rows[0], input.catIds), 201);
  })
  .put("/:id", async (c) => {
    const memberSpaceIds = c.get("memberSpaceIds");
    if (memberSpaceIds.length === 0) {
      const { body, status } = errorResponse({ type: "not_found", id: c.req.param("id") ?? "" });
      return c.json(body, status);
    }

    const idResult = parseCatTaskId(c.req.param("id") ?? "");
    if (idResult.isErr()) {
      const { body, status } = errorResponse(idResult.error);
      return c.json(body, status);
    }

    const db = drizzle(c.env.DB);
    const existing = await db
      .select()
      .from(catTasks)
      .where(and(eq(catTasks.id, idResult.value), inArray(catTasks.spaceId, memberSpaceIds)));
    if (existing.length === 0) {
      const { body, status } = errorResponse({ type: "not_found", id: idResult.value });
      return c.json(body, status);
    }

    const bodyResult = parseUpdateCatTask(await c.req.json());
    if (bodyResult.isErr()) {
      const { body, status } = errorResponse(bodyResult.error);
      return c.json(body, status);
    }
    const input = bodyResult.value;

    if (input.catIds !== undefined) {
      const catCheck = await assertCatsInSpaces(db, input.catIds, memberSpaceIds);
      if (!catCheck.ok) {
        const { body, status } = errorResponse(catCheck.error);
        return c.json(body, status);
      }
    }

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (input.title !== undefined) updates.title = input.title;
    if (input.endDate !== undefined) updates.endDate = input.endDate;
    if (input.notes !== undefined) updates.notes = input.notes;

    await db.update(catTasks).set(updates).where(eq(catTasks.id, idResult.value));

    if (input.catIds !== undefined) {
      // 完了履歴は cat_task_cats に FK で繋がっていないので、cat の解除では消えない (履歴保持)。
      await db.delete(catTaskCats).where(eq(catTaskCats.taskId, idResult.value));
      await db
        .insert(catTaskCats)
        .values(input.catIds.map((catId) => ({ taskId: idResult.value, catId })));
    }

    const rows = await db.select().from(catTasks).where(eq(catTasks.id, idResult.value));
    const links = await loadCatLinks(db, [idResult.value]);
    return c.json(buildTask(rows[0], links.get(idResult.value) ?? []));
  })
  .delete("/:id", async (c) => {
    const memberSpaceIds = c.get("memberSpaceIds");
    if (memberSpaceIds.length === 0) {
      const { body, status } = errorResponse({ type: "not_found", id: c.req.param("id") ?? "" });
      return c.json(body, status);
    }

    const idResult = parseCatTaskId(c.req.param("id") ?? "");
    if (idResult.isErr()) {
      const { body, status } = errorResponse(idResult.error);
      return c.json(body, status);
    }

    const db = drizzle(c.env.DB);
    const existing = await db
      .select()
      .from(catTasks)
      .where(and(eq(catTasks.id, idResult.value), inArray(catTasks.spaceId, memberSpaceIds)));
    if (existing.length === 0) {
      const { body, status } = errorResponse({ type: "not_found", id: idResult.value });
      return c.json(body, status);
    }

    // cat_task_cats / cat_task_completions は FK ON DELETE CASCADE で連動削除
    await db.delete(catTasks).where(eq(catTasks.id, idResult.value));
    return c.json({});
  })
  .post("/:id/completions", async (c) => {
    const memberSpaceIds = c.get("memberSpaceIds");
    if (memberSpaceIds.length === 0) {
      const { body, status } = errorResponse({ type: "not_found", id: c.req.param("id") ?? "" });
      return c.json(body, status);
    }

    const idResult = parseCatTaskId(c.req.param("id") ?? "");
    if (idResult.isErr()) {
      const { body, status } = errorResponse(idResult.error);
      return c.json(body, status);
    }

    const db = drizzle(c.env.DB);
    const taskRows = await db
      .select()
      .from(catTasks)
      .where(and(eq(catTasks.id, idResult.value), inArray(catTasks.spaceId, memberSpaceIds)));
    if (taskRows.length === 0) {
      const { body, status } = errorResponse({ type: "not_found", id: idResult.value });
      return c.json(body, status);
    }

    const bodyResult = parseCreateCompletion(await c.req.json());
    if (bodyResult.isErr()) {
      const { body, status } = errorResponse(bodyResult.error);
      return c.json(body, status);
    }
    const input = bodyResult.value;

    // 指定 cat がこのタスクに紐付いているか確認
    const linkRows = await db
      .select()
      .from(catTaskCats)
      .where(and(eq(catTaskCats.taskId, idResult.value), eq(catTaskCats.catId, input.catId)));
    if (linkRows.length === 0) {
      const { body, status } = errorResponse({ type: "cat_not_found", catId: input.catId });
      return c.json(body, status);
    }

    // 既存 completion があれば idempotent に返す
    const existing = await db
      .select()
      .from(catTaskCompletions)
      .where(
        and(
          eq(catTaskCompletions.taskId, idResult.value),
          eq(catTaskCompletions.catId, input.catId),
          eq(catTaskCompletions.dueDate, input.dueDate),
        ),
      );
    if (existing.length > 0) {
      return c.json(TaskCompletionRowSchema.parse(existing[0]), 200);
    }

    const completionId = crypto.randomUUID();
    const now = new Date().toISOString();
    const userId = c.get("userId");
    await db.insert(catTaskCompletions).values({
      id: completionId,
      taskId: idResult.value,
      catId: input.catId,
      dueDate: input.dueDate,
      completedAt: input.completedAt,
      completedBy: userId,
      createdAt: now,
    });

    const rows = await db
      .select()
      .from(catTaskCompletions)
      .where(eq(catTaskCompletions.id, completionId));
    return c.json(TaskCompletionRowSchema.parse(rows[0]), 201);
  })
  .delete("/:id/completions/:completionId", async (c) => {
    const memberSpaceIds = c.get("memberSpaceIds");
    if (memberSpaceIds.length === 0) {
      const { body, status } = errorResponse({ type: "not_found", id: c.req.param("id") ?? "" });
      return c.json(body, status);
    }

    const idResult = parseCatTaskId(c.req.param("id") ?? "");
    if (idResult.isErr()) {
      const { body, status } = errorResponse(idResult.error);
      return c.json(body, status);
    }

    const completionIdResult = parseTaskCompletionId(c.req.param("completionId") ?? "");
    if (completionIdResult.isErr()) {
      const { body, status } = errorResponse(completionIdResult.error);
      return c.json(body, status);
    }

    const db = drizzle(c.env.DB);
    // task が member space 配下であることと、completion が task に属していることの両方を確認
    const rows = await db
      .select({ cid: catTaskCompletions.id })
      .from(catTaskCompletions)
      .innerJoin(catTasks, eq(catTaskCompletions.taskId, catTasks.id))
      .where(
        and(
          eq(catTaskCompletions.id, completionIdResult.value),
          eq(catTaskCompletions.taskId, idResult.value),
          inArray(catTasks.spaceId, memberSpaceIds),
        ),
      );
    if (rows.length === 0) {
      const { body, status } = errorResponse({
        type: "completion_not_found",
        id: completionIdResult.value,
      });
      return c.json(body, status);
    }

    await db.delete(catTaskCompletions).where(eq(catTaskCompletions.id, completionIdResult.value));
    return c.json({});
  });
