// PAT の発行・一覧・失効・検証。D1 を触る境界。純粋な判定は domain/pat.ts。
import { and, desc, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { personalAccessTokens, users } from "../db/schema";
import { DisplayName, UserId } from "../domain/auth";
import {
  type PatError,
  type PatId,
  type Scope,
  type TokenName,
  PAT_PREFIX,
  SCOPES,
  isPatTokenShape,
  parseScopes,
  patUsability,
  shouldTouchLastUsed,
} from "../domain/pat";
import type { Bindings } from "../types";
import { randomTokenHex, sha256Hex } from "./token";

type Db = ReturnType<typeof drizzle>;

function isLocalOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

// 本番で pepper 無しに発行すると、後から入れた瞬間に既発行が全部死ぬ。dev / CI (ORIGIN が
// localhost) は .dev.vars に無くても動く。
export function patPepperAvailable(env: Pick<Bindings, "PAT_PEPPER" | "ORIGIN">): boolean {
  return Boolean(env.PAT_PEPPER) || isLocalOrigin(env.ORIGIN);
}

function hashPat(env: Pick<Bindings, "PAT_PEPPER">, token: string): Promise<string> {
  return sha256Hex(token + (env.PAT_PEPPER ?? ""));
}

export type IssuedToken = {
  id: PatId;
  name: TokenName;
  token: string; // 平文。ここ以外に出ない
  scopes: Scope[];
  createdAt: string;
};

export async function createPat(
  db: Db,
  env: Pick<Bindings, "PAT_PEPPER">,
  userId: UserId,
  name: TokenName,
): Promise<IssuedToken> {
  const token = PAT_PREFIX + randomTokenHex(32);
  const id = crypto.randomUUID() as PatId;
  const createdAt = new Date().toISOString();
  const scopes: Scope[] = [...SCOPES]; // MVP: 全 scope。picker は要るようになってから
  await db.insert(personalAccessTokens).values({
    id,
    userId,
    name,
    tokenHash: await hashPat(env, token),
    scopes: JSON.stringify(scopes),
    createdAt,
  });
  return { id, name, token, scopes, createdAt };
}

export type TokenSummary = {
  id: string;
  name: string;
  scopes: Scope[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

// token_hash は select しない。
export async function listPats(db: Db, userId: UserId): Promise<TokenSummary[]> {
  const rows = await db
    .select({
      id: personalAccessTokens.id,
      name: personalAccessTokens.name,
      scopes: personalAccessTokens.scopes,
      createdAt: personalAccessTokens.createdAt,
      lastUsedAt: personalAccessTokens.lastUsedAt,
      expiresAt: personalAccessTokens.expiresAt,
      revokedAt: personalAccessTokens.revokedAt,
    })
    .from(personalAccessTokens)
    .where(eq(personalAccessTokens.userId, userId))
    .orderBy(desc(personalAccessTokens.createdAt));
  return rows.map((r) => ({ ...r, scopes: parseScopes(r.scopes) }));
}

// 自分のでない id も存在しない id も false (route は 404)。他人のトークンの存在を漏らさない。
// 失効済みへの再失効は true のまま何もしない (冪等)。
export async function revokePat(db: Db, userId: UserId, id: PatId): Promise<boolean> {
  const owned = await db
    .select({ id: personalAccessTokens.id, revokedAt: personalAccessTokens.revokedAt })
    .from(personalAccessTokens)
    .where(and(eq(personalAccessTokens.id, id), eq(personalAccessTokens.userId, userId)));
  if (owned.length === 0) return false;
  if (owned[0].revokedAt === null) {
    await db
      .update(personalAccessTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(personalAccessTokens.id, id));
  }
  return true;
}

export type PatPrincipal = {
  patId: PatId;
  userId: UserId;
  displayName: DisplayName;
  scopes: Scope[];
};

// Bearer の検証。安い却下を先に (scheme → 形 → pepper) して、hash と D1 は最後。
// 失敗はどれも 401 の同じ本文 (理由を漏らさない)。
export async function validatePat(
  db: Db,
  env: Pick<Bindings, "PAT_PEPPER" | "ORIGIN">,
  authorization: string,
): Promise<{ ok: true; principal: PatPrincipal } | { ok: false; error: PatError }> {
  const invalid = {
    ok: false as const,
    error: { type: "unauthorized" as const, message: "Invalid token" },
  };
  if (!authorization.startsWith("Bearer ")) return invalid;
  const token = authorization.slice("Bearer ".length).trim();
  if (!isPatTokenShape(token)) return invalid;
  if (!patPepperAvailable(env)) {
    console.error("[pat] PAT_PEPPER is not configured; rejecting all tokens");
    return invalid;
  }

  const tokenHash = await hashPat(env, token);
  const rows = await db
    .select({
      id: personalAccessTokens.id,
      userId: personalAccessTokens.userId,
      scopes: personalAccessTokens.scopes,
      lastUsedAt: personalAccessTokens.lastUsedAt,
      expiresAt: personalAccessTokens.expiresAt,
      revokedAt: personalAccessTokens.revokedAt,
      displayName: users.displayName,
    })
    .from(personalAccessTokens)
    .innerJoin(users, eq(personalAccessTokens.userId, users.id))
    .where(eq(personalAccessTokens.tokenHash, tokenHash))
    .limit(1);
  const row = rows[0];
  const now = new Date();
  const usable = patUsability(row, now);
  if (usable.isErr() || !row)
    return { ok: false, error: usable.isErr() ? usable.error : invalid.error };

  if (shouldTouchLastUsed(row.lastUsedAt, now)) {
    await db
      .update(personalAccessTokens)
      .set({ lastUsedAt: now.toISOString() })
      .where(eq(personalAccessTokens.id, row.id));
  }
  return {
    ok: true,
    principal: {
      patId: row.id as PatId,
      userId: UserId.parse(row.userId),
      displayName: DisplayName.parse(row.displayName),
      scopes: parseScopes(row.scopes),
    },
  };
}
