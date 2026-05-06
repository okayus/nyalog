import { Hono, type Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, asc, eq } from "drizzle-orm";
import {
  bloodTestAnalyses,
  bloodTestValues,
  medicalRecordAttachments,
  medicalRecords,
} from "../db/schema";
import {
  parseCreateBloodTestValue,
  parseUpdateBloodTestValue,
  parseValueId,
  type BloodTestAnalysis,
  BloodTestAnalysisRowSchema,
  type BloodTestValue,
  BloodTestValueRowSchema,
} from "../domain/blood-test-analysis";
import { parseAttachmentId, parseMedicalRecordId } from "../domain/medical-record";
import type { Env } from "../types";
import { resolveCatId } from "./medical-records";

// 解析対象は image/{jpeg,png,webp} のみ。HEIC/HEIF は Workers AI が
// 確実に読めるか不明なので除外。PDF も第一弾は除外 (PR 2 Plan 通り)。
const ANALYZABLE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type AttachmentResolution = {
  recordId: string;
  recordType: "blood_test" | "other";
  attachmentId: string;
  r2Key: string;
  contentType: string;
};

// cat → medical_record → attachment まで認可付きで解決する。
// medical-records.ts の resolveCatId が memberSpaceIds 経由の認可を貫通させているので、
// それ以降は record/attachment の存在と紐付き確認のみ。
async function resolveAttachment(
  db: ReturnType<typeof drizzle>,
  c: Context<Env>,
): Promise<
  { ok: true; data: AttachmentResolution } | { ok: false; status: 400 | 404; body: unknown }
> {
  const cat = await resolveCatId(db, c.req.param("catId") ?? "", c.get("memberSpaceIds"));
  if (!cat.ok) {
    if (cat.error.type === "validation_error") {
      return { ok: false, status: 400, body: { error: cat.error } };
    }
    return { ok: false, status: 404, body: { error: { type: "cat_not_found" } } };
  }

  const recordIdResult = parseMedicalRecordId(c.req.param("id") ?? "");
  if (recordIdResult.isErr()) {
    return { ok: false, status: 400, body: { error: recordIdResult.error } };
  }

  const recordRows = await db
    .select({ id: medicalRecords.id, type: medicalRecords.type })
    .from(medicalRecords)
    .where(and(eq(medicalRecords.id, recordIdResult.value), eq(medicalRecords.catId, cat.catId)));
  if (recordRows.length === 0) {
    return { ok: false, status: 404, body: { error: { type: "not_found" } } };
  }

  const attachmentIdResult = parseAttachmentId(c.req.param("attachmentId") ?? "");
  if (attachmentIdResult.isErr()) {
    return { ok: false, status: 400, body: { error: attachmentIdResult.error } };
  }

  const attachmentRows = await db
    .select({
      id: medicalRecordAttachments.id,
      r2Key: medicalRecordAttachments.r2Key,
      contentType: medicalRecordAttachments.contentType,
    })
    .from(medicalRecordAttachments)
    .where(
      and(
        eq(medicalRecordAttachments.id, attachmentIdResult.value),
        eq(medicalRecordAttachments.medicalRecordId, recordIdResult.value),
      ),
    );
  if (attachmentRows.length === 0) {
    return { ok: false, status: 404, body: { error: { type: "attachment_not_found" } } };
  }

  return {
    ok: true,
    data: {
      recordId: recordIdResult.value,
      recordType: recordRows[0].type,
      attachmentId: attachmentIdResult.value,
      r2Key: attachmentRows[0].r2Key,
      contentType: attachmentRows[0].contentType,
    },
  };
}

function toAnalysis(row: typeof bloodTestAnalyses.$inferSelect): BloodTestAnalysis {
  return BloodTestAnalysisRowSchema.parse(row);
}

function toValue(row: typeof bloodTestValues.$inferSelect): BloodTestValue {
  return BloodTestValueRowSchema.parse(row);
}

export const bloodTestAnalysisRoutes = new Hono<Env>()
  // GET /analysis — 解析行 + values 返却。analysis row が無ければ 404。
  .get("/analysis", async (c) => {
    const db = drizzle(c.env.DB);
    const resolved = await resolveAttachment(db, c);
    if (!resolved.ok) {
      return c.json(resolved.body, resolved.status);
    }

    const analysisRows = await db
      .select()
      .from(bloodTestAnalyses)
      .where(eq(bloodTestAnalyses.attachmentId, resolved.data.attachmentId));
    if (analysisRows.length === 0) {
      return c.json({ error: { type: "analysis_not_found" } }, 404);
    }
    const analysis = toAnalysis(analysisRows[0]);

    const valueRows = await db
      .select()
      .from(bloodTestValues)
      .where(eq(bloodTestValues.analysisId, analysis.id))
      .orderBy(asc(bloodTestValues.rowIndex));

    return c.json({ analysis, values: valueRows.map(toValue) });
  })
  // POST /analyze — 既存 analysis があれば pending に戻して再解析、なければ作成。
  // blood_test type かつ image/{jpeg,png,webp} の attachment のみ受け付ける。
  .post("/analyze", async (c) => {
    const db = drizzle(c.env.DB);
    const resolved = await resolveAttachment(db, c);
    if (!resolved.ok) {
      return c.json(resolved.body, resolved.status);
    }

    if (resolved.data.recordType !== "blood_test") {
      return c.json({ error: { type: "not_blood_test" } }, 400);
    }
    if (!ANALYZABLE_CONTENT_TYPES.has(resolved.data.contentType)) {
      return c.json({ error: { type: "content_type_not_analyzable" } }, 400);
    }

    const existing = await db
      .select()
      .from(bloodTestAnalyses)
      .where(eq(bloodTestAnalyses.attachmentId, resolved.data.attachmentId));

    const now = new Date().toISOString();
    let analysisId: string;
    if (existing.length === 0) {
      analysisId = crypto.randomUUID();
      await db.insert(bloodTestAnalyses).values({
        id: analysisId,
        attachmentId: resolved.data.attachmentId,
        status: "pending",
        modelName: c.env.ANALYZER_MODEL ?? "workers-ai-gemma",
        startedAt: null,
        finishedAt: null,
        errorMessage: null,
        rawResponse: null,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      analysisId = existing[0].id;
      await db
        .update(bloodTestAnalyses)
        .set({
          status: "pending",
          startedAt: null,
          finishedAt: null,
          errorMessage: null,
          updatedAt: now,
        })
        .where(eq(bloodTestAnalyses.id, analysisId));
    }

    // Workflow を kick して durable execution に逃がす (PR fix の理由は #47 参照)。
    await c.env.ANALYZE_WORKFLOW.create({
      params: { analysisId, r2Key: resolved.data.r2Key },
    });

    const rows = await db
      .select()
      .from(bloodTestAnalyses)
      .where(eq(bloodTestAnalyses.id, analysisId));
    return c.json({ analysis: toAnalysis(rows[0]) }, 202);
  })
  // PUT /analysis/values/:valueId — 行編集。reviewed=true を自動セット。
  .put("/analysis/values/:valueId", async (c) => {
    const db = drizzle(c.env.DB);
    const resolved = await resolveAttachment(db, c);
    if (!resolved.ok) {
      return c.json(resolved.body, resolved.status);
    }

    const valueIdResult = parseValueId(c.req.param("valueId") ?? "");
    if (valueIdResult.isErr()) {
      return c.json({ error: valueIdResult.error }, 400);
    }

    // value が指定 attachment の analysis に紐付くことを確認 (横流れ防止)
    const ownership = await db
      .select({ id: bloodTestValues.id })
      .from(bloodTestValues)
      .innerJoin(bloodTestAnalyses, eq(bloodTestAnalyses.id, bloodTestValues.analysisId))
      .where(
        and(
          eq(bloodTestValues.id, valueIdResult.value),
          eq(bloodTestAnalyses.attachmentId, resolved.data.attachmentId),
        ),
      );
    if (ownership.length === 0) {
      return c.json({ error: { type: "value_not_found" } }, 404);
    }

    const parsed = parseUpdateBloodTestValue(await c.req.json());
    if (parsed.isErr()) {
      return c.json({ error: parsed.error }, 400);
    }

    const updates: Record<string, unknown> = {
      reviewed: true,
      updatedAt: new Date().toISOString(),
    };
    for (const [k, v] of Object.entries(parsed.value)) {
      if (v !== undefined) updates[k] = v;
    }

    await db
      .update(bloodTestValues)
      .set(updates)
      .where(eq(bloodTestValues.id, valueIdResult.value));
    const rows = await db
      .select()
      .from(bloodTestValues)
      .where(eq(bloodTestValues.id, valueIdResult.value));
    return c.json({ value: toValue(rows[0]) });
  })
  // POST /analysis/values — AI 漏れ補完。reviewed=true で追加 (人手登録なので既にレビュー済み)。
  .post("/analysis/values", async (c) => {
    const db = drizzle(c.env.DB);
    const resolved = await resolveAttachment(db, c);
    if (!resolved.ok) {
      return c.json(resolved.body, resolved.status);
    }

    const analysisRows = await db
      .select({ id: bloodTestAnalyses.id })
      .from(bloodTestAnalyses)
      .where(eq(bloodTestAnalyses.attachmentId, resolved.data.attachmentId));
    if (analysisRows.length === 0) {
      return c.json({ error: { type: "analysis_not_found" } }, 404);
    }
    const analysisId = analysisRows[0].id;

    const parsed = parseCreateBloodTestValue(await c.req.json());
    if (parsed.isErr()) {
      return c.json({ error: parsed.error }, 400);
    }

    // 末尾 rowIndex を計算
    const maxRow = await db
      .select({ rowIndex: bloodTestValues.rowIndex })
      .from(bloodTestValues)
      .where(eq(bloodTestValues.analysisId, analysisId))
      .orderBy(asc(bloodTestValues.rowIndex));
    const nextRowIndex = maxRow.length === 0 ? 0 : maxRow[maxRow.length - 1].rowIndex + 1;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(bloodTestValues).values({
      id,
      analysisId,
      itemCode: parsed.value.itemCode,
      itemLabel: parsed.value.itemLabel,
      unit: parsed.value.unit,
      valueText: parsed.value.valueText,
      valueNumeric: parsed.value.valueNumeric,
      refLow: parsed.value.refLow,
      refHigh: parsed.value.refHigh,
      refText: parsed.value.refText,
      flag: parsed.value.flag,
      notes: parsed.value.notes,
      rowIndex: nextRowIndex,
      reviewed: true,
      createdAt: now,
      updatedAt: now,
    });

    const rows = await db.select().from(bloodTestValues).where(eq(bloodTestValues.id, id));
    return c.json({ value: toValue(rows[0]) }, 201);
  })
  // DELETE /analysis/values/:valueId — AI 誤検出の除去。
  .delete("/analysis/values/:valueId", async (c) => {
    const db = drizzle(c.env.DB);
    const resolved = await resolveAttachment(db, c);
    if (!resolved.ok) {
      return c.json(resolved.body, resolved.status);
    }

    const valueIdResult = parseValueId(c.req.param("valueId") ?? "");
    if (valueIdResult.isErr()) {
      return c.json({ error: valueIdResult.error }, 400);
    }

    const ownership = await db
      .select({ id: bloodTestValues.id })
      .from(bloodTestValues)
      .innerJoin(bloodTestAnalyses, eq(bloodTestAnalyses.id, bloodTestValues.analysisId))
      .where(
        and(
          eq(bloodTestValues.id, valueIdResult.value),
          eq(bloodTestAnalyses.attachmentId, resolved.data.attachmentId),
        ),
      );
    if (ownership.length === 0) {
      return c.json({ error: { type: "value_not_found" } }, 404);
    }

    await db.delete(bloodTestValues).where(eq(bloodTestValues.id, valueIdResult.value));
    return c.json({});
  });
