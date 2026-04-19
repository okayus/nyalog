import { z } from "zod";
import { ok, err, type Result } from "neverthrow";
import { CatId } from "./cat";

// --- Branded Types ---

export type ToiletRecordId = string & { readonly __brand: unique symbol };
export const ToiletRecordId = z
  .string()
  .uuid()
  .transform((v) => v as ToiletRecordId);

export type Timestamp = string & { readonly __brand: unique symbol };
export const Timestamp = z
  .string()
  .datetime({ offset: true })
  .refine((v) => Date.parse(v) <= Date.now() + 60_000, {
    message: "Timestamp must not be in the future",
  })
  .transform((v) => v as Timestamp);

// --- Enum ---

export const StoolCondition = z.enum(["normal", "soft", "diarrhea", "hard", "bloody"]);
export type StoolCondition = z.infer<typeof StoolCondition>;

// --- Domain Type (Discriminated Union) ---

type BaseRecord = {
  id: ToiletRecordId;
  catId: CatId;
  timestamp: Timestamp;
  createdAt: string;
  updatedAt: string;
};

export type ToiletRecord =
  | (BaseRecord & { type: "urination" })
  | (BaseRecord & { type: "defecation"; condition: StoolCondition });

// --- Domain Error ---

export type ToiletRecordError =
  | { type: "validation_error"; message: string; issues: z.ZodIssue[] }
  | { type: "not_found"; id: string }
  | { type: "cat_not_found"; catId: string };

// --- Validation Schemas ---

const UrinationCreate = z.object({
  type: z.literal("urination"),
  timestamp: Timestamp,
});

const DefecationCreate = z.object({
  type: z.literal("defecation"),
  timestamp: Timestamp,
  condition: StoolCondition,
});

export const CreateToiletRecordSchema = z.discriminatedUnion("type", [
  UrinationCreate,
  DefecationCreate,
]);

export const UpdateToiletRecordSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("urination"),
    timestamp: Timestamp.optional(),
  }),
  z.object({
    type: z.literal("defecation"),
    timestamp: Timestamp.optional(),
    condition: StoolCondition.optional(),
  }),
]);

// --- DB Row Schema (境界での再パース用) ---
// DB は urination 行でも condition カラムを null で持つが、
// z.object は未定義キーを strip するので、urination スキーマ側で condition を
// 宣言しなくても通る。defecation では StoolCondition が null を弾くため、
// type = defecation なのに condition が null なら DB 不変条件違反として ZodError で落ちる。

const toiletRecordRowBase = {
  id: ToiletRecordId,
  catId: CatId,
  timestamp: Timestamp,
  createdAt: z.string(),
  updatedAt: z.string(),
};

export const ToiletRecordRowSchema = z.discriminatedUnion("type", [
  z.object({ ...toiletRecordRowBase, type: z.literal("urination") }),
  z.object({ ...toiletRecordRowBase, type: z.literal("defecation"), condition: StoolCondition }),
]);

// --- Pure Validation Functions ---

export function parseToiletRecordId(input: string): Result<ToiletRecordId, ToiletRecordError> {
  const result = ToiletRecordId.safeParse(input);
  if (!result.success) {
    return err({
      type: "validation_error",
      message: "Invalid toilet record ID",
      issues: result.error.issues,
    });
  }
  return ok(result.data);
}

export function parseCreateToiletRecord(
  input: unknown,
): Result<z.infer<typeof CreateToiletRecordSchema>, ToiletRecordError> {
  const result = CreateToiletRecordSchema.safeParse(input);
  if (!result.success) {
    return err({
      type: "validation_error",
      message: "Invalid toilet record data",
      issues: result.error.issues,
    });
  }
  return ok(result.data);
}

export function parseUpdateToiletRecord(
  input: unknown,
): Result<z.infer<typeof UpdateToiletRecordSchema>, ToiletRecordError> {
  const result = UpdateToiletRecordSchema.safeParse(input);
  if (!result.success) {
    return err({
      type: "validation_error",
      message: "Invalid toilet record data",
      issues: result.error.issues,
    });
  }
  return ok(result.data);
}
