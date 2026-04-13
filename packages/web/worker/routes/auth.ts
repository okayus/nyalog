import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, count, eq } from "drizzle-orm";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { credentials as credentialsTable, users } from "../db/schema";
import {
  type AuthError,
  type UserId,
  authErrorResponse,
  parseAddCredentialBegin,
  parseAddCredentialVerify,
  parseBeginRegistration,
  parseCredentialId,
  parseVerifyLogin,
  parseVerifyRegistration,
} from "../domain/auth";
import { consumeChallenge, issueChallenge } from "../middleware/challenge-cookie";
import { issueSession, revokeSession, sessionMiddleware } from "../middleware/session";
import type { Env } from "../types";

function errJson(error: AuthError) {
  const { body, status } = authErrorResponse(error);
  return { body, status };
}

function toBase64Url(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function userIdToHandle(userId: string): Uint8Array<ArrayBuffer> {
  const src = new TextEncoder().encode(userId);
  const out = new Uint8Array(new ArrayBuffer(src.byteLength));
  out.set(src);
  return out;
}

export const authRoutes = new Hono<Env>()
  .post("/register/begin", async (c) => {
    const token = c.env.INITIAL_REGISTRATION_TOKEN;
    if (!token) {
      const { body, status } = errJson({
        type: "registration_closed",
        message: "Registration is currently closed",
      });
      return c.json(body, status);
    }
    const parsed = parseBeginRegistration(await c.req.json());
    if (parsed.isErr()) {
      const { body, status } = errJson(parsed.error);
      return c.json(body, status);
    }
    if (parsed.value.initialRegistrationToken !== token) {
      const { body, status } = errJson({
        type: "registration_closed",
        message: "Invalid registration token",
      });
      return c.json(body, status);
    }

    const { displayName } = parsed.value;
    const userId = crypto.randomUUID();

    const options = await generateRegistrationOptions({
      rpName: "nyalog",
      rpID: c.env.RP_ID,
      userName: displayName,
      userDisplayName: displayName,
      userID: userIdToHandle(userId),
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "preferred",
      },
    });

    await issueChallenge(c, options.challenge, "registration", userId);
    return c.json({ options, userId });
  })
  .post("/register/verify", async (c) => {
    const token = c.env.INITIAL_REGISTRATION_TOKEN;
    if (!token) {
      const { body, status } = errJson({
        type: "registration_closed",
        message: "Registration is currently closed",
      });
      return c.json(body, status);
    }
    const parsed = parseVerifyRegistration(await c.req.json());
    if (parsed.isErr()) {
      const { body, status } = errJson(parsed.error);
      return c.json(body, status);
    }
    const ch = await consumeChallenge(c, "registration");
    if (!ch || !ch.uid) {
      const { body, status } = errJson({
        type: "challenge_mismatch",
        message: "No registration challenge",
      });
      return c.json(body, status);
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: parsed.value.response as RegistrationResponseJSON,
        expectedChallenge: ch.challenge,
        expectedOrigin: c.env.ORIGIN,
        expectedRPID: c.env.RP_ID,
        requireUserVerification: false,
      });
    } catch (e) {
      const { body, status } = errJson({
        type: "challenge_mismatch",
        message: e instanceof Error ? e.message : "verification failed",
      });
      return c.json(body, status);
    }
    if (!verification.verified || !verification.registrationInfo) {
      const { body, status } = errJson({
        type: "challenge_mismatch",
        message: "Registration not verified",
      });
      return c.json(body, status);
    }

    const info = verification.registrationInfo;
    const db = drizzle(c.env.DB);
    const now = new Date().toISOString();

    await db.insert(users).values({
      id: ch.uid,
      displayName: parsed.value.displayName,
      createdAt: now,
    });
    await db.insert(credentialsTable).values({
      id: info.credential.id,
      userId: ch.uid,
      publicKey: toBase64Url(info.credential.publicKey),
      counter: info.credential.counter,
      transports: info.credential.transports ? JSON.stringify(info.credential.transports) : null,
      deviceName: parsed.value.deviceName,
      backedUp: info.credentialBackedUp,
      createdAt: now,
      lastUsedAt: now,
    });

    await issueSession(c, ch.uid as UserId);
    return c.json({ id: ch.uid, displayName: parsed.value.displayName });
  })
  .post("/login/begin", async (c) => {
    const options = await generateAuthenticationOptions({
      rpID: c.env.RP_ID,
      userVerification: "preferred",
      allowCredentials: [],
    });
    await issueChallenge(c, options.challenge, "authentication");
    return c.json({ options });
  })
  .post("/login/verify", async (c) => {
    const parsed = parseVerifyLogin(await c.req.json());
    if (parsed.isErr()) {
      const { body, status } = errJson(parsed.error);
      return c.json(body, status);
    }
    const ch = await consumeChallenge(c, "authentication");
    if (!ch) {
      const { body, status } = errJson({
        type: "challenge_mismatch",
        message: "No authentication challenge",
      });
      return c.json(body, status);
    }

    const response = parsed.value.response as AuthenticationResponseJSON;
    const db = drizzle(c.env.DB);
    const rows = await db
      .select()
      .from(credentialsTable)
      .where(eq(credentialsTable.id, response.id));
    if (rows.length === 0) {
      const { body, status } = errJson({ type: "not_found", message: "Credential not registered" });
      return c.json(body, status);
    }
    const row = rows[0];

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: ch.challenge,
        expectedOrigin: c.env.ORIGIN,
        expectedRPID: c.env.RP_ID,
        credential: {
          id: row.id,
          publicKey: fromBase64Url(row.publicKey),
          counter: row.counter,
          transports: row.transports
            ? (JSON.parse(row.transports) as AuthenticatorTransportFuture[])
            : undefined,
        },
        requireUserVerification: false,
      });
    } catch (e) {
      const { body, status } = errJson({
        type: "challenge_mismatch",
        message: e instanceof Error ? e.message : "verification failed",
      });
      return c.json(body, status);
    }

    if (!verification.verified) {
      const { body, status } = errJson({
        type: "challenge_mismatch",
        message: "Authentication not verified",
      });
      return c.json(body, status);
    }

    const now = new Date().toISOString();
    await db
      .update(credentialsTable)
      .set({
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: now,
      })
      .where(eq(credentialsTable.id, row.id));

    await issueSession(c, row.userId as UserId);

    const userRows = await db.select().from(users).where(eq(users.id, row.userId));
    return c.json({ id: userRows[0].id, displayName: userRows[0].displayName });
  })
  .post("/logout", sessionMiddleware(), async (c) => {
    await revokeSession(c);
    return c.json({});
  })
  .get("/me", sessionMiddleware(), (c) => {
    return c.json({ id: c.get("userId"), displayName: c.get("displayName") });
  })
  .get("/credentials", sessionMiddleware(), async (c) => {
    const db = drizzle(c.env.DB);
    const rows = await db
      .select({
        id: credentialsTable.id,
        deviceName: credentialsTable.deviceName,
        backedUp: credentialsTable.backedUp,
        createdAt: credentialsTable.createdAt,
        lastUsedAt: credentialsTable.lastUsedAt,
      })
      .from(credentialsTable)
      .where(eq(credentialsTable.userId, c.get("userId")));
    return c.json(rows);
  })
  .post("/credentials/add/begin", sessionMiddleware(), async (c) => {
    const parsed = parseAddCredentialBegin(await c.req.json().catch(() => ({})));
    if (parsed.isErr()) {
      const { body, status } = errJson(parsed.error);
      return c.json(body, status);
    }
    const userId = c.get("userId");
    const displayName = c.get("displayName");

    const db = drizzle(c.env.DB);
    const existing = await db
      .select({ id: credentialsTable.id, transports: credentialsTable.transports })
      .from(credentialsTable)
      .where(eq(credentialsTable.userId, userId));

    const options = await generateRegistrationOptions({
      rpName: "nyalog",
      rpID: c.env.RP_ID,
      userName: displayName,
      userDisplayName: displayName,
      userID: userIdToHandle(userId),
      attestationType: "none",
      excludeCredentials: existing.map((e) => ({
        id: e.id,
        transports: e.transports
          ? (JSON.parse(e.transports) as AuthenticatorTransportFuture[])
          : undefined,
      })),
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "preferred",
      },
    });

    await issueChallenge(c, options.challenge, "add-credential", userId);
    return c.json({ options });
  })
  .post("/credentials/add/verify", sessionMiddleware(), async (c) => {
    const parsed = parseAddCredentialVerify(await c.req.json());
    if (parsed.isErr()) {
      const { body, status } = errJson(parsed.error);
      return c.json(body, status);
    }
    const ch = await consumeChallenge(c, "add-credential");
    if (!ch || ch.uid !== c.get("userId")) {
      const { body, status } = errJson({
        type: "challenge_mismatch",
        message: "No add-credential challenge",
      });
      return c.json(body, status);
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: parsed.value.response as RegistrationResponseJSON,
        expectedChallenge: ch.challenge,
        expectedOrigin: c.env.ORIGIN,
        expectedRPID: c.env.RP_ID,
        requireUserVerification: false,
      });
    } catch (e) {
      const { body, status } = errJson({
        type: "challenge_mismatch",
        message: e instanceof Error ? e.message : "verification failed",
      });
      return c.json(body, status);
    }
    if (!verification.verified || !verification.registrationInfo) {
      const { body, status } = errJson({
        type: "challenge_mismatch",
        message: "Registration not verified",
      });
      return c.json(body, status);
    }

    const info = verification.registrationInfo;
    const db = drizzle(c.env.DB);
    const now = new Date().toISOString();
    await db.insert(credentialsTable).values({
      id: info.credential.id,
      userId: c.get("userId"),
      publicKey: toBase64Url(info.credential.publicKey),
      counter: info.credential.counter,
      transports: info.credential.transports ? JSON.stringify(info.credential.transports) : null,
      deviceName: parsed.value.deviceName,
      backedUp: info.credentialBackedUp,
      createdAt: now,
      lastUsedAt: now,
    });

    return c.json({ id: info.credential.id });
  })
  .delete("/credentials/:id", sessionMiddleware(), async (c) => {
    const parsed = parseCredentialId(c.req.param("id"));
    if (parsed.isErr()) {
      const { body, status } = errJson(parsed.error);
      return c.json(body, status);
    }
    const userId = c.get("userId");
    const db = drizzle(c.env.DB);

    const countRows = await db
      .select({ n: count() })
      .from(credentialsTable)
      .where(eq(credentialsTable.userId, userId));
    if ((countRows[0]?.n ?? 0) <= 1) {
      const { body, status } = errJson({
        type: "last_credential",
        message: "Cannot delete the last passkey",
      });
      return c.json(body, status);
    }

    const existing = await db
      .select()
      .from(credentialsTable)
      .where(and(eq(credentialsTable.id, parsed.value), eq(credentialsTable.userId, userId)));
    if (existing.length === 0) {
      const { body, status } = errJson({ type: "not_found", message: "Credential not found" });
      return c.json(body, status);
    }

    await db.delete(credentialsTable).where(eq(credentialsTable.id, parsed.value));
    return c.json({});
  });

// Re-export helpers for tests if needed
export const _internal = { toBase64Url, fromBase64Url };
