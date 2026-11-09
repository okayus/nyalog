import { test, expect, type APIRequestContext } from "@playwright/test";

// GET /api/tasks/due と timestamp の UTC 正規化 (ADR-009 §3, §4)。

async function createCat(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post("/api/cats", { data: { name } });
  expect(res.status()).toBe(201);
  return (await res.json()).id as string;
}

test("GET /api/tasks/due enumerates (task × cat × dueDate) with completion state", async ({
  request,
}) => {
  const catName = `e2e-due-${Date.now()}`;
  const catId = await createCat(request, catName);
  const task = await request.post("/api/tasks", {
    data: {
      title: `e2e-due-${Date.now()}`,
      recurrence: { type: "interval_days", days: 2 },
      startDate: "2026-10-01",
      catIds: [catId],
    },
  });
  expect(task.status()).toBe(201);
  const taskId = (await task.json()).id as string;

  const mine = async (from: string, to: string) => {
    const res = await request.get(`/api/tasks/due?from=${from}&to=${to}`);
    expect(res.status()).toBe(200);
    return ((await res.json()) as Array<Record<string, unknown>>).filter(
      (i) => i.taskId === taskId,
    );
  };

  const before = await mine("2026-10-01", "2026-10-07");
  expect(before.map((i) => i.dueDate)).toEqual([
    "2026-10-01",
    "2026-10-03",
    "2026-10-05",
    "2026-10-07",
  ]);
  expect(before.every((i) => i.catId === catId && i.catName === catName)).toBe(true);
  expect(before.every((i) => i.completed === false)).toBe(true);

  // 完了は completedAt をオフセット付きで送っても UTC Z で保存される
  const done = await request.post(`/api/tasks/${taskId}/completions`, {
    data: { catId, dueDate: "2026-10-03", completedAt: "2026-10-03T09:00:00+09:00" },
  });
  expect(done.status()).toBe(201);
  expect((await done.json()).completedAt).toBe("2026-10-03T00:00:00.000Z");

  const after = await mine("2026-10-01", "2026-10-07");
  expect(after.map((i) => [i.dueDate, i.completed])).toEqual([
    ["2026-10-01", false],
    ["2026-10-03", true],
    ["2026-10-05", false],
    ["2026-10-07", false],
  ]);

  // 期間の検証: 逆順 / 63 日 / 欠け は 400、62 日は 200
  for (const q of [
    "from=2026-10-07&to=2026-10-01",
    "from=2026-10-01&to=2026-12-02",
    "to=2026-10-01",
  ]) {
    expect((await request.get(`/api/tasks/due?${q}`)).status()).toBe(400);
  }
  expect((await request.get("/api/tasks/due?from=2026-10-01&to=2026-12-01")).status()).toBe(200);

  // PAT: tasks:read で due は読めるが、一覧 (/api/tasks) は表に無い
  const mint = await request.post("/api/tokens", { data: { name: `e2e-due-${Date.now()}` } });
  const { id: tokenId, token } = (await mint.json()) as { id: string; token: string };
  const headers = { Authorization: `Bearer ${token}` };
  const viaPat = await request.get("/api/tasks/due?from=2026-10-01&to=2026-10-07", { headers });
  expect(viaPat.status()).toBe(200);
  expect((await viaPat.json()).some((i: { taskId: string }) => i.taskId === taskId)).toBe(true);
  expect((await request.get("/api/tasks", { headers })).status()).toBe(403);

  await request.delete(`/api/tasks/${taskId}`);
  await request.delete(`/api/cats/${catId}`);
  await request.delete(`/api/tokens/${tokenId}`);
});

test("toilet-record timestamp is stored as UTC Z whatever offset was sent", async ({ request }) => {
  const catId = await createCat(request, `e2e-tz-${Date.now()}`);
  const url = `/api/cats/${catId}/toilet-records`;
  const created = await request.post(url, {
    data: { type: "urination", timestamp: "2026-10-30T09:00:00+09:00" },
  });
  expect(created.status()).toBe(201);
  const record = await created.json();
  expect(record.timestamp).toBe("2026-10-30T00:00:00.000Z");

  // since もオフセット付きで渡せる (保存値と同じ形に揃えて比較する)
  const hit = await request.get(`${url}?since=${encodeURIComponent("2026-10-30T08:59:00+09:00")}`);
  expect((await hit.json()).map((r: { id: string }) => r.id)).toContain(record.id);
  const miss = await request.get(`${url}?since=${encodeURIComponent("2026-10-30T09:01:00+09:00")}`);
  expect((await miss.json()).map((r: { id: string }) => r.id)).not.toContain(record.id);

  await request.delete(`/api/cats/${catId}`);
});
