# nyalog

猫の健康管理 Web アプリ。トイレ記録 / 猫プロフィール CRUD / (今後) 薬・通院・食事の管理を、家族 + テスト含めて最大 4 名規模で運用する個人ツール。

- 本番: `https://nyalog.toshiaki-mukai-9981.workers.dev`
- インフラ: Cloudflare Workers (Assets + D1)
- 認証: パスキー (WebAuthn) — 招待制
- スタック: Hono / React / Drizzle ORM / Zod / neverthrow / TypeScript strict

設計判断は `docs/adr/` を、現在のフェーズと残タスクは [`docs/status.md`](./docs/status.md) を参照。

## ローカル開発

### 必要なもの

- Node.js 20+
- pnpm 10+
- Cloudflare アカウント (`wrangler login` 済み)

### セットアップ

```bash
pnpm install
cp packages/web/.dev.vars.example packages/web/.dev.vars
# .dev.vars に SESSION_SECRET / INITIAL_REGISTRATION_TOKEN を記入
pnpm db:migrate            # ローカル D1 にマイグレーション適用
pnpm dev                   # http://localhost:5173/
```

`packages/web/wrangler.jsonc` の `RP_ID` / `ORIGIN` は本番ホスト名固定。**ローカル動作確認はパスキー登録まで本番 URL を使う想定**。完全ローカルで試したい場合は wrangler.jsonc を一時的に `localhost` に書き換える。

dev 環境でパスキー認証を丸ごとバイパスしたい (別マシンでの動作確認や Playwright 検証向け) 場合は [`docs/local-dev.md`](./docs/local-dev.md) を参照。

### よく使うコマンド

```bash
pnpm dev                   # 開発サーバー
pnpm build                 # プロダクションビルド
pnpm --filter @nyalog/web exec vp check       # format / lint
pnpm --filter @nyalog/web exec tsc --noEmit -p packages/web/tsconfig.json         # フロント型チェック
pnpm --filter @nyalog/web exec tsc --noEmit -p packages/web/tsconfig.worker.json  # Worker 型チェック

pnpm db:generate           # スキーマからマイグレーション生成
pnpm db:migrate            # ローカル D1 適用
pnpm db:migrate:prod       # 本番 D1 適用
```

## デプロイ

```bash
pnpm db:migrate:prod       # 未適用のマイグレーションを本番に当てる
pnpm deploy                # vp build && wrangler deploy
```

`SESSION_SECRET` は本番 secret に投入済み。新しい環境にゼロから建てる場合は次の節を参照。

## 認証運用 (パスキー)

ADR-003 のとおり、本アプリはパスキーのみ + 招待制。新規ユーザを増やすたびに「初回登録トークンを払い出して使い切る」サイクルを回す。

### 新規アカウント作成 (招待)

```bash
# 1. ランダムトークンを払い出して secret に投入
openssl rand -hex 32 | pnpm --filter @nyalog/web exec wrangler secret put INITIAL_REGISTRATION_TOKEN

# 2. 表示されたトークンを招待者に渡す (Signal/直接対面 など、痕跡が残らない経路で)

# 3. 招待者は本番 URL を開いて「新規登録」タブから:
#    - 表示名
#    - 上記トークン
#    - デバイス名 (任意)
#    を入力 → OS のパスキー UI で登録

# 4. 登録完了を確認したら secret を即削除 (リプレイ防止)
pnpm --filter @nyalog/web exec wrangler secret delete INITIAL_REGISTRATION_TOKEN
```

`INITIAL_REGISTRATION_TOKEN` が未設定の状態では `/api/auth/register/begin` が 403 (`registration_closed`) を返すので、招待制が壊れない。

### 追加デバイスのパスキー登録

既存ユーザが別のデバイス (スマホ / 別 PC) を使えるようにする場合は、トークン不要:

1. 既にパスキー登録済みのデバイスでログイン
2. ヘッダの「パスキー管理」を開く
3. 「このデバイスのパスキーを追加」ボタン → そのデバイスの OS パスキー UI で登録

### パスキー紛失時

最後の 1 つのパスキーを削除しようとするとサーバが 409 (`last_credential`) を返してブロックする。万一全てのパスキーを失った場合は、wrangler 経由で D1 を直接操作してリカバリ:

```bash
pnpm --filter @nyalog/web exec wrangler d1 execute nyalog-db --remote --command "DELETE FROM credentials WHERE user_id = '<lost-user-id>'; DELETE FROM users WHERE id = '<lost-user-id>';"
# → その後、新規招待トークンサイクルでアカウントを再作成
```

## ゼロから本番環境を構築する

新しい Cloudflare アカウント / Worker 名で再デプロイする手順:

1. `packages/web/wrangler.jsonc` の `name` と `RP_ID` / `ORIGIN` を新しいホスト名に書き換える (パスキーは RP_ID に紐付くため、変更したら全ユーザ再登録になる)
2. D1 を作成: `pnpm --filter @nyalog/web exec wrangler d1 create nyalog-db` → 出てきた `database_id` を `wrangler.jsonc` に書く
3. `pnpm db:migrate:prod` でマイグレーション適用
4. `openssl rand -hex 32 | pnpm --filter @nyalog/web exec wrangler secret put SESSION_SECRET`
5. `pnpm deploy` で初回デプロイ
6. 上記「新規アカウント作成 (招待)」サイクルで自分のパスキーを登録

## プロジェクト構成

```
nyalog/
├── packages/web/                # 単一 Cloudflare Worker (SPA + API)
│   ├── src/                     # React フロントエンド
│   │   ├── App.tsx
│   │   ├── api.ts               # fetch ラッパ + authApi (WebAuthn)
│   │   └── components/          # AuthView / CredentialsView / CatList / ToiletRecordView
│   ├── worker/                  # Hono バックエンド
│   │   ├── index.ts             # ルーティング配線
│   │   ├── domain/              # Branded Type + Zod + neverthrow ドメイン層
│   │   ├── middleware/          # session / challenge-cookie
│   │   ├── routes/              # cats / toilet-records / auth
│   │   └── db/schema.ts         # Drizzle スキーマ
│   ├── drizzle/                 # マイグレーション
│   └── wrangler.jsonc
├── docs/
│   ├── adr/                     # Architecture Decision Records
│   └── status.md                # 現在のフェーズと残タスク
├── CLAUDE.md                    # コーディング思想とワークフロー
└── README.md
```

## ライセンス

私的利用のため未設定。
