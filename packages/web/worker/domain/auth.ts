import { z } from "zod";
import { ok, err, type Result } from "neverthrow";

// --- Branded Types ---

export type UserId = string & { readonly __brand: unique symbol };
export const UserId = z
  .string()
  .uuid()
  .transform((v) => v as UserId);

export type DisplayName = string & { readonly __brand: unique symbol };
export const DisplayName = z
  .string()
  .min(1)
  .max(50)
  .transform((v) => v as DisplayName);

export type CredentialId = string & { readonly __brand: unique symbol };
export const CredentialId = z
  .string()
  .min(1)
  .max(512)
  .transform((v) => v as CredentialId);

export type SessionId = string & { readonly __brand: unique symbol };
export const SessionId = z
  .string()
  .min(1)
  .transform((v) => v as SessionId);

export type DeviceName = string & { readonly __brand: unique symbol };
export const DeviceName = z
  .string()
  .min(1)
  .max(80)
  .transform((v) => v as DeviceName);

// --- Domain Types ---

export type User = {
  id: UserId;
  displayName: DisplayName;
  createdAt: string;
};

export type Credential = {
  id: CredentialId;
  userId: UserId;
  deviceName: DeviceName | null;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

export type Session = {
  id: SessionId;
  userId: UserId;
  expiresAt: string;
  createdAt: string;
};

// --- Domain Error ---

export type AuthError =
  | { type: "validation_error"; message: string; issues: z.ZodIssue[] }
  | { type: "registration_closed"; message: string }
  | { type: "unauthorized"; message: string }
  | { type: "challenge_mismatch"; message: string }
  | { type: "session_expired" }
  | { type: "not_found"; message: string }
  | { type: "last_credential"; message: string }
  | { type: "forbidden"; message: string }
  // 招待リンクの失敗。hash が引けない (403) と、引けたが死んでいる (410) を分ける:
  // 403 の連打は総当たりの兆候、410 は家族が古いリンクを開いただけ。
  | { type: "invite_invalid"; message: string }
  | { type: "invite_consumed"; message: string }
  | { type: "invite_expired"; message: string }
  | { type: "invite_race"; message: string }
  | { type: "already_member"; message: string };

// --- Schemas ---

// 登録の入口は 2 本ある。どちらの経路かを型で分けて、route 側の分岐を網羅させる。
// トークンの形の検査はここではせず domain/invite.ts の inviteUsability に任せる
// (壊れた形も「使えない招待」として同じ 403 に落としたい)。
export const BeginRegistrationSchema = z.union([
  z
    .object({ displayName: DisplayName, inviteToken: z.string().min(1).max(256) })
    .transform((v) => ({
      kind: "invite" as const,
      displayName: v.displayName,
      inviteToken: v.inviteToken,
    })),
  z
    .object({ displayName: DisplayName, initialRegistrationToken: z.string().min(1) })
    .transform((v) => ({
      kind: "initial" as const,
      displayName: v.displayName,
      initialRegistrationToken: v.initialRegistrationToken,
    })),
]);

export type RegistrationIntent = z.infer<typeof BeginRegistrationSchema>;

// displayName は begin で署名済み challenge cookie に入れたものを使う。
// ここで受け取ると begin と別の名前を送れてしまう。
export const VerifyRegistrationSchema = z.object({
  response: z.unknown(),
  deviceName: DeviceName.nullable().optional().default(null),
});

export const VerifyLoginSchema = z.object({
  response: z.unknown(),
});

export const AddCredentialBeginSchema = z.object({
  deviceName: DeviceName.nullable().optional().default(null),
});

export const AddCredentialVerifySchema = z.object({
  response: z.unknown(),
  deviceName: DeviceName.nullable().optional().default(null),
});

// --- Parsers ---

function validationErr(message: string, issues: z.ZodIssue[]): AuthError {
  return { type: "validation_error", message, issues };
}

export function parseBeginRegistration(
  input: unknown,
): Result<z.infer<typeof BeginRegistrationSchema>, AuthError> {
  const r = BeginRegistrationSchema.safeParse(input);
  return r.success ? ok(r.data) : err(validationErr("Invalid registration begin", r.error.issues));
}

export function parseVerifyRegistration(
  input: unknown,
): Result<z.infer<typeof VerifyRegistrationSchema>, AuthError> {
  const r = VerifyRegistrationSchema.safeParse(input);
  return r.success ? ok(r.data) : err(validationErr("Invalid registration verify", r.error.issues));
}

export function parseVerifyLogin(
  input: unknown,
): Result<z.infer<typeof VerifyLoginSchema>, AuthError> {
  const r = VerifyLoginSchema.safeParse(input);
  return r.success ? ok(r.data) : err(validationErr("Invalid login verify", r.error.issues));
}

export function parseAddCredentialBegin(
  input: unknown,
): Result<z.infer<typeof AddCredentialBeginSchema>, AuthError> {
  const r = AddCredentialBeginSchema.safeParse(input);
  return r.success
    ? ok(r.data)
    : err(validationErr("Invalid add credential begin", r.error.issues));
}

export function parseAddCredentialVerify(
  input: unknown,
): Result<z.infer<typeof AddCredentialVerifySchema>, AuthError> {
  const r = AddCredentialVerifySchema.safeParse(input);
  return r.success
    ? ok(r.data)
    : err(validationErr("Invalid add credential verify", r.error.issues));
}

export function parseCredentialId(input: string): Result<CredentialId, AuthError> {
  const r = CredentialId.safeParse(input);
  return r.success ? ok(r.data) : err(validationErr("Invalid credential id", r.error.issues));
}

// --- Error → HTTP mapping helper ---

export function authErrorResponse(error: AuthError): {
  body: { error: AuthError };
  status: 400 | 401 | 403 | 404 | 409 | 410;
} {
  switch (error.type) {
    case "validation_error":
      return { body: { error }, status: 400 };
    case "unauthorized":
    case "session_expired":
    case "challenge_mismatch":
      return { body: { error }, status: 401 };
    case "registration_closed":
    case "forbidden":
    case "invite_invalid":
      return { body: { error }, status: 403 };
    case "not_found":
      return { body: { error }, status: 404 };
    case "last_credential":
    case "invite_race":
    case "already_member":
      return { body: { error }, status: 409 };
    case "invite_consumed":
    case "invite_expired":
      return { body: { error }, status: 410 };
  }
}
