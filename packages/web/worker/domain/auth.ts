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
  | { type: "last_credential"; message: string };

// --- Schemas ---

export const BeginRegistrationSchema = z.object({
  displayName: DisplayName,
  initialRegistrationToken: z.string().min(1),
});

export const VerifyRegistrationSchema = z.object({
  displayName: DisplayName,
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
  status: 400 | 401 | 403 | 404 | 409;
} {
  switch (error.type) {
    case "validation_error":
      return { body: { error }, status: 400 };
    case "unauthorized":
    case "session_expired":
    case "challenge_mismatch":
      return { body: { error }, status: 401 };
    case "registration_closed":
      return { body: { error }, status: 403 };
    case "not_found":
      return { body: { error }, status: 404 };
    case "last_credential":
      return { body: { error }, status: 409 };
  }
}
