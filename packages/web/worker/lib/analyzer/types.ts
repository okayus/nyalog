import type { Result } from "neverthrow";
import type { AnalysisError, ExtractedItem } from "../../domain/blood-test-analysis";

export type AnalyzerInput = {
  imageBuffer: ArrayBuffer;
  contentType: string;
};

export type AnalyzerOutput = {
  rawResponse: string;
  items: ExtractedItem[];
};

// Vision LLM での血液検査画像解析の境界。
// 初期実装は WorkersAIGemmaAnalyzer。将来 ClaudeVisionAnalyzer 等を
// この interface に合わせて 1 ファイル追加するだけで差し替え可能にする。
export interface BloodTestAnalyzer {
  readonly modelName: string;
  analyze(input: AnalyzerInput): Promise<Result<AnalyzerOutput, AnalysisError>>;
}
