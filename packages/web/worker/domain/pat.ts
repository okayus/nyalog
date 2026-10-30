import { z } from "zod";
import { ok, err, type Result } from "neverthrow";

// Personal access token (PAT)。機械 (ochanoma) が利用者として API を叩くための Bearer。
// 決定は ADR-009。平文は発行時の 1 回しか存在せず、DB には sha256(token + PAT_PEPPER) だけ置く。

// --- Scopes ---
// const tuple から Scope 型を導く。綴り違いはコンパイルで落ちる。
// scope の改名は DB の JSON を書き換える data migration になる (unknown は parse で落とすため)。
export const SCOPES = ["toilet:write", "tasks:read", "tasks:write"] as const;
export type Scope = (typeof SCOPES)[number];

export function isScope(s: string): s is Scope {
  return (SCOPES as readonly string[]).includes(s);
}

// DB の TEXT 列 (JSON 配列) → Scope[]。壊れた JSON や未知の scope は落とす。
// 空になっても認証は通し (利用者は本物)、scope 付きのルートで 403 にする。
export function parseScopes(json: string): Scope[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is Scope => typeof s === "string" && isScope(s));
  } catch {
    return [];
  }
}

// --- Token ---

export const PAT_PREFIX = "nyalog_pat_";
// randomTokenHex(32) の出力に prefix を付けた形。prefix は識別用で秘密保護ではない
// (log や dump で grep できる。GitHub の無料 push protection は検知しない)。
export const PatTokenSchema = z.string().regex(/^nyalog_pat_[0-9a-f]{64}$/);

export function isPatTokenShape(token: string): boolean {
  return PatTokenSchema.safeParse(token).success;
}

export type PatId = string & { readonly __brand: unique symbol };
export const PatId = z
  .string()
  .uuid()
  .transform((v) => v as PatId);

export type TokenName = string & { readonly __brand: unique symbol };
export const TokenName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .transform((v) => v as TokenName);

export const CreateTokenSchema = z.object({ name: TokenName });
export type CreateTokenInput = z.infer<typeof CreateTokenSchema>;

// last_used_at は 1 時間に 1 回しか書かない。再送の多い送信側が 1 call = 1 D1 write に
// ならないようにするため。
export const LAST_USED_THROTTLE_MS = 60 * 60 * 1000;

export function shouldTouchLastUsed(lastUsedAt: string | null, now: Date): boolean {
  if (lastUsedAt === null) return true;
  return now.getTime() - new Date(lastUsedAt).getTime() > LAST_USED_THROTTLE_MS;
}

// --- Error ---

export type PatError =
  | { type: "validation_error"; message: string; issues: z.ZodIssue[] }
  | { type: "unauthorized"; message: string }
  // cookie セッションでしかできない操作 (トークンの発行・失効、パスキー管理) に PAT が来た
  | { type: "session_required"; message: string }
  // 表に無いルート、または scope が足りない
  | { type: "insufficient_scope"; message: string; scope: Scope | null }
  // 本番で PAT_PEPPER が未設定。入れずに発行すると pepper 投入時に全トークンが死ぬ
  | { type: "pat_unavailable"; message: string }
  | { type: "not_found"; message: string };

export function patErrorResponse(error: PatError): {
  body: { error: PatError };
  status: 400 | 401 | 403 | 404 | 503;
} {
  switch (error.type) {
    case "validation_error":
      return { body: { error }, status: 400 };
    case "unauthorized":
      return { body: { error }, status: 401 };
    case "session_required":
    case "insufficient_scope":
      return { body: { error }, status: 403 };
    case "not_found":
      return { body: { error }, status: 404 };
    case "pat_unavailable":
      return { body: { error }, status: 503 };
  }
}

// --- Usability (pure) ---

export type PatLiveness = { revokedAt: string | null; expiresAt: string | null };

// 失効と期限切れを区別して返さない。呼び出し側に見せるのは 401 だけで、理由は
// 設定 UI の一覧で利用者が知る。区別すると「そのトークンは本物だった」と攻撃者に教える。
export function patUsability(row: PatLiveness | undefined, now: Date): Result<void, PatError> {
  if (!row) return err({ type: "unauthorized", message: "Invalid token" });
  if (row.revokedAt !== null) return err({ type: "unauthorized", message: "Invalid token" });
  if (row.expiresAt !== null && new Date(row.expiresAt).getTime() <= now.getTime()) {
    return err({ type: "unauthorized", message: "Invalid token" });
  }
  return ok(undefined);
}

// --- Route table (default deny) ---
// PAT で呼べるルートはここに列挙する。無いルートは 403。route ごとに guard を積む形
// (skill の requireScope) は付け忘れで開くので採らない (ADR-009)。
// scope が null のルートは、有効な PAT なら scope を問わず通す (疎通確認用の /me)。

type PatRoute = { method: string; pattern: RegExp; scope: Scope | null };

const PAT_ROUTES: readonly PatRoute[] = [
  { method: "GET", pattern: /^\/api\/auth\/me$/, scope: null },
  { method: "POST", pattern: /^\/api\/cats\/[^/]+\/toilet-records$/, scope: "toilet:write" },
  // 取り消し (kakitome docs/06 §4): 送信側が自分で作った記録を id で消す
  {
    method: "DELETE",
    pattern: /^\/api\/cats\/[^/]+\/toilet-records\/[^/]+$/,
    scope: "toilet:write",
  },
  { method: "GET", pattern: /^\/api\/tasks\/due$/, scope: "tasks:read" },
  { method: "POST", pattern: /^\/api\/tasks\/[^/]+\/completions$/, scope: "tasks:write" },
  {
    method: "DELETE",
    pattern: /^\/api\/tasks\/[^/]+\/completions\/[^/]+$/,
    scope: "tasks:write",
  },
];

// 資格情報そのものを変える領域。PAT には「表に無い」ではなく「ブラウザのセッションで」と返す。
const SESSION_ONLY_PREFIXES = ["/api/tokens", "/api/auth/"] as const;

export function isSessionOnlyRoute(path: string): boolean {
  return SESSION_ONLY_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export type PatRouteDecision = { allowed: false } | { allowed: true; scope: Scope | null };

export function patRouteScope(method: string, path: string): PatRouteDecision {
  const route = PAT_ROUTES.find((r) => r.method === method && r.pattern.test(path));
  return route ? { allowed: true, scope: route.scope } : { allowed: false };
}

// 表の判定と scope の照合を 1 箇所に。middleware はこれを呼ぶだけ。
export function authorizePatRoute(
  method: string,
  path: string,
  scopes: readonly Scope[],
): Result<void, PatError> {
  const decision = patRouteScope(method, path);
  if (!decision.allowed && isSessionOnlyRoute(path)) {
    return err({
      type: "session_required",
      message: "This operation requires a browser session",
    });
  }
  if (!decision.allowed) {
    return err({
      type: "insufficient_scope",
      message: "This route does not accept personal access tokens",
      scope: null,
    });
  }
  if (decision.scope !== null && !scopes.includes(decision.scope)) {
    return err({
      type: "insufficient_scope",
      message: `Token lacks scope ${decision.scope}`,
      scope: decision.scope,
    });
  }
  return ok(undefined);
}

// --- Parsers ---

export function parseCreateToken(input: unknown): Result<CreateTokenInput, PatError> {
  const r = CreateTokenSchema.safeParse(input);
  if (!r.success) {
    return err({ type: "validation_error", message: "Invalid token data", issues: r.error.issues });
  }
  return ok(r.data);
}

export function parsePatId(input: string): Result<PatId, PatError> {
  const r = PatId.safeParse(input);
  if (!r.success) return err({ type: "not_found", message: "Token not found" });
  return ok(r.data);
}
