import { test, expect } from "@playwright/test";

test("critical path: create cat, quick record, edit time, delete", async ({ page }) => {
  const catName = `e2e-${Date.now()}`;

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "nyalog" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "今日のトイレ記録" })).toBeVisible();

  await page.locator("details.cat-manager > summary").click();
  await page.getByLabel("名前").fill(catName);
  await page.getByRole("button", { name: "追加" }).click();

  const quickUrinate = page.getByRole("button", { name: `${catName} の排尿を記録` });
  await expect(quickUrinate).toBeVisible();
  await quickUrinate.click();

  const recordItem = page.locator(".record-item", { hasText: catName });
  await expect(recordItem).toHaveCount(1);
  await expect(recordItem).toContainText("💧");

  await recordItem.getByRole("button", { name: "時刻を編集" }).click();
  // 固定時刻だと CI 実行時刻によっては未来扱いされる (Timestamp は future を拒否)。
  // record 作成日の 00:00 は必ず過去なので安全。
  await recordItem.getByLabel("時刻").fill("00:00");
  await recordItem.getByRole("button", { name: "保存" }).click();
  await expect(recordItem.locator("time")).toHaveText("00:00");

  await recordItem.getByRole("button", { name: "記録を削除" }).click();
  await page.getByRole("button", { name: "削除する" }).click();
  await expect(page.locator(".record-item", { hasText: catName })).toHaveCount(0);
});
