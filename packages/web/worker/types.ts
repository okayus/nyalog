import type { DisplayName, UserId } from "./domain/auth";
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
  SESSION_SECRET: string;
  RP_ID: string;
  ORIGIN: string;
  ANALYZER_MODEL: string;
  INITIAL_REGISTRATION_TOKEN?: string;
  // dev only: set in .dev.vars to bypass passkey auth and inject a fixed user.
  // 本番 Worker には絶対設定しないこと。
  DEV_BYPASS_USER_ID?: string;
};

type Variables = {
  userId: UserId;
  displayName: DisplayName;
  memberSpaceIds: SpaceId[];
};

export type Env = { Bindings: Bindings; Variables: Variables };
