import { test, expect } from "@playwright/test";
import { OTHER_CAT_ID, OTHER_RECORD_ID } from "../global-setup";

// dev-bypass user は dev space に居る。global-setup が seed した
// OTHER_SPACE 配下の cat / record の id を直叩きしても 404 になることを確認する。
// PR #8 (DELETE 認可) と ADR-005 PR 3 (per-space membership) の回帰防止。

test("cross-space cat reads are 404", async ({ page }) => {
  // page 経由で dev-bypass cookie / origin の文脈を引き継いで API を叩く
  await page.goto("/");

  const get = await page.request.get(`/api/cats/${OTHER_CAT_ID}`);
  expect(get.status()).toBe(404);

  const list = await page.request.get(`/api/cats`);
  expect(list.status()).toBe(200);
  const cats = (await list.json()) as Array<{ id: string }>;
  expect(cats.find((c) => c.id === OTHER_CAT_ID)).toBeUndefined();
});

test("cross-space cat writes are 404", async ({ page }) => {
  await page.goto("/");

  const put = await page.request.put(`/api/cats/${OTHER_CAT_ID}`, {
    data: { name: "hijacked" },
  });
  expect(put.status()).toBe(404);

  const del = await page.request.delete(`/api/cats/${OTHER_CAT_ID}`);
  expect(del.status()).toBe(404);
});

test("cross-space toilet records under foreign cat are 404", async ({ page }) => {
  await page.goto("/");

  const list = await page.request.get(`/api/cats/${OTHER_CAT_ID}/toilet-records`);
  expect(list.status()).toBe(404);

  const get = await page.request.get(`/api/cats/${OTHER_CAT_ID}/toilet-records/${OTHER_RECORD_ID}`);
  expect(get.status()).toBe(404);

  const del = await page.request.delete(
    `/api/cats/${OTHER_CAT_ID}/toilet-records/${OTHER_RECORD_ID}`,
  );
  expect(del.status()).toBe(404);
});
