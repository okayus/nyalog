import { defineConfig } from "vite-plus";
import { cloudflare } from "@cloudflare/vite-plugin";

// NYALOG_WRANGLER_LOCAL=1 (package.json の dev / preview スクリプトが立てる) の
// とき、`ai` binding を持たない wrangler.local.jsonc で起動する: Workers AI には
// ローカルシミュレーションが無く、binding があるだけで起動時に Cloudflare 認証
// つき remote proxy session を張りに行くため、credential ゼロのサンドボックス/CI
// では本物の設定で dev サーバーを立てられない (ADR-008)。
// build (= デプロイ成果物の wrangler.json) は本物の wrangler.jsonc から生成する。
// ※ default export はプレーンなオブジェクトのまま保つこと — vp check の config
//   ローダーは関数形式の export を読めない。
const wranglerLocal = process.env.NYALOG_WRANGLER_LOCAL === "1";

export default defineConfig({
  plugins: [cloudflare(wranglerLocal ? { configPath: "./wrangler.local.jsonc" } : {})],
  lint: {
    ignorePatterns: ["dist/**"],
  },
  fmt: {
    ignorePatterns: ["dist/**"],
  },
});
