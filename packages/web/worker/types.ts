import type { DisplayName, UserId } from "./domain/auth";

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  SESSION_SECRET: string;
  RP_ID: string;
  ORIGIN: string;
  INITIAL_REGISTRATION_TOKEN?: string;
  // dev only: set in .dev.vars to bypass passkey auth and inject a fixed user.
  // 本番 Worker には絶対設定しないこと。
  DEV_BYPASS_USER_ID?: string;
};

type Variables = {
  userId: UserId;
  displayName: DisplayName;
};

export type Env = { Bindings: Bindings; Variables: Variables };
