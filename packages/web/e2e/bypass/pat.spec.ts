import { test, expect, type APIRequestContext } from "@playwright/test";

// PAT の配線 (ADR-009)。セッション (dev bypass) で発行 → Bearer で呼ぶ → セッション限定の
// 壁 → 表に無いルートの既定拒否 → 失効。validatePat は D1 が要るので unit では持てず、
// ここが唯一の実行経路。
const DEV_USER_ID = "00000000-0000-4000-8000-000000000000";
const ALL_SCOPES = ["toilet:read", "toilet:write", "tasks:read", "tasks:write"];

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function mint(request: APIRequestContext, name: string, scopes: string[]) {
  const res = await request.post("/api/tokens", { data: { name, scopes } });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; token: string; scopes: string[] };
}

test("PAT: mint, call as Bearer, session-only guard, default deny, revoke", async ({ request }) => {
  // scope を選ばない発行は無い (全権の既定を置かない)
  const noScopes = await request.post("/api/tokens", { data: { name: "x" } });
  expect(noScopes.status()).toBe(400);

  const issued = await mint(request, `e2e-${Date.now()}`, [...ALL_SCOPES].reverse());
  expect(issued.token).toMatch(/^nyalog_pat_[0-9a-f]{64}$/);
  expect(issued.scopes).toEqual(ALL_SCOPES);

  // whoami: Bearer だけで (cookie 無しで) 本人になる
  const me = await request.get("/api/auth/me", { headers: bearer(issued.token) });
  expect(me.status()).toBe(200);
  expect((await me.json()).id).toBe(DEV_USER_ID);

  // 一覧は平文も hash も含まない
  const list = await request.get("/api/tokens");
  expect(list.status()).toBe(200);
  const listed = (await list.json()) as Array<{
    id: string;
    scopes: string[];
    lastUsedAt: string | null;
  }>;
  expect(JSON.stringify(listed)).not.toContain(issued.token.slice("nyalog_pat_".length));
  const row = listed.find((t) => t.id === issued.id);
  expect(row?.scopes).toEqual(ALL_SCOPES);
  expect(row?.lastUsedAt).not.toBeNull();

  // PAT は PAT を増やせない
  const mintWithPat = await request.post("/api/tokens", {
    data: { name: "x", scopes: ["tasks:read"] },
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

test("PAT: toilet-records — write で付けて取り消し、read で一覧を読む", async ({ request }) => {
  const writer = await mint(request, `e2e-toilet-w-${Date.now()}`, ["toilet:write"]);
  const reader = await mint(request, `e2e-toilet-r-${Date.now()}`, ["toilet:read", "tasks:read"]);
  const cat = await request.post("/api/cats", { data: { name: `e2e-pat-${Date.now()}` } });
  expect(cat.status()).toBe(201);
  const catId = (await cat.json()).id as string;
  const url = `/api/cats/${catId}/toilet-records`;

  const created = await request.post(url, {
    headers: bearer(writer.token),
    data: { type: "urination", timestamp: new Date().toISOString() },
  });
  expect(created.status()).toBe(201);
  const record = await created.json();
  expect(record.catId).toBe(catId);

  // 一覧は toilet:read だけが読める (write は read を含まない)
  const listByWriter = await request.get(url, { headers: bearer(writer.token) });
  expect(listByWriter.status()).toBe(403);
  expect((await listByWriter.json()).error).toMatchObject({
    type: "insufficient_scope",
    scope: "toilet:read",
  });
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const listByReader = await request.get(`${url}?since=${since}`, {
    headers: bearer(reader.token),
  });
  expect(listByReader.status()).toBe(200);
  expect((await listByReader.json()).map((r: { id: string }) => r.id)).toContain(record.id);

  // 読み取り専用では書けない。1 件の GET と PUT は表に無い
  const postByReader = await request.post(url, {
    headers: bearer(reader.token),
    data: { type: "urination", timestamp: new Date().toISOString() },
  });
  expect(postByReader.status()).toBe(403);
  expect((await postByReader.json()).error.scope).toBe("toilet:write");
  const getOne = await request.get(`${url}/${record.id}`, { headers: bearer(reader.token) });
  expect(getOne.status()).toBe(403);
  const put = await request.put(`${url}/${record.id}`, {
    headers: bearer(writer.token),
    data: { type: "urination" },
  });
  expect(put.status()).toBe(403);

  // 取り消し: 自分で作った記録は PAT で消せる
  const del = await request.delete(`${url}/${record.id}`, { headers: bearer(writer.token) });
  expect(del.status()).toBe(200);
  const afterDelete = await request.get(url);
  expect((await afterDelete.json()).map((r: { id: string }) => r.id)).not.toContain(record.id);

  await request.delete(`/api/cats/${catId}`);
  await request.delete(`/api/tokens/${writer.id}`);
  await request.delete(`/api/tokens/${reader.id}`);
});
