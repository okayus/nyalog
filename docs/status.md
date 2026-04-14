# プロジェクトステータス

> このファイルは「今の状態」だけを記録する。履歴は git log と ADR を参照。

## 現在のフェーズ

**リリース仕上げ**

パスキー (WebAuthn) 認証は本番稼働中。自分 (複数デバイス) と家族のアカウントが登録済みで、`INITIAL_REGISTRATION_TOKEN` は失効済み。モバイル向け最小 CSS も投入済み。残るは運用の自動化と、コンテンツ (薬・食事) の積み増し。

## 進行中

- **CI/CD パイプライン整備** — main マージ時の自動デプロイ、および Playwright によるスモーク E2E (Virtual Authenticator) の導入。まずは main への push で `wrangler deploy` を走らせる最小構成から

## 次にやること

優先度順:

1. **main ブランチ保護** — GitHub Settings → Branches で `main` を直 push 禁止 + `check` status check 必須化 (ユーザー作業、1 分)
2. **自動デプロイ** — `.github/workflows/deploy.yml` を追加。`CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit + D1:Edit) を repo secret に投入
3. **DB マイグレーションの自動化** — デプロイ前に `wrangler d1 migrations apply --remote` をワークフロー内で実行
4. **(任意) スモーク E2E** — Playwright + CDP Virtual Authenticator で「登録 → ログイン → 猫作成 → トイレ記録 → ログアウト」を 1 本。staging 環境を別 Worker で建てるかは規模次第
5. **README 更新** — CI/CD が入ったら「手動デプロイ」節を更新

## 後回し (Backlog)

- Hono RPC クライアント (chore) — 現在は手書き fetch ラッパで型安全は確保済み
- 薬・動物病院の予定管理 — リリース後に着手
- ご飯・カロリー管理 — リリース後に着手

## 完了済み (最近)

- 家族用アカウント登録 (パスキー運用サイクル 1 周目)
- 最小モバイル CSS — 44px タップ領域 / 1 カラム / card 風 list
- PR check CI — `vp check` / `tsc` ×2 / `pnpm build` を PR と main push で走らせる
- README — セットアップ / デプロイ / パスキー運用を記載
- パスキー認証への移行 (本番投入・初回ユーザ登録・動作確認まで完了、Cloudflare Access 撤去済み)
- トイレ記録機能 (Discriminated Union ドメイン + CRUD + React UI)
- 猫プロフィール CRUD API
- ADR-003: パスキー認証への移行方針
