# プロジェクトステータス

> このファイルは「今の状態」だけを記録する。履歴は git log と ADR を参照。

## 現在のフェーズ

**リリース仕上げ / CI/CD パイプライン整備**

パスキー (WebAuthn) 認証は本番稼働中。自分 (複数デバイス) + 家族のアカウント登録済み、`INITIAL_REGISTRATION_TOKEN` は失効済み。モバイル向け最小 CSS 投入済み。リポジトリは **public** 化済み (gmail を履歴ごと除去して作り直し) で、main ブランチには ruleset が入っている。

## 進行中

- **CI/CD: 自動デプロイワークフロー追加** — main マージ時に `wrangler deploy` を走らせ、同じジョブ内で D1 マイグレーションも適用する最小構成から

## 次にやること (次セッションの出発点)

### 1. 自動デプロイワークフロー (今やる)

`.github/workflows/deploy.yml` を新規作成:

- トリガ: `push` to `main` (+ 手動 `workflow_dispatch` で再実行可能に)
- ジョブ内容:
  1. `pnpm install --frozen-lockfile`
  2. `pnpm --filter @nyalog/web exec wrangler d1 migrations apply nyalog-db --remote` (本番 D1 にマイグレーション適用、冪等)
  3. `pnpm run deploy` (`vp build && wrangler deploy`)
- 使う GitHub Action: `cloudflare/wrangler-action@v3` か、自前で `npx wrangler deploy` を叩くか。既存の check ワークフロー (`.github/workflows/check.yml`) の Node 22 + pnpm 10 パターンを踏襲

**必要なクレデンシャル (ユーザー作業)**:

- `CLOUDFLARE_API_TOKEN` を GitHub repo secret に投入
  - Cloudflare Dashboard → My Profile → API Tokens → Create Custom Token
  - Permissions: `Account > Workers Scripts > Edit`, `Account > D1 > Edit`, `User > User Details > Read`
  - Account Resources: `Include > <該当アカウント>`
  - TTL: なし or 1 年
- `CLOUDFLARE_ACCOUNT_ID` を GitHub repo secret か vars に投入 (`b206ff3a1f57cd57469b20adaf8be123`)

**テスト方針**: deploy workflow を含む PR をマージして main に入ると実デプロイが走る。初回は恐る恐る、ログを見届けて成功を確認。失敗時は手動 `pnpm run deploy` で復旧 (従来と同じ経路は残る)。

### 2. (自動デプロイの後) README 更新

- 「デプロイ」節を「main へのマージで自動デプロイ。手動は非常時のみ」に書き換え
- 「CI/CD」節を新設して check と deploy の役割を説明
- `CLOUDFLARE_API_TOKEN` の secret 投入手順も README に追記

### 3. (任意) スモーク E2E

- Playwright + CDP Virtual Authenticator で「登録 → ログイン → 猫作成 → トイレ記録 → ログアウト」を 1 本
- staging Worker を別建てするかは規模次第 (今は本番直で OK)
- 優先度は低い。家族以外のユーザに開く段階になってから

## 後回し (Backlog)

- Hono RPC クライアント (chore) — 現在は手書き fetch ラッパで型安全は確保済み
- 薬・動物病院の予定管理 — リリース後に着手
- ご飯・カロリー管理 — リリース後に着手

## 完了済み (最近)

- リポジトリ public 化 + Gmail 履歴スクラブ (`git filter-repo` で 51 コミット書き換え、旧 private リポを削除 → 同名 public で再作成、ruleset で main 保護)
- main branch protection (ruleset): PR 必須 / `check` status check 必須 / force-push 禁止 / 削除禁止
- 家族用アカウント登録 (パスキー運用サイクル 1 周目)
- 最小モバイル CSS — 44px タップ領域 / 1 カラム / card 風 list
- PR check CI — `vp check` / `tsc` ×2 / `pnpm build` を PR と main push で走らせる
- README — セットアップ / デプロイ / パスキー運用を記載
- パスキー認証への移行 (本番投入・初回ユーザ登録・動作確認まで完了、Cloudflare Access 撤去済み)
- トイレ記録機能 (Discriminated Union ドメイン + CRUD + React UI)
- 猫プロフィール CRUD API
- ADR-003: パスキー認証への移行方針

## 本番環境リファレンス (次セッション向け)

- 本番 URL: `https://nyalog.toshiaki-mukai-9981.workers.dev`
- Cloudflare Account ID: `b206ff3a1f57cd57469b20adaf8be123`
- D1 `database_id`: `82db6367-0a73-46d3-baf3-c665adf1e10b` (`wrangler.jsonc` にも記載)
- Worker 名: `nyalog`
- RP_ID: `nyalog.toshiaki-mukai-9981.workers.dev`
- 現在投入済みの secret: `SESSION_SECRET` (HS256 JWT 用)
- `INITIAL_REGISTRATION_TOKEN` は失効済み (家族追加時のみ再投入)
- 手動デプロイ経路は今も生きている: `pnpm run deploy` (`packages/web` から)
