// Idempotency-Key の D1 境界 (ADR-009 §2)。純粋な判定は domain/idempotency.ts。
import { and, eq, lt } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { idempotencyKeys } from "../db/schema";
import type { UserId } from "../domain/auth";
import { type IdempotencyKey, type StoredResponse, idempotencyCutoff } from "../domain/idempotency";

type Db = ReturnType<typeof drizzle>;

export async function findStoredResponse(
  db: Db,
  userId: UserId,
  key: IdempotencyKey,
): Promise<StoredResponse | undefined> {
  const rows = await db
    .select({
      requestHash: idempotencyKeys.requestHash,
      responseStatus: idempotencyKeys.responseStatus,
      responseBody: idempotencyKeys.responseBody,
      createdAt: idempotencyKeys.createdAt,
    })
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)))
    .limit(1);
  return rows[0];
}

// 30 日より古い行の掃除。記録の INSERT と同じ batch に入れる (cron が無いので書き込みのついで)。
// 期限切れの同じ key もここで消えるので、続く INSERT が PK で弾かれない。
export function purgeExpiredStatement(db: Db, userId: UserId, now: Date) {
  return db
    .delete(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.userId, userId),
        lt(idempotencyKeys.createdAt, idempotencyCutoff(now)),
      ),
    );
}

export function storeResponseStatement(
  db: Db,
  input: {
    userId: UserId;
    key: IdempotencyKey;
    requestHash: string;
    status: number;
    body: unknown;
    now: Date;
  },
) {
  return db.insert(idempotencyKeys).values({
    userId: input.userId,
    key: input.key,
    requestHash: input.requestHash,
    responseStatus: input.status,
    responseBody: JSON.stringify(input.body),
    createdAt: input.now.toISOString(),
  });
}

// D1 は制約違反を Error の message で伝える ("D1_ERROR: UNIQUE constraint failed: ...")。
// drizzle はそのまま投げ直すが、将来 cause に包まれても拾えるよう両方を見る。
export function isUniqueViolation(e: unknown): boolean {
  const messages: string[] = [];
  if (e instanceof Error) {
    messages.push(e.message);
    if (e.cause instanceof Error) messages.push(e.cause.message);
  }
  return messages.some((m) => /UNIQUE constraint failed/i.test(m));
}
