import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { bloodTestAnalyses, bloodTestValues } from "../../db/schema";
import type { AnalysisError } from "../../domain/blood-test-analysis";
import type { Bindings } from "../../types";
import { createAnalyzer } from "./factory";

export type AnalyzeWorkflowParams = {
  analysisId: string;
  r2Key: string;
};

// 血液検査画像の Vision LLM 解析を durable execution で走らせる Workflow。
// ctx.waitUntil の 30 秒制限を回避し、step 単位で retry + 状態 persist を効かせる。
//
// step 構成:
//   1. mark-running       — analysis row の status を pending → running に
//   2. fetch-and-analyze  — R2 read + analyzer.analyze() (retry 2 回、timeout 5 分)
//   3. persist-values     — values 全置換 + status='succeeded'
//   失敗時は最後の catch で mark-failed step を実行して error_message を残す。
//
// step.do() の return value は JSON serializable でないとダメなので、画像バイト列は
// fetch-and-analyze の中だけで保持して、step を跨いでは items + rawResponse + modelName
// (小さい JSON) のみ渡す。
export class AnalyzeBloodTestWorkflow extends WorkflowEntrypoint<Bindings, AnalyzeWorkflowParams> {
  async run(event: WorkflowEvent<AnalyzeWorkflowParams>, step: WorkflowStep) {
    const { analysisId, r2Key } = event.payload;
    const db = drizzle(this.env.DB);

    await step.do("mark-running", async () => {
      const startedAt = new Date().toISOString();
      await db
        .update(bloodTestAnalyses)
        .set({ status: "running", startedAt, updatedAt: startedAt, errorMessage: null })
        .where(eq(bloodTestAnalyses.id, analysisId));
    });

    try {
      const analyzed = await step.do(
        "fetch-and-analyze",
        {
          retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
          timeout: "5 minutes",
        },
        async () => {
          const obj = await this.env.MEDICAL_BUCKET.get(r2Key);
          if (obj === null) {
            throw new Error(`Attachment not found in R2: ${r2Key}`);
          }
          const buffer = await obj.arrayBuffer();
          const contentType = obj.httpMetadata?.contentType ?? "image/jpeg";

          const analyzer = createAnalyzer(this.env);
          const result = await analyzer.analyze({ imageBuffer: buffer, contentType });
          if (result.isErr()) {
            // throw すると step が retry される (limit 内なら)。limit 越えなら workflow 失敗。
            throw new Error(formatAnalysisError(result.error));
          }
          return {
            rawResponse: result.value.rawResponse,
            items: result.value.items,
            modelName: analyzer.modelName,
          };
        },
      );

      await step.do("persist-values", async () => {
        const finishedAt = new Date().toISOString();

        // 再解析時の overwrite: 既存 values を全削除 → 新規 insert
        await db.delete(bloodTestValues).where(eq(bloodTestValues.analysisId, analysisId));
        if (analyzed.items.length > 0) {
          await db.insert(bloodTestValues).values(
            analyzed.items.map((item) => ({
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
              createdAt: finishedAt,
              updatedAt: finishedAt,
            })),
          );
        }

        await db
          .update(bloodTestAnalyses)
          .set({
            status: "succeeded",
            modelName: analyzed.modelName,
            rawResponse: analyzed.rawResponse,
            finishedAt,
            updatedAt: finishedAt,
            errorMessage: null,
          })
          .where(eq(bloodTestAnalyses.id, analysisId));
      });
    } catch (e) {
      await step.do("mark-failed", async () => {
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
      });
      throw e; // workflow 自身も failed として記録
    }
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
