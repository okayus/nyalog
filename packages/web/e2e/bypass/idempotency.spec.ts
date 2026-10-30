import { test, expect, type APIRequestContext } from "@playwright/test";

// Idempotency-Key の配線 (ADR-009 §2)。batch の原子性と PK 衝突の扱いは D1 でしか試せない。

async function createCat(request: APIRequestContext): Promise<string> {
  const res = await request.post("/api/cats", { data: { name: `e2e-idem-${Date.now()}` } });
  expect(res.status()).toBe(201);
  return (await res.json()).id as string;
}

const BODY = { type: "urination", timestamp: "2026-10-30T00:00:00.000Z" };

test("Idempotency-Key: replay 200, mismatch 422, no header creates each time", async ({
  request,
}) => {
  const catId = await createCat(request);
  const url = `/api/cats/${catId}/toilet-records`;
  const key = `e2e-${Date.now()}/urination`;

  const first = await request.post(url, { data: BODY, headers: { "Idempotency-Key": key } });
  expect(first.status()).toBe(201);
  const record = await first.json();

  // 同じ key + 同じ本文 (キー順が違っても) → 保存した本文を 200 で
  const second = await request.post(url, {
    data: { timestamp: BODY.timestamp, type: BODY.type },
    headers: { "Idempotency-Key": key },
  });
  expect(second.status()).toBe(200);
  expect(await second.json()).toEqual(record);

  // 同じ key + 違う本文 → 422
  const mismatch = await request.post(url, {
    data: { type: "defecation", timestamp: BODY.timestamp, condition: "normal" },
    headers: { "Idempotency-Key": key },
  });
  expect(mismatch.status()).toBe(422);
  expect((await mismatch.json()).error.type).toBe("idempotency_key_mismatch");

  // 同じ key を別の cat で使う → path が hash に入るので 422
  const otherCat = await createCat(request);
  const otherPath = await request.post(`/api/cats/${otherCat}/toilet-records`, {
    data: BODY,
    headers: { "Idempotency-Key": key },
  });
  expect(otherPath.status()).toBe(422);

  // ヘッダ無しは毎回 201
  const a = await request.post(url, { data: BODY });
  const b = await request.post(url, { data: BODY });
  expect(a.status()).toBe(201);
  expect(b.status()).toBe(201);
  expect((await a.json()).id).not.toBe((await b.json()).id);

  // 壊れた key は 400 で、記録は作られない
  const bad = await request.post(url, { data: BODY, headers: { "Idempotency-Key": "has space" } });
  expect(bad.status()).toBe(400);

  const list = await request.get(url);
  const ids = ((await list.json()) as Array<{ id: string }>).map((r) => r.id);
  expect(ids).toHaveLength(3);
  expect(ids.filter((id) => id === record.id)).toHaveLength(1);

  await request.delete(`/api/cats/${catId}`);
  await request.delete(`/api/cats/${otherCat}`);
});

test("Idempotency-Key: concurrent posts with one key create exactly one record", async ({
  request,
}) => {
  const catId = await createCat(request);
  const url = `/api/cats/${catId}/toilet-records`;
  const key = `e2e-race-${Date.now()}`;

  const responses = await Promise.all(
    Array.from({ length: 6 }, () =>
      request.post(url, { data: BODY, headers: { "Idempotency-Key": key } }),
    ),
  );
  const statuses = responses.map((r) => r.status()).sort();
  expect(statuses).toEqual([200, 200, 200, 200, 200, 201]);
  const bodies = await Promise.all(responses.map((r) => r.json()));
  expect(new Set(bodies.map((b) => b.id)).size).toBe(1);

  const list = await request.get(url);
  expect(await list.json()).toHaveLength(1);

  await request.delete(`/api/cats/${catId}`);
});
