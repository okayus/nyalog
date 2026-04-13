# プロジェクトステータス

> このファイルは「今の状態」だけを記録する。履歴は git log と ADR を参照。

## 現在のフェーズ

**リリース前 / 本番投入待ち**

パスキー (WebAuthn) 認証の実装は完了。PR #16 マージ後、本番のシークレット投入・マイグレーション・デプロイへ進む。

## 進行中

- なし (PR #16 レビュー待ち → マージ後に本番投入へ)

## 次にやること

**PR #16 マージ直後に実施する本番投入** (順序どおり):

1. `wrangler.jsonc` の `RP_ID` / `ORIGIN` を本番 workers.dev ホスト名に確定 (暫定で `localhost` のまま)
2. `openssl rand -hex 32 | pnpm exec wrangler secret put SESSION_SECRET`
3. 本番 D1 にマイグレーション適用: `pnpm db:migrate:prod` (0001–0003 がまだ未適用)
4. `pnpm deploy` で本番デプロイ
5. `openssl rand -hex 32 | pnpm exec wrangler secret put INITIAL_REGISTRATION_TOKEN` → 本番 URL でパスキー登録 → `pnpm exec wrangler secret delete INITIAL_REGISTRATION_TOKEN`
6. 動作確認 (ログイン → 猫プロフィール作成 → トイレ記録)
7. Cloudflare Dashboard の Access Application を削除

**その後のリリース仕上げ**:

- 最低限の CSS / モバイル表示
- README の使い方ドキュメント
- 家族用の追加パスキー登録 (再度 `INITIAL_REGISTRATION_TOKEN` サイクル)

## 後回し (Backlog)

- **#9** Hono RPC クライアント (chore) — 現在は手書き fetch ラッパで型安全は確保済み
- **#7** 薬・動物病院の予定管理 — リリース後に着手
- **#8** ご飯・カロリー管理 — リリース後に着手

## 完了済み (最近)

- #14 パスキー認証の実装 (バックエンド / フロントエンド / ローカル検証) — 本番投入のみ残
- #12 トイレ記録機能 (Discriminated Union ドメイン + CRUD + React UI)
- #11 猫プロフィール CRUD API
- #13 ADR-003: パスキー認証への移行方針
