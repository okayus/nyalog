import { createMockAnalyzer } from "./mock";
import { WorkersAIGemmaAnalyzer } from "./workers-ai-gemma";
import type { BloodTestAnalyzer } from "./types";

export type AnalyzerEnv = {
  // wrangler.local.jsonc (credential ゼロの dev/e2e, ADR-008) には `ai` binding が
  // 無いので AI は undefined。そこでは ANALYZER_MODEL が "mock" に固定されている。
  AI: Ai | undefined;
  ANALYZER_MODEL: string;
};

// env.ANALYZER_MODEL から analyzer 実装を選ぶ。未対応値は Gemma にフォールバック。
// 将来 "claude-sonnet-4-6" 等を増やす時はここに 1 case 追加する。
export function createAnalyzer(env: AnalyzerEnv): BloodTestAnalyzer {
  switch (env.ANALYZER_MODEL) {
    case "mock":
      return createMockAnalyzer();
    case "workers-ai-gemma":
    default:
      if (env.AI === undefined) {
        // ai binding なしで実モデルを選ぶのは構成不整合 (domain エラーではなく設定欠陥)。
        // 呼び出し元は workflow の step 内なので、throw は retry → mark-failed に乗る。
        throw new Error(
          `ANALYZER_MODEL "${env.ANALYZER_MODEL}" requires the ai binding; ` +
            `wrangler.local.jsonc must keep ANALYZER_MODEL="mock"`,
        );
      }
      return new WorkersAIGemmaAnalyzer(env.AI);
  }
}
