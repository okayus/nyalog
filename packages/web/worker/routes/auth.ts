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
import {
  credentials as credentialsTable,
  users,
  type NewCredential,
  type NewUser,
} from "../db/schema";
import {
  type AuthError,
  UserId,
  authErrorResponse,
  parseAddCredentialBegin,
  parseAddCredentialVerify,
  parseBeginRegistration,
  parseCredentialId,
  parseVerifyLogin,
  parseVerifyRegistration,
} from "../domain/auth";
import { secretEquals } from "../lib/token";
import {
  consumeChallenge,
  issueChallenge,
  type ChallengeState,
} from "../middleware/challenge-cookie";
import { authRateLimit } from "../middleware/rate-limit";
import { issueSession, revokeSession, sessionMiddleware } from "../middleware/session";
import { registerInitialUser, registerInvitedUser, validateInvite } from "../spaces/registration";
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

type RegistrationInfo = NonNullable<
  Awaited<ReturnType<typeof verifyRegistrationResponse>>["registrationInfo"]
>;

function credentialFrom(
  info: RegistrationInfo,
  userId: string,
  deviceName: string | null,
  now: string,
): NewCredential {
  return {
    id: info.credential.id,
    userId,
    publicKey: toBase64Url(info.credential.publicKey),
    counter: info.credential.counter,
    transports: info.credential.transports ? JSON.stringify(info.credential.transports) : null,
    deviceName,
    backedUp: info.credentialBackedUp,
    createdAt: now,
    lastUsedAt: now,
  };
}

function userIdToHandle(userId: string): Uint8Array<ArrayBuffer> {
  const src = new TextEncoder().encode(userId);
  const out = new Uint8Array(new ArrayBuffer(src.byteLength));
  out.set(src);
  return out;
}

export const authRoutes = new Hono<Env>()
  .post("/register/begin", authRateLimit, async (c) => {
    const parsed = parseBeginRegistration(await c.req.json().catch(() => undefined));
    if (parsed.isErr()) {
      const { body, status } = errJson(parsed.error);
      return c.json(body, status);
    }
    const intent = parsed.value;
    // users.id はここで採番して challenge cookie に署名する。verify が同じ id で INSERT
    // するので、verify を再送されても 2 人はできない。
    const pendingUserId = crypto.randomUUID();

    let state: ChallengeState;
    if (intent.kind === "invite") {
      const invite = await validateInvite(c.env.DB, intent.inviteToken, new Date());
      if (invite.isErr()) {
        const { body, status } = errJson(invite.error);
        return c.json(body, status);
      }
      state = {
        kind: "invite",
        uid: pendingUserId,
        displayName: intent.displayName,
        inviteId: invite.value.id,
        spaceId: invite.value.spaceId,
      };
    } else {
      // secret が未設定なら登録は閉じている (deploy 直後の空白時間も含めて)
      const secret = c.env.INITIAL_REGISTRATION_TOKEN;
      if (!secret || !(await secretEquals(intent.initialRegistrationToken, secret))) {
        const { body, status } = errJson({
          type: "registration_closed",
          message: "Registration is currently closed",
        });
        return c.json(body, status);
      }
      state = { kind: "initial", uid: pendingUserId, displayName: intent.displayName };
    }

    const options = await generateRegistrationOptions({
      rpName: "nyalog",
      rpID: c.env.RP_ID,
      userName: intent.displayName,
      userDisplayName: intent.displayName,
      userID: userIdToHandle(pendingUserId),
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "preferred",
      },
    });

    await issueChallenge(c, options.challenge, state);
    // 返すのは options だけ。招待の inviteId / spaceId も uid もクライアントには渡さない。
    return c.json({ options });
  })
  .post("/register/verify", authRateLimit, async (c) => {
    const parsed = parseVerifyRegistration(await c.req.json().catch(() => undefined));
    if (parsed.isErr()) {
      const { body, status } = errJson(parsed.error);
      return c.json(body, status);
    }
    // displayName も uid も招待も、begin で署名した cookie 側の値だけを使う。
    const ch = await consumeChallenge(c);
    if (!ch || (ch.state.kind !== "initial" && ch.state.kind !== "invite")) {
      const { body, status } = errJson({
        type: "challenge_mismatch",
        message: "No registration challenge",
      });
      return c.json(body, status);
    }
    const state = ch.state;

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

    const now = new Date().toISOString();
    const user: NewUser = { id: state.uid, displayName: state.displayName, createdAt: now };
    const cred = credentialFrom(
      verification.registrationInfo,
      user.id,
      parsed.value.deviceName,
      now,
    );

    // どちらの経路でも users / credentials / space_members は 1 batch で入る。
    // 「登録できたがどのスペースにも属していない」中途半端な状態を作らない。
    let spaceId: string;
    if (state.kind === "initial") {
      spaceId = (await registerInitialUser(c.env.DB, user, cred)).spaceId;
    } else {
      const joined = await registerInvitedUser(c.env.DB, state, user, cred);
      if (joined.isErr()) {
        const { body, status } = errJson(joined.error);
        return c.json(body, status);
      }
      spaceId = joined.value.spaceId;
    }

    await issueSession(c, UserId.parse(user.id));
    return c.json({ id: user.id, displayName: user.displayName, spaceId }, 201);
  })
  .post("/login/begin", authRateLimit, async (c) => {
    const options = await generateAuthenticationOptions({
      rpID: c.env.RP_ID,
      userVerification: "preferred",
      allowCredentials: [],
    });
    await issueChallenge(c, options.challenge, { kind: "authentication" });
    return c.json({ options });
  })
  .post("/login/verify", authRateLimit, async (c) => {
    const parsed = parseVerifyLogin(await c.req.json());
    if (parsed.isErr()) {
      const { body, status } = errJson(parsed.error);
      return c.json(body, status);
    }
    const ch = await consumeChallenge(c);
    if (!ch || ch.state.kind !== "authentication") {
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

    await issueSession(c, UserId.parse(row.userId));

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

    await issueChallenge(c, options.challenge, { kind: "add-credential", uid: userId });
    return c.json({ options });
  })
  .post("/credentials/add/verify", sessionMiddleware(), async (c) => {
    const parsed = parseAddCredentialVerify(await c.req.json());
    if (parsed.isErr()) {
      const { body, status } = errJson(parsed.error);
      return c.json(body, status);
    }
    const ch = await consumeChallenge(c);
    if (!ch || ch.state.kind !== "add-credential" || ch.state.uid !== c.get("userId")) {
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

    await db
      .delete(credentialsTable)
      .where(and(eq(credentialsTable.id, parsed.value), eq(credentialsTable.userId, userId)));
    return c.json({});
  });

// Re-export helpers for tests if needed
export const _internal = { toBase64Url, fromBase64Url };
