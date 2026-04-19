import { z } from "zod";
import { ok, err, type Result } from "neverthrow";

// --- Branded Types ---

export type CatId = string & { readonly __brand: unique symbol };
export const CatId = z
  .string()
  .uuid()
  .transform((v) => v as CatId);

export type CatName = string & { readonly __brand: unique symbol };
export const CatName = z
  .string()
  .min(1)
  .max(50)
  .transform((v) => v as CatName);

export type Birthday = string & { readonly __brand: unique symbol };
export const Birthday = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Birthday must be YYYY-MM-DD format")
  .refine((d) => !Number.isNaN(Date.parse(d)), {
    message: "Invalid date",
  })
  .transform((v) => v as Birthday);

export const THEME_COLORS = [
  "gray",
  "pink",
  "blue",
  "mint",
  "peach",
  "lavender",
  "yellow",
] as const;
export type ThemeColor = (typeof THEME_COLORS)[number] & { readonly __brand: unique symbol };
export const ThemeColor = z.enum(THEME_COLORS).transform((v) => v as ThemeColor);

export const DEFAULT_THEME_COLOR: ThemeColor = ThemeColor.parse(THEME_COLORS[0]);

// --- Domain Type ---

export type Cat = {
  id: CatId;
  name: CatName;
  birthday: Birthday | null;
  themeColor: ThemeColor;
  createdAt: string;
  updatedAt: string;
};

// --- DB Row Schema (境界での再パース用) ---
// DB 読み取りは外部境界。Drizzle の型は文字列そのものを返すので、
// Branded Type への昇格はここで Zod を通して行う。失敗は DB 不変条件違反＝バグ。

export const CatRowSchema = z.object({
  id: CatId,
  name: CatName,
  birthday: Birthday.nullable(),
  themeColor: ThemeColor,
  createdAt: z.string(),
  updatedAt: z.string(),
});

// --- Domain Error ---

export type CatError =
  | { type: "validation_error"; message: string; issues: z.ZodIssue[] }
  | { type: "not_found"; id: string };

// --- Validation Schemas ---

export const CreateCatSchema = z.object({
  name: CatName,
  birthday: Birthday.nullable().optional().default(null),
  themeColor: ThemeColor.optional(),
});

export const UpdateCatSchema = z.object({
  name: CatName.optional(),
  birthday: Birthday.nullable().optional(),
  themeColor: ThemeColor.optional(),
});

// --- Pure Validation Functions ---

export function parseCreateCat(input: unknown): Result<z.infer<typeof CreateCatSchema>, CatError> {
  const result = CreateCatSchema.safeParse(input);
  if (!result.success) {
    return err({
      type: "validation_error",
      message: "Invalid cat data",
      issues: result.error.issues,
    });
  }
  return ok(result.data);
}

export function parseUpdateCat(input: unknown): Result<z.infer<typeof UpdateCatSchema>, CatError> {
  const result = UpdateCatSchema.safeParse(input);
  if (!result.success) {
    return err({
      type: "validation_error",
      message: "Invalid cat data",
      issues: result.error.issues,
    });
  }
  return ok(result.data);
}

export function parseCatId(input: string): Result<CatId, CatError> {
  const result = CatId.safeParse(input);
  if (!result.success) {
    return err({
      type: "validation_error",
      message: "Invalid cat ID",
      issues: result.error.issues,
    });
  }
  return ok(result.data);
}
