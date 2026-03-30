import { createMiddleware } from "hono/factory";
import { jwtVerify, createRemoteJWKSet } from "jose";

type Env = {
  Bindings: {
    TEAM_DOMAIN: string;
    POLICY_AUD: string;
  };
  Variables: {
    userEmail: string;
  };
};

export const accessAuth = () =>
  createMiddleware<Env>(async (c, next) => {
    const teamDomain = c.env.TEAM_DOMAIN;
    const policyAud = c.env.POLICY_AUD;

    if (!teamDomain || !policyAud) {
      return c.json({ error: "Auth not configured" }, 500);
    }

    const token = c.req.header("cf-access-jwt-assertion");
    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    try {
      const jwks = createRemoteJWKSet(
        new URL(`${teamDomain}/cdn-cgi/access/certs`),
      );

      const { payload } = await jwtVerify(token, jwks, {
        issuer: teamDomain,
        audience: policyAud,
      });

      if (typeof payload.email !== "string") {
        return c.json({ error: "Invalid token: missing email" }, 403);
      }

      c.set("userEmail", payload.email);
      await next();
    } catch {
      return c.json({ error: "Invalid token" }, 403);
    }
  });
