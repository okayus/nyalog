import { WorkersAIGemmaAnalyzer } from "./workers-ai-gemma";
import type { BloodTestAnalyzer } from "./types";

export type AnalyzerEnv = {
  AI: Ai;
  ANALYZER_MODEL: string;
};

// env.ANALYZER_MODEL から analyzer 実装を選ぶ。未対応値は Gemma にフォールバック。
// 将来 "claude-sonnet-4-6" 等を増やす時はここに 1 case 追加する。
export function createAnalyzer(env: AnalyzerEnv): BloodTestAnalyzer {
  switch (env.ANALYZER_MODEL) {
    case "workers-ai-gemma":
    default:
      return new WorkersAIGemmaAnalyzer(env.AI);
  }
}
