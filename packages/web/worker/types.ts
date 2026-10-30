import type { DisplayName, UserId } from "./domain/auth";
import type { PatId, Scope } from "./domain/pat";
import type { SpaceId } from "./domain/space";
import type { AnalyzeWorkflowParams } from "./lib/analyzer/workflow";

// Workflow / Ai / D1Database / R2Bucket 等は @cloudflare/workers-types で declare されている
// global types。worker tsconfig が `"types": ["@cloudflare/workers-types"]` で読み込んでいるため
// import 不要。

export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  MEDICAL_BUCKET: R2Bucket;
  AI: Ai;
  ANALYZE_WORKFLOW: Workflow<AnalyzeWorkflowParams>;
  AUTH_RATE_LIMITER: RateLimit;
  SESSION_SECRET: string;
  RP_ID: string;
  ORIGIN: string;
  ANALYZER_MODEL: string;
  INITIAL_REGISTRATION_TOKEN?: string;
  // dev only: set in .dev.vars to bypass passkey auth and inject a fixed user.
  // 本番 Worker には絶対設定しないこと。
  DEV_BYPASS_USER_ID?: string;
  // PAT の hash に混ぜる pepper (ADR-009)。本番は Worker Secret、ローカルは .dev.vars。
  // 未設定でも dev は動くが、本番では発行を 503 で止める (lib/pat.ts patPepperAvailable)。
  PAT_PEPPER?: string;
};

export type AuthMethod = "session" | "pat";

type Variables = {
  userId: UserId;
  displayName: DisplayName;
  memberSpaceIds: SpaceId[];
  // authMiddleware が set する。未設定 = まだ認証していない (sessionMiddleware が自分で解決する)。
  authMethod?: AuthMethod;
  // PAT のときだけ意味がある。session は scope で絞らない (人そのもの)。
  scopes?: Scope[];
  patId?: PatId;
};

// /api/spaces/:spaceId/* は spaceMiddleware が所属を確かめたあとの文脈で動く。
type SpaceVariables = Variables & { spaceId: SpaceId };

export type Env = { Bindings: Bindings; Variables: Variables };
export type SpaceEnv = { Bindings: Bindings; Variables: SpaceVariables };
