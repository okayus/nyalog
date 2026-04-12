import type { Cat } from "../worker/domain/cat";
import type { ToiletRecord, StoolCondition } from "../worker/domain/toilet-record";

type CreateCatInput = { name: string; birthday?: string | null };

type CreateToiletRecordInput =
  | { type: "urination"; timestamp: string }
  | { type: "defecation"; timestamp: string; condition: StoolCondition };

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
    throw new Error(body.error?.message ?? `HTTP ${res.status}`);
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

export function deleteToiletRecord(catId: string, id: string): Promise<Record<string, never>> {
  return request(`/api/cats/${catId}/toilet-records/${id}`, {
    method: "DELETE",
  });
}
