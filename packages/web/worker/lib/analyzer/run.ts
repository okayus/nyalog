import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { bloodTestAnalyses, bloodTestValues } from "../../db/schema";
import type { AnalysisError } from "../../domain/blood-test-analysis";
import type { Env } from "../../types";
import { createAnalyzer } from "./factory";

// ctx.waitUntil 経由で呼ばれる非同期境界。
// 副作用: D1 (bloodTestAnalyses 行 update + bloodTestValues 行 delete-then-insert) と
// R2 read のみ。throw せず status="failed" で DB に記録するのが契約。
export async function runAnalyzer(
  env: Env["Bindings"],
  analysisId: string,
  attachmentR2Key: string,
): Promise<void> {
  const db = drizzle(env.DB);
  const startedAt = new Date().toISOString();

  await db
    .update(bloodTestAnalyses)
    .set({ status: "running", startedAt, updatedAt: startedAt, errorMessage: null })
    .where(eq(bloodTestAnalyses.id, analysisId));

  try {
    const obj = await env.MEDICAL_BUCKET.get(attachmentR2Key);
    if (obj === null) {
      throw new Error(`Attachment not found in R2: ${attachmentR2Key}`);
    }
    const buffer = await obj.arrayBuffer();
    const contentType = obj.httpMetadata?.contentType ?? "image/jpeg";

    const analyzer = createAnalyzer(env);
    // model 切替時に行の modelName が古いままにならないよう、analyze 直前で更新する。
    await db
      .update(bloodTestAnalyses)
      .set({ modelName: analyzer.modelName, updatedAt: new Date().toISOString() })
      .where(eq(bloodTestAnalyses.id, analysisId));

    const result = await analyzer.analyze({ imageBuffer: buffer, contentType });
    const finishedAt = new Date().toISOString();

    if (result.isErr()) {
      await db
        .update(bloodTestAnalyses)
        .set({
          status: "failed",
          errorMessage: formatAnalysisError(result.error),
          finishedAt,
          updatedAt: finishedAt,
        })
        .where(eq(bloodTestAnalyses.id, analysisId));
      return;
    }

    const { rawResponse, items } = result.value;

    // 再解析時の overwrite: 既存 values を delete-then-insert で全置換。
    // ユーザーの inline 編集 (reviewed=true) も消えるので UI 側で確認 popover を出す前提。
    await db.delete(bloodTestValues).where(eq(bloodTestValues.analysisId, analysisId));
    if (items.length > 0) {
      const now = new Date().toISOString();
      await db.insert(bloodTestValues).values(
        items.map((item) => ({
          id: crypto.randomUUID(),
          analysisId,
          itemCode: item.itemCode,
          itemLabel: item.itemLabel,
          unit: item.unit,
          valueText: item.valueText,
          valueNumeric: item.valueNumeric,
          refLow: item.refLow,
          refHigh: item.refHigh,
          refText: item.refText,
          flag: item.flag,
          notes: item.notes,
          rowIndex: item.rowIndex,
          reviewed: false,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    await db
      .update(bloodTestAnalyses)
      .set({
        status: "succeeded",
        rawResponse,
        finishedAt,
        updatedAt: finishedAt,
        errorMessage: null,
      })
      .where(eq(bloodTestAnalyses.id, analysisId));
  } catch (e) {
    const finishedAt = new Date().toISOString();
    await db
      .update(bloodTestAnalyses)
      .set({
        status: "failed",
        errorMessage: e instanceof Error ? e.message : String(e),
        finishedAt,
        updatedAt: finishedAt,
      })
      .where(eq(bloodTestAnalyses.id, analysisId));
  }
}

function formatAnalysisError(err: AnalysisError): string {
  switch (err.type) {
    case "parse_error":
      return `parse_error: ${err.message} (excerpt: ${err.rawExcerpt})`;
    case "validation_error":
      return `validation_error: ${err.message}`;
    case "model_error":
      return `model_error: ${err.message}`;
    case "io_error":
      return `io_error: ${err.message}`;
    case "not_found":
      return `not_found: ${err.id}`;
  }
}
