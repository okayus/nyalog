import { createMiddleware } from "hono/factory";
import { jwtVerify, createRemoteJWKSet } from "jose";
import type { Env } from "./types";

export const accessAuth = () =>
  createMiddleware<Env>(async (c, next) => {
    if (c.env.DEV_SKIP_AUTH === "true") {
      c.set("userEmail", "dev@localhost");
      await next();
      return;
    }

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
      const jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));

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
