import { err, ok, type Result } from "neverthrow";
import { parseGemmaJsonResponse, type AnalysisError } from "../../domain/blood-test-analysis";
import { BLOOD_TEST_EXTRACTION_PROMPT } from "./prompt";
import type { AnalyzerInput, AnalyzerOutput, BloodTestAnalyzer } from "./types";

// Workers AI vision Gemma を使った血液検査画像解析。
// 採用候補モデル (実装時に Workers AI docs で最新を確認):
//   - "@cf/google/gemma-3-12b-it" (現行 docs に記載、vision 対応)
//   - "@cf/google/gemma-4-26b-a4b-it" (2026-04 changelog で発表、OCR/handwriting に明示対応)
// 第一弾は 12B から始め、PR 2 の手動 e2e で精度を見て 26B に切替検討。
const DEFAULT_MODEL = "@cf/google/gemma-3-12b-it";

// Workers AI の `run()` は model id によって input/output が overload されている。
// vision モデルは prompt + image (バイト配列) + テキスト出力 という共通形を取るので
// その形に narrow した型を最小限で宣言する。
type AiVisionInput = {
  prompt: string;
  image: number[];
  max_tokens?: number;
};
type AiVisionOutput = { response: string };
type AiVisionRunner = (model: string, input: AiVisionInput) => Promise<AiVisionOutput>;

export class WorkersAIGemmaAnalyzer implements BloodTestAnalyzer {
  readonly modelName: string;

  constructor(
    private readonly ai: Ai,
    modelName: string = DEFAULT_MODEL,
  ) {
    this.modelName = modelName;
  }

  async analyze(input: AnalyzerInput): Promise<Result<AnalyzerOutput, AnalysisError>> {
    try {
      // 型 cast: Workers AI の strict overload を 1 つの汎用シグネチャに narrow して呼ぶ。
      // 受け取った string id でランタイム動作するのが Workers AI の実態。
      const run = this.ai.run.bind(this.ai) as unknown as AiVisionRunner;
      const response = await run(this.modelName, {
        prompt: BLOOD_TEST_EXTRACTION_PROMPT,
        image: Array.from(new Uint8Array(input.imageBuffer)),
        max_tokens: 4096,
      });

      const raw = response.response ?? "";
      if (!raw) {
        return err({ type: "model_error", message: "Empty response from Workers AI" });
      }

      const parsed = parseGemmaJsonResponse(raw);
      if (parsed.isErr()) {
        return err(parsed.error);
      }
      return ok({ rawResponse: raw, items: parsed.value });
    } catch (e) {
      return err({
        type: "io_error",
        message: e instanceof Error ? e.message : "Workers AI call failed",
      });
    }
  }
}
