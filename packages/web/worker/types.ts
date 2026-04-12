type Bindings = {
  DB: D1Database;
  TEAM_DOMAIN: string;
  POLICY_AUD: string;
  DEV_SKIP_AUTH?: string;
};

type Variables = {
  userEmail: string;
};

export type Env = { Bindings: Bindings; Variables: Variables };
