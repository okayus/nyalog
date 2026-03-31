# デプロイ基盤アーキテクチャ

## 概要

nyalog は **Cloudflare Workers** 上で SPA（React）と API（Hono）を **単一 Worker** として配信する構成を採用している。

```
ブラウザ
  │
  ├── /              → Workers Assets (SPA: index.html)
  ├── /assets/*      → Workers Assets (静的ファイル)
  ├── /health        → Hono Worker (公開)
  └── /api/*         → Cloudflare Access → Hono Worker (認証必須)
                            │
                            └── D1 Database
```

## なぜ単一 Worker か

当初は Pages（フロントエンド）と Workers（API）を別々にデプロイする構成だったが、以下の問題が発生した:

- **Cloudflare Access の Cookie がクロスオリジンで送信されない**: Access はログイン時に保護ドメインに `CF_Authorization` Cookie を発行するが、Pages (`nyalog-web.pages.dev`) と Workers (`nyalog-api.*.workers.dev`) が別オリジンのため、Pages から Workers への API 呼び出し時に Cookie が送信されない
- **CORS の複雑化**: 別オリジンのため CORS 設定が必要になり、Access との組み合わせでさらに複雑になる

単一 Worker に統合することで:
- 同一オリジン（`nyalog.*.workers.dev`）のため Cookie が自動送信される
- CORS 設定が不要
- デプロイが1コマンド

## Workers Assets の仕組み

`wrangler.jsonc` の `assets` 設定:

```jsonc
{
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/health"]
  }
}
```

| リクエスト | 処理 |
|---|---|
| `/api/*` | `run_worker_first` に該当 → Hono Worker が処理（Access 保護下） |
| `/health` | `run_worker_first` に該当 → Hono Worker が処理（Access 保護外） |
| `/assets/index-xxx.js` | 静的アセットとして直接返却（Worker を経由しない = 無料） |
| `/cats/123` 等 | アセットに一致しない → `index.html` を 200 で返却（SPA fallback） |

## Vite + Cloudflare Plugin

`@cloudflare/vite-plugin` が開発とビルドを統合:

- **開発時**: `vp dev` で Vite の HMR + Workers ランタイム（workerd）でローカル実行
- **ビルド時**: `vp build` で Client（SPA）と Worker（Hono）を同時ビルド
- **デプロイ時**: `wrangler deploy` がビルド出力を Assets + Worker としてアップロード

```
vp build
├── dist/client/         → Workers Assets としてアップロード
│   ├── index.html
│   └── assets/index-xxx.js
└── dist/nyalog/         → Worker コードとしてアップロード
    ├── index.js
    └── wrangler.json    → リダイレクト設定
```

## D1 データベース

- **ローカル**: `.wrangler/state/v3/d1/` に SQLite ファイルとして保存
- **本番**: Cloudflare D1（APAC リージョン）
- **マイグレーション**: Drizzle ORM でスキーマ定義 → `drizzle-kit generate` → `wrangler d1 migrations apply`

```bash
pnpm db:generate      # スキーマ変更からマイグレーション SQL を生成
pnpm db:migrate       # ローカル D1 に適用
pnpm db:migrate:prod  # 本番 D1 に適用
```

## 認証: Cloudflare Access

- Access が `/api/*` パスを保護
- 未認証ユーザーは Access のログインページにリダイレクトされる
- 認証済みリクエストには `Cf-Access-Jwt-Assertion` ヘッダが付与される
- Worker 側で JWT を検証し、ユーザーのメールアドレスを取得

詳細は [google-oauth-setup.md](./google-oauth-setup.md) と [cloudflare-access-setup.md](./cloudflare-access-setup.md) を参照。

## デプロイコマンド

```bash
# 開発
pnpm dev              # ローカル開発サーバー（Vite + Workers ランタイム）

# チェック
vp check              # format (Oxfmt) + lint (Oxlint) + type check

# ビルド & デプロイ
pnpm build            # プロダクションビルド
pnpm deploy           # ビルド + Cloudflare にデプロイ

# データベース
pnpm db:generate      # マイグレーション生成
pnpm db:migrate       # ローカル適用
pnpm db:migrate:prod  # 本番適用
```

## ローカル開発時の認証スキップ

ローカルでは Cloudflare Access が動作しないため、`.dev.vars` に以下を設定:

```
DEV_SKIP_AUTH=true
```

これにより `access-auth` ミドルウェアが認証をスキップし、`dev@localhost` としてリクエストを処理する。本番では `DEV_SKIP_AUTH` を設定しないこと。
