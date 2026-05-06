import { defineConfig } from "vitest/config";

// 純粋関数のユニットテスト用。e2e (Playwright) は別 (test:e2e)。
// CLAUDE.md のテスト方針: ユニットはドメインの "意味"、e2e は配線と "存在の事実"。
export default defineConfig({
  test: {
    include: ["worker/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
