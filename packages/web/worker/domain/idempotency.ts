import { z } from "zod";
import { ok, err, type Result } from "neverthrow";

// Idempotency-Key の純粋な判定 (ADR-009 §2)。D1 を触る部分は lib/idempotency.ts。

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
export const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// 1〜128 文字の表示可能 ASCII (空白なし)。送信側が UUID に "/urination" を足した形も通る。
export type IdempotencyKey = string & { readonly __brand: unique symbol };
export const IdempotencyKey = z
  .string()
  .regex(/^[\x21-\x7E]{1,128}$/, "Idempotency-Key must be 1-128 visible ASCII characters")
  .transform((v) => v as IdempotencyKey);

export type IdempotencyError =
  | { type: "validation_error"; message: string; issues: z.ZodIssue[] }
  // 同じ key で違う内容が来た。再送しても直らないので送信側は要確認に落とす
  | { type: "idempotency_key_mismatch"; message: string };

export function idempotencyErrorResponse(error: IdempotencyError): {
  body: { error: IdempotencyError };
  status: 400 | 422;
} {
  switch (error.type) {
    case "validation_error":
      return { body: { error }, status: 400 };
    case "idempotency_key_mismatch":
      return { body: { error }, status: 422 };
  }
}

// ヘッダ無しは null (冪等化しない、従来どおり毎回 201)。
export function parseIdempotencyKey(
  raw: string | undefined,
): Result<IdempotencyKey | null, IdempotencyError> {
  if (raw === undefined) return ok(null);
  const r = IdempotencyKey.safeParse(raw);
  if (!r.success) {
    return err({
      type: "validation_error",
      message: "Invalid Idempotency-Key header",
      issues: r.error.issues,
    });
  }
  return ok(r.data);
}

// キー順を固定した JSON。request_hash の入力に使う。配列は順序を保つ。
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
  }
  return value;
}

export type StoredResponse = {
  requestHash: string;
  responseStatus: number;
  responseBody: string;
  createdAt: string;
};

export type ReplayDecision =
  | { kind: "fresh" }
  | { kind: "replay"; status: 200; body: Record<string, unknown> }
  | { kind: "mismatch" };

// 行が無い、または 30 日を過ぎた行は無いものとして扱う (purge は書き込み時に行う)。
// 再送には保存した本文を 200 で返す。201 と区別するのは、送信側が「いま作った」と
// 「既に処理済み」を分けられるようにするため (kakitome docs/06 の応答表と同じ)。
export function replayDecision(
  stored: StoredResponse | undefined,
  requestHash: string,
  now: Date,
): ReplayDecision {
  if (!stored) return { kind: "fresh" };
  if (now.getTime() - new Date(stored.createdAt).getTime() >= IDEMPOTENCY_TTL_MS) {
    return { kind: "fresh" };
  }
  if (stored.requestHash !== requestHash) return { kind: "mismatch" };
  return {
    kind: "replay",
    status: 200,
    body: JSON.parse(stored.responseBody) as Record<string, unknown>,
  };
}

export function idempotencyCutoff(now: Date): string {
  return new Date(now.getTime() - IDEMPOTENCY_TTL_MS).toISOString();
}
