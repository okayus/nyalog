import { err, ok, type Result } from "neverthrow";
import { parseGemmaJsonResponse, type AnalysisError } from "../../domain/blood-test-analysis";
import { BLOOD_TEST_EXTRACTION_PROMPT } from "./prompt";
import type { AnalyzerInput, AnalyzerOutput, BloodTestAnalyzer } from "./types";

// Workers AI vision Gemma を使った血液検査画像解析。
// 2026-08: 旧 default の "@cf/google/gemma-3-12b-it" は 2026-05-30 の catalog 整理で
// deprecated になったため、Cloudflare 推奨の後継に移行 (ADR-007 Addendum)。
// gemma-4 は MoE (26B 中 4B active) で vision 対応、Workers Free plan でも呼べる。
const DEFAULT_MODEL = "@cf/google/gemma-4-26b-a4b-it";

// gemma-4 は OpenAI 互換の chat completions schema を取る。旧 gemma-3 の
// { prompt, image: number[] } → { response } とは入出力ごと別物なので、model id
// だけ差し替えても動かない。画像は content part に data URI で載せる。
type AiChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };
type AiChatInput = {
  messages: { role: "user"; content: AiChatContentPart[] }[];
  max_completion_tokens?: number;
  response_format?: { type: "json_object" };
};
type AiChatOutput = { choices?: { message?: { content?: string | null } }[] };
type AiChatRunner = (model: string, input: AiChatInput) => Promise<AiChatOutput>;

// btoa は latin1 文字列を取るので、画像 bytes を一旦 charcode 列にする。その際
// String.fromCharCode(...bytes) の spread は引数個数の上限に当たり、添付上限の
// 10MB (MAX_ATTACHMENT_SIZE_BYTES) では call stack を溢れさせる。分割して連結する。
// btoa 自体は長い文字列を扱えるので分割は fromCharCode 側だけでよく、chunk 幅が
// 3 の倍数である必要もない。
const CHARCODE_CHUNK_BYTES = 0x8000;

export function toImageDataUri(buffer: ArrayBuffer, contentType: string): string {
  const bytes = new Uint8Array(buffer);
  let latin1 = "";
  for (let i = 0; i < bytes.length; i += CHARCODE_CHUNK_BYTES) {
    latin1 += String.fromCharCode(...bytes.subarray(i, i + CHARCODE_CHUNK_BYTES));
  }
  return `data:${contentType};base64,${btoa(latin1)}`;
}

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
      const run = this.ai.run.bind(this.ai) as unknown as AiChatRunner;
      const response = await run(this.modelName, {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: BLOOD_TEST_EXTRACTION_PROMPT },
              {
                type: "image_url",
                image_url: { url: toImageDataUri(input.imageBuffer, input.contentType) },
              },
            ],
          },
        ],
        max_completion_tokens: 4096,
        // parseGemmaJsonResponse は応答全体が 1 個の JSON であることを要求する
        // (前置きの散文が付くと parse_error)。gemma-4 は reasoning 系なので
        // プロンプトの「JSON のみ」だけに頼らず schema 側でも縛る。
        response_format: { type: "json_object" },
      });

      const raw = response.choices?.[0]?.message?.content ?? "";
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
