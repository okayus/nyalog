import { z } from "zod";
import { ok, err, type Result } from "neverthrow";
import { CatId } from "./cat";

// --- Branded Types ---

export type WeightRecordId = string & { readonly __brand: unique symbol };
export const WeightRecordId = z
  .string()
  .uuid()
  .transform((v) => v as WeightRecordId);

// 家猫の現実上限 (バリ猫含む) を 50 kg とし、0g / 負値 / 異常に大きい値を弾く。
export type WeightGrams = number & { readonly __brand: unique symbol };
export const WeightGrams = z
  .number()
  .int()
  .positive()
  .max(50_000)
  .transform((v) => v as WeightGrams);

export type MeasuredAt = string & { readonly __brand: unique symbol };
export const MeasuredAt = z
  .string()
  .datetime({ offset: true })
  .refine((v) => Date.parse(v) <= Date.now() + 60_000, {
    message: "MeasuredAt must not be in the future",
  })
  .transform((v) => v as MeasuredAt);

// --- Domain Type ---

export type WeightRecord = {
  id: WeightRecordId;
  catId: CatId;
  weightGrams: WeightGrams;
  measuredAt: MeasuredAt;
  createdAt: string;
  updatedAt: string;
};

// --- Domain Error ---

export type WeightRecordError =
  | { type: "validation_error"; message: string; issues: z.ZodIssue[] }
  | { type: "not_found"; id: string }
  | { type: "cat_not_found"; catId: string };

// --- Validation Schemas ---

export const CreateWeightRecordSchema = z.object({
  weightGrams: WeightGrams,
  measuredAt: MeasuredAt,
});

export const UpdateWeightRecordSchema = z.object({
  weightGrams: WeightGrams.optional(),
  measuredAt: MeasuredAt.optional(),
});

// --- DB Row Schema (境界での再パース用) ---

export const WeightRecordRowSchema = z.object({
  id: WeightRecordId,
  catId: CatId,
  weightGrams: WeightGrams,
  measuredAt: MeasuredAt,
  createdAt: z.string(),
  updatedAt: z.string(),
});

// --- Pure Validation Functions ---

export function parseWeightRecordId(input: string): Result<WeightRecordId, WeightRecordError> {
  const result = WeightRecordId.safeParse(input);
  if (!result.success) {
    return err({
      type: "validation_error",
      message: "Invalid weight record ID",
      issues: result.error.issues,
    });
  }
  return ok(result.data);
}

export function parseCreateWeightRecord(
  input: unknown,
): Result<z.infer<typeof CreateWeightRecordSchema>, WeightRecordError> {
  const result = CreateWeightRecordSchema.safeParse(input);
  if (!result.success) {
    return err({
      type: "validation_error",
      message: "Invalid weight record data",
      issues: result.error.issues,
    });
  }
  return ok(result.data);
}

export function parseUpdateWeightRecord(
  input: unknown,
): Result<z.infer<typeof UpdateWeightRecordSchema>, WeightRecordError> {
  const result = UpdateWeightRecordSchema.safeParse(input);
  if (!result.success) {
    return err({
      type: "validation_error",
      message: "Invalid weight record data",
      issues: result.error.issues,
    });
  }
  return ok(result.data);
}
