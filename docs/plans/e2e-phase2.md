# e2e Phase 2: WebAuthn + 認可横流れ系 (設計メモ)

[status.md](../status.md) の Backlog からリンクされる詳細。dev bypass を切った別 webServer が必要なため優先度低。着手時にこのメモから始める。

- **2-webServer 構成**: `bypass` (port 5173, 既存) と `real-auth` (port 5174, `DEV_BYPASS_USER_ID` なし / `RP_ID=localhost` / `INITIAL_REGISTRATION_TOKEN` あり) を Playwright の `webServer` 配列で並走。D1 state は `--persist-to .wrangler/state_bypass` / `.wrangler/state_realauth` で分離
- `.dev.vars.realauth` を新設 (RP_ID=localhost / ORIGIN=http://localhost:5174 / DEV_BYPASS_USER_ID を書かない)。`wrangler.jsonc` は触らない
- CDP Virtual Authenticator fixture を `e2e/helpers/webauthn.ts` に (`page.context().addVirtualAuthenticator`)
- テスト 3 本:
  - `webauthn.spec.ts` — 登録 (`INITIAL_REGISTRATION_TOKEN` + Virtual Authenticator) → ログアウト → 再ログイン → `/api/auth/me` で自分が見える
  - `unauthorized.spec.ts` — Cookie 無し状態で `/` に AuthView が出る / `/api/cats` が 401
  - `cross-user.spec.ts` — user A で猫 + 記録作成 → ログアウト → user B で登録 → A の `catId` / `recordId` を直接 DELETE で 404 (PR #8 WHERE 句漏れ回帰防止)
- CI 実行時間は +1〜2 分見込み。`check.yml` の step 追加だけで完結
