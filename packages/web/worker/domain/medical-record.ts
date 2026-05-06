import { z } from "zod";
import { ok, err, type Result } from "neverthrow";
import { CatId } from "./cat";

// --- Branded Types ---

export type MedicalRecordId = string & { readonly __brand: unique symbol };
export const MedicalRecordId = z
  .string()
  .uuid()
  .transform((v) => v as MedicalRecordId);

export type AttachmentId = string & { readonly __brand: unique symbol };
export const AttachmentId = z
  .string()
  .uuid()
  .transform((v) => v as AttachmentId);

export type RecordedAt = string & { readonly __brand: unique symbol };
export const RecordedAt = z
  .string()
  .datetime({ offset: true })
  .refine((v) => Date.parse(v) <= Date.now() + 60_000, {
    message: "RecordedAt must not be in the future",
  })
  .transform((v) => v as RecordedAt);

// --- Attachment Constraints ---

export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const;
export const AttachmentContentType = z.enum(ALLOWED_ATTACHMENT_MIME_TYPES);
export type AttachmentContentType = z.infer<typeof AttachmentContentType>;

export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;

// --- Domain Type (Discriminated Union) ---
// 現状 blood_test と other は同 shape だが、将来 vaccination / urinalysis / x_ray を
// 種別ごと固有フィールド付きで足す前提で Discriminated Union のまま宣言しておく。

type BaseRecord = {
  id: MedicalRecordId;
  catId: CatId;
  recordedAt: RecordedAt;
  title: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MedicalRecord =
  | (BaseRecord & { type: "blood_test" })
  | (BaseRecord & { type: "other" });

export type MedicalRecordAttachment = {
  id: AttachmentId;
  medicalRecordId: MedicalRecordId;
  r2Key: string;
  contentType: AttachmentContentType;
  sizeBytes: number;
  originalFilename: string | null;
  createdAt: string;
};

// --- Domain Error ---

export type MedicalRecordError =
  | { type: "validation_error"; message: string; issues: z.ZodIssue[] }
  | { type: "not_found"; id: string }
  | { type: "cat_not_found"; catId: string }
  | { type: "attachment_not_found"; id: string }
  | { type: "attachment_too_large"; sizeBytes: number; maxBytes: number }
  | { type: "attachment_type_not_allowed"; contentType: string };

// --- DB Row Schemas (境界での再パース用) ---

const titleField = z.string().min(1).max(100).nullable();
const notesField = z.string().min(1).max(2000).nullable();

const medicalRecordRowBase = {
  id: MedicalRecordId,
  catId: CatId,
  recordedAt: RecordedAt,
  title: titleField,
  notes: notesField,
  createdAt: z.string(),
  updatedAt: z.string(),
};

export const MedicalRecordRowSchema = z.discriminatedUnion("type", [
  z.object({ ...medicalRecordRowBase, type: z.literal("blood_test") }),
  z.object({ ...medicalRecordRowBase, type: z.literal("other") }),
]);

export const MedicalRecordAttachmentRowSchema = z.object({
  id: AttachmentId,
  medicalRecordId: MedicalRecordId,
  r2Key: z.string().min(1),
  contentType: AttachmentContentType,
  sizeBytes: z.number().int().nonnegative(),
  originalFilename: z.string().nullable(),
  createdAt: z.string(),
});

// --- Validation Schemas (入力境界) ---

const titleInput = z.string().min(1).max(100).nullish();
const notesInput = z.string().min(1).max(2000).nullish();

const bloodTestCreate = z.object({
  type: z.literal("blood_test"),
  recordedAt: RecordedAt,
  title: titleInput,
  notes: notesInput,
});

const otherCreate = z.object({
  type: z.literal("other"),
  recordedAt: RecordedAt,
  title: titleInput,
  notes: notesInput,
});

export const CreateMedicalRecordSchema = z.discriminatedUnion("type", [
  bloodTestCreate,
  otherCreate,
]);

export const UpdateMedicalRecordSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("blood_test"),
    recordedAt: RecordedAt.optional(),
    title: titleInput,
    notes: notesInput,
  }),
  z.object({
    type: z.literal("other"),
    recordedAt: RecordedAt.optional(),
    title: titleInput,
    notes: notesInput,
  }),
]);

// --- Pure Validation Functions ---

export function parseMedicalRecordId(input: string): Result<MedicalRecordId, MedicalRecordError> {
  const result = MedicalRecordId.safeParse(input);
  if (!result.success) {
    return err({
      type: "validation_error",
      message: "Invalid medical record ID",
      issues: result.error.issues,
    });
  }
  return ok(result.data);
}

export function parseAttachmentId(input: string): Result<AttachmentId, MedicalRecordError> {
  const result = AttachmentId.safeParse(input);
  if (!result.success) {
    return err({
      type: "validation_error",
      message: "Invalid attachment ID",
      issues: result.error.issues,
    });
  }
  return ok(result.data);
}

export function parseCreateMedicalRecord(
  input: unknown,
): Result<z.infer<typeof CreateMedicalRecordSchema>, MedicalRecordError> {
  const result = CreateMedicalRecordSchema.safeParse(input);
  if (!result.success) {
    return err({
      type: "validation_error",
      message: "Invalid medical record data",
      issues: result.error.issues,
    });
  }
  return ok(result.data);
}

export function parseUpdateMedicalRecord(
  input: unknown,
): Result<z.infer<typeof UpdateMedicalRecordSchema>, MedicalRecordError> {
  const result = UpdateMedicalRecordSchema.safeParse(input);
  if (!result.success) {
    return err({
      type: "validation_error",
      message: "Invalid medical record data",
      issues: result.error.issues,
    });
  }
  return ok(result.data);
}
