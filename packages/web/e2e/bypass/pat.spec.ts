import { test, expect, type APIRequestContext } from "@playwright/test";

// PAT の配線 (ADR-009)。セッション (dev bypass) で発行 → Bearer で呼ぶ → セッション限定の
// 壁 → 表に無いルートの既定拒否 → 失効。validatePat は D1 が要るので unit では持てず、
// ここが唯一の実行経路。
const DEV_USER_ID = "00000000-0000-4000-8000-000000000000";

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function mint(request: APIRequestContext, name: string) {
  const res = await request.post("/api/tokens", { data: { name } });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; token: string; scopes: string[] };
}

test("PAT: mint, call as Bearer, session-only guard, default deny, revoke", async ({ request }) => {
  const issued = await mint(request, `e2e-${Date.now()}`);
  expect(issued.token).toMatch(/^nyalog_pat_[0-9a-f]{64}$/);
  expect(issued.scopes).toEqual(["toilet:write", "tasks:read", "tasks:write"]);

  // whoami: Bearer だけで (cookie 無しで) 本人になる
  const me = await request.get("/api/auth/me", { headers: bearer(issued.token) });
  expect(me.status()).toBe(200);
  expect((await me.json()).id).toBe(DEV_USER_ID);

  // 一覧は平文も hash も含まない
  const list = await request.get("/api/tokens");
  expect(list.status()).toBe(200);
  const listed = (await list.json()) as Array<{ id: string; lastUsedAt: string | null }>;
  expect(JSON.stringify(listed)).not.toContain(issued.token.slice("nyalog_pat_".length));
  expect(listed.find((t) => t.id === issued.id)?.lastUsedAt).not.toBeNull();

  // PAT は PAT を増やせない
  const mintWithPat = await request.post("/api/tokens", {
    data: { name: "x" },
    headers: bearer(issued.token),
  });
  expect(mintWithPat.status()).toBe(403);
  expect((await mintWithPat.json()).error.type).toBe("session_required");

  // 表に無いルートは scope が全部あっても 403
  const cats = await request.get("/api/cats", { headers: bearer(issued.token) });
  expect(cats.status()).toBe(403);
  expect((await cats.json()).error.type).toBe("insufficient_scope");

  // 形だけ合わせた偽トークン、別 scheme はどちらも 401 (cookie / bypass に落ちない)
  const fake = await request.get("/api/auth/me", {
    headers: bearer(`nyalog_pat_${"0".repeat(64)}`),
  });
  expect(fake.status()).toBe(401);
  const basic = await request.get("/api/auth/me", { headers: { Authorization: "Basic abc" } });
  expect(basic.status()).toBe(401);

  // 失効したら即 401。再失効は冪等。
  const revoke = await request.delete(`/api/tokens/${issued.id}`);
  expect(revoke.status()).toBe(200);
  const afterRevoke = await request.get("/api/auth/me", { headers: bearer(issued.token) });
  expect(afterRevoke.status()).toBe(401);
  expect((await request.delete(`/api/tokens/${issued.id}`)).status()).toBe(200);
  expect((await request.delete(`/api/tokens/${crypto.randomUUID()}`)).status()).toBe(404);
});

test("PAT: toilet-records POST passes with toilet:write and is attributed to the user", async ({
  request,
}) => {
  const issued = await mint(request, `e2e-toilet-${Date.now()}`);
  const cat = await request.post("/api/cats", { data: { name: `e2e-pat-${Date.now()}` } });
  expect(cat.status()).toBe(201);
  const catId = (await cat.json()).id as string;

  const created = await request.post(`/api/cats/${catId}/toilet-records`, {
    headers: bearer(issued.token),
    data: { type: "urination", timestamp: new Date().toISOString() },
  });
  expect(created.status()).toBe(201);
  const record = await created.json();
  expect(record.catId).toBe(catId);

  // 同じ prefix でも GET は表に無い
  const listByPat = await request.get(`/api/cats/${catId}/toilet-records`, {
    headers: bearer(issued.token),
  });
  expect(listByPat.status()).toBe(403);

  // セッションからは見える (createdBy = 本人)
  const listBySession = await request.get(`/api/cats/${catId}/toilet-records`);
  expect(listBySession.status()).toBe(200);
  expect((await listBySession.json()).map((r: { id: string }) => r.id)).toContain(record.id);

  await request.delete(`/api/cats/${catId}`);
  await request.delete(`/api/tokens/${issued.id}`);
});
