import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { err, ResultAsync, type Result } from "neverthrow";
import type {
  BloodTestAnalysis,
  BloodTestValue,
  ValueFlag,
} from "../worker/domain/blood-test-analysis";
import type { Cat, ThemeColor } from "../worker/domain/cat";
import type { CatTask, Recurrence, TaskCompletion } from "../worker/domain/cat-task";
import type { MedicalRecord, MedicalRecordAttachment } from "../worker/domain/medical-record";
import type { ToiletRecord, StoolCondition } from "../worker/domain/toilet-record";
import type { WeightRecord } from "../worker/domain/weight-record";

export type { CatTask, Recurrence, TaskCompletion };

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

// --- Weight Records API ---

type CreateWeightRecordInput = { weightGrams: number; measuredAt: string };
type UpdateWeightRecordInput = { weightGrams?: number; measuredAt?: string };

export function listWeightRecords(catId: string): Promise<Result<WeightRecord[], ApiError>> {
  return request<WeightRecord[]>(`/api/cats/${catId}/weights`);
}

export function createWeightRecord(
  catId: string,
  input: CreateWeightRecordInput,
): Promise<Result<WeightRecord, ApiError>> {
  return request<WeightRecord>(`/api/cats/${catId}/weights`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateWeightRecord(
  catId: string,
  id: string,
  input: UpdateWeightRecordInput,
): Promise<Result<WeightRecord, ApiError>> {
  return request<WeightRecord>(`/api/cats/${catId}/weights/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteWeightRecord(
  catId: string,
  id: string,
): Promise<Result<Record<string, never>, ApiError>> {
  return request(`/api/cats/${catId}/weights/${id}`, {
    method: "DELETE",
  });
}

// --- Cat Tasks API ---

type CreateTaskInput = {
  title: string;
  recurrence: Recurrence;
  startDate: string;
  endDate?: string | null;
  notes?: string | null;
  catIds: string[];
};

type UpdateTaskInput = {
  title?: string;
  endDate?: string | null;
  notes?: string | null;
  catIds?: string[];
};

export type TodayTaskItem = {
  task: {
    id: string;
    title: string;
    recurrence: Recurrence;
    notes: string | null;
  };
  cat: { id: string; name: string; themeColor: ThemeColor };
  dueDate: string;
  completion: {
    id: string;
    taskId: string;
    catId: string;
    dueDate: string;
    completedAt: string;
    completedBy: string | null;
    createdAt: string;
  } | null;
};

export function listTasks(): Promise<Result<CatTask[], ApiError>> {
  return request<CatTask[]>("/api/tasks");
}

export function listTodayTasks(date: string): Promise<Result<TodayTaskItem[], ApiError>> {
  return request<TodayTaskItem[]>(`/api/tasks/today?date=${encodeURIComponent(date)}`);
}

export function createTask(input: CreateTaskInput): Promise<Result<CatTask, ApiError>> {
  return request<CatTask>("/api/tasks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateTask(id: string, input: UpdateTaskInput): Promise<Result<CatTask, ApiError>> {
  return request<CatTask>(`/api/tasks/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteTask(id: string): Promise<Result<Record<string, never>, ApiError>> {
  return request(`/api/tasks/${id}`, { method: "DELETE" });
}

export function completeTask(
  taskId: string,
  input: { catId: string; dueDate: string; completedAt: string },
): Promise<Result<TaskCompletion, ApiError>> {
  return request<TaskCompletion>(`/api/tasks/${taskId}/completions`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function uncompleteTask(
  taskId: string,
  completionId: string,
): Promise<Result<Record<string, never>, ApiError>> {
  return request(`/api/tasks/${taskId}/completions/${completionId}`, {
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

// --- Medical Attachments API ---

export function listMedicalAttachments(
  catId: string,
  recordId: string,
): Promise<Result<MedicalRecordAttachment[], ApiError>> {
  return request<MedicalRecordAttachment[]>(
    `/api/cats/${catId}/medical-records/${recordId}/attachments`,
  );
}

export async function uploadMedicalAttachment(
  catId: string,
  recordId: string,
  file: File,
): Promise<Result<MedicalRecordAttachment, ApiError>> {
  const formData = new FormData();
  formData.append("file", file);
  // multipart/form-data の Content-Type は fetch が boundary 付きで自動設定するため、
  // request<T> ラッパ (application/json を強制) は使わず生 fetch を使う。
  const fetchResult = await ResultAsync.fromPromise(
    fetch(`/api/cats/${catId}/medical-records/${recordId}/attachments`, {
      method: "POST",
      body: formData,
    }),
    toNetworkError,
  );
  if (fetchResult.isErr()) return err(fetchResult.error);
  const res = fetchResult.value;
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return err({
      kind: "http",
      status: res.status,
      message: body.error?.message ?? `HTTP ${res.status}`,
    });
  }
  return ResultAsync.fromPromise(res.json() as Promise<MedicalRecordAttachment>, toNetworkError);
}

export function deleteMedicalAttachment(
  catId: string,
  recordId: string,
  attachmentId: string,
): Promise<Result<Record<string, never>, ApiError>> {
  return request(`/api/cats/${catId}/medical-records/${recordId}/attachments/${attachmentId}`, {
    method: "DELETE",
  });
}

export function medicalAttachmentUrl(
  catId: string,
  recordId: string,
  attachmentId: string,
): string {
  return `/api/cats/${catId}/medical-records/${recordId}/attachments/${attachmentId}`;
}

// --- Blood Test Analysis API ---

export type BloodTestValueInput = {
  itemCode: string;
  itemLabel: string;
  unit: string | null;
  valueText: string;
  valueNumeric: number | null;
  refLow: number | null;
  refHigh: number | null;
  refText: string | null;
  flag: ValueFlag;
  notes: string | null;
};

function analysisBase(catId: string, recordId: string, attachmentId: string): string {
  return `/api/cats/${catId}/medical-records/${recordId}/attachments/${attachmentId}`;
}

export function getBloodTestAnalysis(
  catId: string,
  recordId: string,
  attachmentId: string,
): Promise<Result<{ analysis: BloodTestAnalysis; values: BloodTestValue[] }, ApiError>> {
  return request<{ analysis: BloodTestAnalysis; values: BloodTestValue[] }>(
    `${analysisBase(catId, recordId, attachmentId)}/analysis`,
  );
}

export function triggerBloodTestAnalyze(
  catId: string,
  recordId: string,
  attachmentId: string,
): Promise<Result<{ analysis: BloodTestAnalysis }, ApiError>> {
  return request<{ analysis: BloodTestAnalysis }>(
    `${analysisBase(catId, recordId, attachmentId)}/analyze`,
    { method: "POST" },
  );
}

export function updateBloodTestValue(
  catId: string,
  recordId: string,
  attachmentId: string,
  valueId: string,
  input: Partial<BloodTestValueInput>,
): Promise<Result<{ value: BloodTestValue }, ApiError>> {
  return request<{ value: BloodTestValue }>(
    `${analysisBase(catId, recordId, attachmentId)}/analysis/values/${valueId}`,
    { method: "PUT", body: JSON.stringify(input) },
  );
}

export function addBloodTestValue(
  catId: string,
  recordId: string,
  attachmentId: string,
  input: BloodTestValueInput,
): Promise<Result<{ value: BloodTestValue }, ApiError>> {
  return request<{ value: BloodTestValue }>(
    `${analysisBase(catId, recordId, attachmentId)}/analysis/values`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function deleteBloodTestValue(
  catId: string,
  recordId: string,
  attachmentId: string,
  valueId: string,
): Promise<Result<Record<string, never>, ApiError>> {
  return request<Record<string, never>>(
    `${analysisBase(catId, recordId, attachmentId)}/analysis/values/${valueId}`,
    { method: "DELETE" },
  );
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
