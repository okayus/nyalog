import { z } from "zod";
import { ok, err, type Result } from "neverthrow";
import { AttachmentId } from "./medical-record";
import { lookupItemCode } from "./blood-test-items";

// --- Branded Types ---

export type AnalysisId = string & { readonly __brand: unique symbol };
export const AnalysisId = z
  .string()
  .uuid()
  .transform((v) => v as AnalysisId);

export type ValueId = string & { readonly __brand: unique symbol };
export const ValueId = z
  .string()
  .uuid()
  .transform((v) => v as ValueId);

// --- Enums ---

export const ANALYSIS_STATUSES = ["pending", "running", "succeeded", "failed"] as const;
export const AnalysisStatus = z.enum(ANALYSIS_STATUSES);
export type AnalysisStatus = z.infer<typeof AnalysisStatus>;

export const VALUE_FLAGS = ["normal", "high", "low", "abnormal", "unknown"] as const;
export const ValueFlag = z.enum(VALUE_FLAGS);
export type ValueFlag = z.infer<typeof ValueFlag>;

// --- Domain Types ---

export type BloodTestAnalysis = {
  id: AnalysisId;
  attachmentId: AttachmentId;
  status: AnalysisStatus;
  modelName: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  rawResponse: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BloodTestValue = {
  id: ValueId;
  analysisId: AnalysisId;
  itemCode: string;
  itemLabel: string;
  unit: string | null;
  valueText: string;
  valueNumeric: number | null;
  refLow: number | null;
  refHigh: number | null;
  refText: string | null;
  flag: ValueFlag;
  notes: string | null;
  rowIndex: number;
  reviewed: boolean;
  createdAt: string;
  updatedAt: string;
};

// AI 抽出の中間表現 (DB 保存前)
export type ExtractedItem = {
  itemCode: string;
  itemLabel: string;
  unit: string | null;
  valueText: string;
  valueNumeric: number | null;
  refLow: number | null;
  refHigh: number | null;
  refText: string | null;
  flag: ValueFlag;
  notes: string | null;
  rowIndex: number;
};

// --- Domain Error ---

export type AnalysisError =
  | { type: "parse_error"; message: string; rawExcerpt: string }
  | { type: "validation_error"; message: string; issues: z.ZodIssue[] }
  | { type: "model_error"; message: string }
  | { type: "io_error"; message: string }
  | { type: "not_found"; id: string };

// --- DB Row Schemas (境界での再パース用) ---

export const BloodTestAnalysisRowSchema = z.object({
  id: AnalysisId,
  attachmentId: AttachmentId,
  status: AnalysisStatus,
  modelName: z.string().min(1),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
  rawResponse: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const BloodTestValueRowSchema = z.object({
  id: ValueId,
  analysisId: AnalysisId,
  itemCode: z.string().min(1),
  itemLabel: z.string().min(1),
  unit: z.string().nullable(),
  valueText: z.string().min(1),
  valueNumeric: z.number().nullable(),
  refLow: z.number().nullable(),
  refHigh: z.number().nullable(),
  refText: z.string().nullable(),
  flag: ValueFlag,
  notes: z.string().nullable(),
  rowIndex: z.number().int().nonnegative(),
  reviewed: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// --- AI Response Schema ---
// Workers AI / Claude / etc. すべての analyzer が共通で返す JSON shape。
// プロンプトでこの shape を強制する。
const ExtractedItemRawSchema = z.object({
  itemCode: z.string().max(50).nullable().optional(),
  itemLabel: z.string().min(1).max(100),
  unit: z.string().max(30).nullable().optional(),
  valueText: z.string().min(1).max(50),
  valueNumeric: z.number().nullable().optional(),
  refLow: z.number().nullable().optional(),
  refHigh: z.number().nullable().optional(),
  refText: z.string().max(100).nullable().optional(),
  flag: ValueFlag.nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

const ExtractedItemsResponseSchema = z.object({
  items: z.array(ExtractedItemRawSchema),
});

// --- Pure Functions ---

// 数値と基準値の比較 + AI hint からの flag 推定。AI が flag を出していれば素通し。
export function normalizeFlag(
  value: number | null,
  refLow: number | null,
  refHigh: number | null,
  hint: string | null,
): ValueFlag {
  // 1. notes に明示的な異常マーカーがあれば優先
  if (hint) {
    if (/(低|↓|low)/i.test(hint)) return "low";
    if (/(高|↑|high)/i.test(hint)) return "high";
    if (/(異常|abnormal)/i.test(hint)) return "abnormal";
  }
  // 2. 数値と基準値の比較
  if (value === null) return "unknown";
  if (refLow !== null && value < refLow) return "low";
  if (refHigh !== null && value > refHigh) return "high";
  if (refLow !== null || refHigh !== null) return "normal";
  return "unknown";
}

// AI 出力 (JSON 文字列) を ExtractedItem[] にパース。
// マークダウン code fence (```json ... ```) が混入していても剥がす。
export function parseGemmaJsonResponse(raw: string): Result<ExtractedItem[], AnalysisError> {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return err({
      type: "parse_error",
      message: e instanceof Error ? e.message : "JSON parse failed",
      rawExcerpt: cleaned.slice(0, 500),
    });
  }

  const result = ExtractedItemsResponseSchema.safeParse(parsed);
  if (!result.success) {
    return err({
      type: "validation_error",
      message: "AI response shape mismatch",
      issues: result.error.issues,
    });
  }

  return ok(
    result.data.items.map((item, i) => {
      const rawCode = item.itemCode?.trim();
      const itemCode = rawCode && rawCode.length > 0 ? rawCode : lookupItemCode(item.itemLabel);
      const valueNumeric = item.valueNumeric ?? null;
      const refLow = item.refLow ?? null;
      const refHigh = item.refHigh ?? null;
      const notes = item.notes ?? null;
      const aiFlag = item.flag ?? null;
      const flag = aiFlag ?? normalizeFlag(valueNumeric, refLow, refHigh, notes);
      return {
        itemCode,
        itemLabel: item.itemLabel,
        unit: item.unit ?? null,
        valueText: item.valueText,
        valueNumeric,
        refLow,
        refHigh,
        refText: item.refText ?? null,
        flag,
        notes,
        rowIndex: i,
      };
    }),
  );
}

// --- ID parsers ---

export function parseAnalysisId(input: string): Result<AnalysisId, AnalysisError> {
  const result = AnalysisId.safeParse(input);
  if (!result.success) {
    return err({
      type: "validation_error",
      message: "Invalid analysis ID",
      issues: result.error.issues,
    });
  }
  return ok(result.data);
}

export function parseValueId(input: string): Result<ValueId, AnalysisError> {
  const result = ValueId.safeParse(input);
  if (!result.success) {
    return err({
      type: "validation_error",
      message: "Invalid value ID",
      issues: result.error.issues,
    });
  }
  return ok(result.data);
}

// --- Input Schemas (PR 2 の API で使う) ---

export const CreateBloodTestValueSchema = z.object({
  itemCode: z.string().min(1).max(50),
  itemLabel: z.string().min(1).max(100),
  unit: z.string().max(30).nullable(),
  valueText: z.string().min(1).max(50),
  valueNumeric: z.number().nullable(),
  refLow: z.number().nullable(),
  refHigh: z.number().nullable(),
  refText: z.string().max(100).nullable(),
  flag: ValueFlag,
  notes: z.string().max(500).nullable(),
});

export const UpdateBloodTestValueSchema = CreateBloodTestValueSchema.partial();

export function parseCreateBloodTestValue(
  input: unknown,
): Result<z.infer<typeof CreateBloodTestValueSchema>, AnalysisError> {
  const result = CreateBloodTestValueSchema.safeParse(input);
  if (!result.success) {
    return err({
      type: "validation_error",
      message: "Invalid value input",
      issues: result.error.issues,
    });
  }
  return ok(result.data);
}

export function parseUpdateBloodTestValue(
  input: unknown,
): Result<z.infer<typeof UpdateBloodTestValueSchema>, AnalysisError> {
  const result = UpdateBloodTestValueSchema.safeParse(input);
  if (!result.success) {
    return err({
      type: "validation_error",
      message: "Invalid value update",
      issues: result.error.issues,
    });
  }
  return ok(result.data);
}
