import type { DisplayName, UserId } from "./domain/auth";

type Bindings = {
  DB: D1Database;
  SESSION_SECRET: string;
  RP_ID: string;
  ORIGIN: string;
  INITIAL_REGISTRATION_TOKEN?: string;
};

type Variables = {
  userId: UserId;
  displayName: DisplayName;
};

export type Env = { Bindings: Bindings; Variables: Variables };
