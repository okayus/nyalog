import { test, expect } from "@playwright/test";

// main.tsx の onUncaughtError → FatalScreen の配線。api.ts は応答を型へキャストするだけなので、
// deploy をまたいで開いたままのタブは形の違う応答を受けうる。task の無い要素を返すと、
// TodayView が描画中に groupByTask で throw し、React はツリーを丸ごと外す。
test("render error shows the reload screen, and reload brings the app back", async ({ page }) => {
  const reported: string[] = [];
  page.on("pageerror", (error) => reported.push(error.name));
  const todayTasks = (url: URL) => url.pathname === "/api/tasks/today";
  await page.route(todayTasks, (route) => route.fulfill({ json: [{}] }));

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "表示できませんでした" })).toBeVisible();
  // アプリは裏に残っていない。
  await expect(page.getByRole("heading", { name: "nyalog" })).toHaveCount(0);
  // 文言は常設の live region へ、例外は既定のハンドラと同じく window の error へ届く。
  await expect(page.getByRole("alert")).toContainText("再読み込みすると直ることがあります");
  await expect.poll(() => reported).toContain("TypeError");

  // 差し替えを外せば、「再読み込み」でアプリが戻る。
  await page.unroute(todayTasks);
  await page.getByRole("button", { name: "再読み込み" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "今日のタスク" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "表示できませんでした" })).toHaveCount(0);
});
