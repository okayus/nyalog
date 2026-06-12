import { ok, type Result } from "neverthrow";
import type { AnalysisError, ExtractedItem } from "../../domain/blood-test-analysis";
import type { AnalyzerInput, AnalyzerOutput, BloodTestAnalyzer } from "./types";

// credential ゼロのローカル開発・e2e (wrangler.local.jsonc, ADR-008) 用の analyzer。
// Workers AI にはローカルシミュレーションが無いため、dev では実モデルの代わりに
// この固定値を返す。実モデル (workers-ai-gemma) の検証は本番デプロイ後に行う。
//
// 値は「腎臓値が高めの猫」の典型パターン: high フラグの UI 表示・基準値レンジ・
// 辞書由来の itemCode (BUN/CRE/ALB) が dev で一通り確認できるようにしてある。
const MOCK_ITEMS: ExtractedItem[] = [
  {
    itemCode: "BUN",
    itemLabel: "血中尿素窒素",
    unit: "mg/dL",
    valueText: "38.2",
    valueNumeric: 38.2,
    refLow: 17.6,
    refHigh: 32.8,
    refText: "17.6-32.8",
    flag: "high",
    notes: null,
    rowIndex: 0,
  },
  {
    itemCode: "CRE",
    itemLabel: "腎臓機能",
    unit: "mg/dL",
    valueText: "1.6",
    valueNumeric: 1.6,
    refLow: 0.8,
    refHigh: 2.4,
    refText: "0.8-2.4",
    flag: "normal",
    notes: null,
    rowIndex: 1,
  },
  {
    itemCode: "ALB",
    itemLabel: "アルブミン",
    unit: "g/dL",
    valueText: "3.1",
    valueNumeric: 3.1,
    refLow: 2.3,
    refHigh: 3.5,
    refText: "2.3-3.5",
    flag: "normal",
    notes: null,
    rowIndex: 2,
  },
];

export function createMockAnalyzer(): BloodTestAnalyzer {
  return {
    modelName: "mock",
    analyze: async (_input: AnalyzerInput): Promise<Result<AnalyzerOutput, AnalysisError>> =>
      ok({
        rawResponse: JSON.stringify({ items: MOCK_ITEMS }),
        items: MOCK_ITEMS,
      }),
  };
}
