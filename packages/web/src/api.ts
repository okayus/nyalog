import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { err, ResultAsync, type Result } from "neverthrow";
import type { Cat, ThemeColor } from "../worker/domain/cat";
import type { MedicalRecord } from "../worker/domain/medical-record";
import type { ToiletRecord, StoolCondition } from "../worker/domain/toilet-record";

type CreateCatInput = { name: string; birthday?: string | null; themeColor?: ThemeColor };
type UpdateCatInput = { name?: string; birthday?: string | null; themeColor?: ThemeColor };

type CreateToiletRecordInput =
  | { type: "urination"; timestamp: string }
  | { type: "defecation"; timestamp: string; condition: StoolCondition };

type UpdateToiletRecordInput =
  | { type: "urination"; timestamp?: string }
  | { type: "defecation"; timestamp?: string; condition?: StoolCondition };

export type ApiError =
  | { kind: "network"; message: string }
  | { kind: "http"; status: number; message: string };

function toNetworkError(e: unknown): ApiError {
  return { kind: "network", message: e instanceof Error ? e.message : String(e) };
}

async function request<T>(path: string, init?: RequestInit): Promise<Result<T, ApiError>> {
  const fetchResult = await ResultAsync.fromPromise(
    fetch(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...init?.headers,
      },
    }),
    toNetworkError,
  );
  if (fetchResult.isErr()) return err(fetchResult.error);
  const res = fetchResult.value;
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    return err({
      kind: "http",
      status: res.status,
      message: body.error?.message ?? `HTTP ${res.status}`,
    });
  }
  return ResultAsync.fromPromise(res.json() as Promise<T>, toNetworkError);
}

export function listCats(): Promise<Result<Cat[], ApiError>> {
  return request<Cat[]>("/api/cats");
}

export function createCat(input: CreateCatInput): Promise<Result<Cat, ApiError>> {
  return request<Cat>("/api/cats", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateCat(id: string, input: UpdateCatInput): Promise<Result<Cat, ApiError>> {
  return request<Cat>(`/api/cats/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteCat(id: string): Promise<Result<Record<string, never>, ApiError>> {
  return request(`/api/cats/${id}`, { method: "DELETE" });
}

export function listToiletRecords(catId: string): Promise<Result<ToiletRecord[], ApiError>> {
  return request<ToiletRecord[]>(`/api/cats/${catId}/toilet-records`);
}

export function createToiletRecord(
  catId: string,
  input: CreateToiletRecordInput,
): Promise<Result<ToiletRecord, ApiError>> {
  return request<ToiletRecord>(`/api/cats/${catId}/toilet-records`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateToiletRecord(
  catId: string,
  id: string,
  input: UpdateToiletRecordInput,
): Promise<Result<ToiletRecord, ApiError>> {
  return request<ToiletRecord>(`/api/cats/${catId}/toilet-records/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteToiletRecord(
  catId: string,
  id: string,
): Promise<Result<Record<string, never>, ApiError>> {
  return request(`/api/cats/${catId}/toilet-records/${id}`, {
    method: "DELETE",
  });
}

// --- Medical Records API ---

type CreateMedicalRecordInput =
  | { type: "blood_test"; recordedAt: string; title?: string | null; notes?: string | null }
  | { type: "other"; recordedAt: string; title?: string | null; notes?: string | null };

type UpdateMedicalRecordInput =
  | { type: "blood_test"; recordedAt?: string; title?: string | null; notes?: string | null }
  | { type: "other"; recordedAt?: string; title?: string | null; notes?: string | null };

export function listMedicalRecords(catId: string): Promise<Result<MedicalRecord[], ApiError>> {
  return request<MedicalRecord[]>(`/api/cats/${catId}/medical-records`);
}

export function createMedicalRecord(
  catId: string,
  input: CreateMedicalRecordInput,
): Promise<Result<MedicalRecord, ApiError>> {
  return request<MedicalRecord>(`/api/cats/${catId}/medical-records`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateMedicalRecord(
  catId: string,
  id: string,
  input: UpdateMedicalRecordInput,
): Promise<Result<MedicalRecord, ApiError>> {
  return request<MedicalRecord>(`/api/cats/${catId}/medical-records/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteMedicalRecord(
  catId: string,
  id: string,
): Promise<Result<Record<string, never>, ApiError>> {
  return request(`/api/cats/${catId}/medical-records/${id}`, {
    method: "DELETE",
  });
}

// --- Auth API ---

export type AuthUser = { id: string; displayName: string };

export type CredentialSummary = {
  id: string;
  deviceName: string | null;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

export const authApi = {
  me(): Promise<Result<AuthUser, ApiError>> {
    return request<AuthUser>("/api/auth/me");
  },

  async register(
    displayName: string,
    initialRegistrationToken: string,
    deviceName: string | null,
  ): Promise<Result<AuthUser, ApiError>> {
    const begin = await request<{
      options: PublicKeyCredentialCreationOptionsJSON;
      userId: string;
    }>("/api/auth/register/begin", {
      method: "POST",
      body: JSON.stringify({ displayName, initialRegistrationToken }),
    });
    if (begin.isErr()) return err(begin.error);
    const attResp = await ResultAsync.fromPromise(
      startRegistration({ optionsJSON: begin.value.options }),
      toNetworkError,
    );
    if (attResp.isErr()) return err(attResp.error);
    return request<AuthUser>("/api/auth/register/verify", {
      method: "POST",
      body: JSON.stringify({ displayName, response: attResp.value, deviceName }),
    });
  },

  async login(): Promise<Result<AuthUser, ApiError>> {
    const begin = await request<{ options: PublicKeyCredentialRequestOptionsJSON }>(
      "/api/auth/login/begin",
      { method: "POST" },
    );
    if (begin.isErr()) return err(begin.error);
    const authResp = await ResultAsync.fromPromise(
      startAuthentication({ optionsJSON: begin.value.options }),
      toNetworkError,
    );
    if (authResp.isErr()) return err(authResp.error);
    return request<AuthUser>("/api/auth/login/verify", {
      method: "POST",
      body: JSON.stringify({ response: authResp.value }),
    });
  },

  async logout(): Promise<Result<Record<string, never>, ApiError>> {
    return request<Record<string, never>>("/api/auth/logout", { method: "POST" });
  },

  listCredentials(): Promise<Result<CredentialSummary[], ApiError>> {
    return request<CredentialSummary[]>("/api/auth/credentials");
  },

  async addCredential(deviceName: string | null): Promise<Result<{ id: string }, ApiError>> {
    const begin = await request<{ options: PublicKeyCredentialCreationOptionsJSON }>(
      "/api/auth/credentials/add/begin",
      { method: "POST", body: JSON.stringify({ deviceName }) },
    );
    if (begin.isErr()) return err(begin.error);
    const attResp = await ResultAsync.fromPromise(
      startRegistration({ optionsJSON: begin.value.options }),
      toNetworkError,
    );
    if (attResp.isErr()) return err(attResp.error);
    return request<{ id: string }>("/api/auth/credentials/add/verify", {
      method: "POST",
      body: JSON.stringify({ response: attResp.value, deviceName }),
    });
  },

  async deleteCredential(id: string): Promise<Result<Record<string, never>, ApiError>> {
    return request<Record<string, never>>(`/api/auth/credentials/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
};
