import { z } from "zod";
import { ok, err, type Result } from "neverthrow";

// 一覧取得の「窓」(?since= / ?limit= / ?offset=)。トイレ記録と体重記録が共有する。
//
// since に Timestamp brand (未来を弾く refine 付き) を使わないのは、これが記録そのものの
// 時刻ではなく絞り込みの下限だから。意味の違う値に同じ型を当てない。

export const MAX_LIST_LIMIT = 500;

export type ListQueryError = {
  type: "validation_error";
  message: string;
  issues: z.ZodIssue[];
};

export const ListQuerySchema = z
  .object({
    since: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  // offset 単独では窓にならない (SQLite は LIMIT を伴わない OFFSET を受け付けない)。
  // limit とペアでしか意味を持たない制約なので、SQL を組む前にスキーマ側で閉じる。
  .refine((q) => q.offset === undefined || q.limit !== undefined, {
    message: "offset requires limit",
    path: ["offset"],
  });

export type ListQuery = z.infer<typeof ListQuerySchema>;

export function parseListQuery(input: unknown): Result<ListQuery, ListQueryError> {
  const result = ListQuerySchema.safeParse(input);
  if (!result.success) {
    return err({
      type: "validation_error",
      message: "Invalid list query",
      issues: result.error.issues,
    });
  }
  return ok(result.data);
}
