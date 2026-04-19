import { test, expect } from "@playwright/test";

test("record survives page reload (D1 write actually happened)", async ({ page }) => {
  const catName = `e2e-persist-${Date.now()}`;

  await page.goto("/");
  await page.locator("details.cat-manager > summary").click();
  await page.getByLabel("名前").fill(catName);
  await page.getByRole("button", { name: "追加" }).click();
  await page.getByRole("button", { name: `${catName} の排尿を記録` }).click();

  const recordItem = page.locator(".record-item", { hasText: catName });
  await expect(recordItem).toHaveCount(1);

  await page.reload();

  const afterReload = page.locator(".record-item", { hasText: catName });
  await expect(afterReload).toHaveCount(1);
  await expect(afterReload).toContainText("💧");
});
