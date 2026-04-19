import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import type { Cat, ThemeColor } from "../worker/domain/cat";
import type { ToiletRecord, StoolCondition } from "../worker/domain/toilet-record";

type CreateCatInput = { name: string; birthday?: string | null; themeColor?: ThemeColor };
type UpdateCatInput = { name?: string; birthday?: string | null; themeColor?: ThemeColor };

type CreateToiletRecordInput =
  | { type: "urination"; timestamp: string }
  | { type: "defecation"; timestamp: string; condition: StoolCondition };

type UpdateToiletRecordInput =
  | { type: "urination"; timestamp?: string }
  | { type: "defecation"; timestamp?: string; condition?: StoolCondition };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new ApiError(res.status, body.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function listCats(): Promise<Cat[]> {
  return request<Cat[]>("/api/cats");
}

export function createCat(input: CreateCatInput): Promise<Cat> {
  return request<Cat>("/api/cats", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateCat(id: string, input: UpdateCatInput): Promise<Cat> {
  return request<Cat>(`/api/cats/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteCat(id: string): Promise<Record<string, never>> {
  return request(`/api/cats/${id}`, { method: "DELETE" });
}

export function listToiletRecords(catId: string): Promise<ToiletRecord[]> {
  return request<ToiletRecord[]>(`/api/cats/${catId}/toilet-records`);
}

export function createToiletRecord(
  catId: string,
  input: CreateToiletRecordInput,
): Promise<ToiletRecord> {
  return request<ToiletRecord>(`/api/cats/${catId}/toilet-records`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateToiletRecord(
  catId: string,
  id: string,
  input: UpdateToiletRecordInput,
): Promise<ToiletRecord> {
  return request<ToiletRecord>(`/api/cats/${catId}/toilet-records/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteToiletRecord(catId: string, id: string): Promise<Record<string, never>> {
  return request(`/api/cats/${catId}/toilet-records/${id}`, {
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
  async me(): Promise<AuthUser> {
    return request<AuthUser>("/api/auth/me");
  },

  async register(
    displayName: string,
    initialRegistrationToken: string,
    deviceName: string | null,
  ): Promise<AuthUser> {
    const begin = await request<{
      options: PublicKeyCredentialCreationOptionsJSON;
      userId: string;
    }>("/api/auth/register/begin", {
      method: "POST",
      body: JSON.stringify({ displayName, initialRegistrationToken }),
    });
    const attResp = await startRegistration({ optionsJSON: begin.options });
    return request<AuthUser>("/api/auth/register/verify", {
      method: "POST",
      body: JSON.stringify({ displayName, response: attResp, deviceName }),
    });
  },

  async login(): Promise<AuthUser> {
    const begin = await request<{ options: PublicKeyCredentialRequestOptionsJSON }>(
      "/api/auth/login/begin",
      { method: "POST" },
    );
    const authResp = await startAuthentication({ optionsJSON: begin.options });
    return request<AuthUser>("/api/auth/login/verify", {
      method: "POST",
      body: JSON.stringify({ response: authResp }),
    });
  },

  async logout(): Promise<void> {
    await request<Record<string, never>>("/api/auth/logout", { method: "POST" });
  },

  async listCredentials(): Promise<CredentialSummary[]> {
    return request<CredentialSummary[]>("/api/auth/credentials");
  },

  async addCredential(deviceName: string | null): Promise<{ id: string }> {
    const begin = await request<{ options: PublicKeyCredentialCreationOptionsJSON }>(
      "/api/auth/credentials/add/begin",
      { method: "POST", body: JSON.stringify({ deviceName }) },
    );
    const attResp = await startRegistration({ optionsJSON: begin.options });
    return request<{ id: string }>("/api/auth/credentials/add/verify", {
      method: "POST",
      body: JSON.stringify({ response: attResp, deviceName }),
    });
  },

  async deleteCredential(id: string): Promise<void> {
    await request<Record<string, never>>(`/api/auth/credentials/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
};
