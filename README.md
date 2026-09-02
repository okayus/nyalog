# nyalog

猫の健康管理 Web アプリ。トイレ記録 / 猫プロフィール CRUD / (今後) 薬・通院・食事の管理を、家族 + テスト含めて最大 4 名規模で運用する個人ツール。

- 本番: `https://nyalog.shiraoka.workers.dev`
- インフラ: Cloudflare Workers (Assets + D1)
- 認証: パスキー (WebAuthn) — 招待制
- スタック: Hono / React / Drizzle ORM / Zod / neverthrow / TypeScript strict

設計判断は `docs/adr/` を、現在のフェーズと残タスクは [`docs/status.md`](./docs/status.md) を参照。

## ローカル開発

> **標準の開発形態は egress 制限つき Docker サンドボックス内** ([ADR-008](./docs/adr/008-sandboxed-development-and-credential-free-pipeline.md))。
> `docker compose up -d && docker compose exec dev zsh` で入り、以降のコマンドはコンテナ内で実行する
> （手順と注意点は [docs/local-dev.md](./docs/local-dev.md) 冒頭）。`wrangler login` は**不要**
> — dev は `ai` binding を持たない `wrangler.local.jsonc` で起動し、Cloudflare 認証なしで動く。

### 必要なもの

- Docker + Docker Compose v2（サンドボックス開発）
- Node.js 22+ / pnpm 10+（コンテナ外でホスト実行する場合のみ）
- Cloudflare アカウント + `wrangler login` — **ホストでの本番操作**（`pnpm deploy` / `pnpm db:migrate:prod`）**にのみ**必要。dev には不要

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

## CI/CD

GitHub Actions で 2 本の workflow が走る:

- **`.github/workflows/check.yml`** — PR / main push に対して `vp check` / `tsc` ×2 / `pnpm build` を実行。main branch protection で必須 status check にしている
- **`.github/workflows/deploy.yml`** — main push で `wrangler d1 migrations apply --remote` → `wrangler deploy` を実行し、自動で本番反映する

### GitHub Repository secrets

deploy workflow が必要とする secret は 2 つ:

- `CLOUDFLARE_API_TOKEN` — Account 権限: `Workers Scripts:Edit` / `D1:Edit` / `Workers R2 Storage:Edit` (Assets 用) を持つ API トークン
- `CLOUDFLARE_ACCOUNT_ID` — `b206ff3a1f57cd57469b20adaf8be123` (dashboard → Workers & Pages から確認)

設定手順:

1. Cloudflare dashboard → My Profile → API Tokens → Create Token → `Edit Cloudflare Workers` テンプレートから作成
2. GitHub リポジトリ → Settings → Secrets and variables → Actions → New repository secret で上記 2 つを登録

## デプロイ

**通常**: main への merge で自動デプロイされる。手動デプロイは不要。

**非常時 (CI が壊れた / ロールバックしたい等)**:

```bash
pnpm db:migrate:prod       # 未適用のマイグレーションを本番に当てる
pnpm run deploy            # vp build && wrangler deploy
```

`SESSION_SECRET` は本番 secret に投入済み。新しい環境にゼロから建てる場合は次の節を参照。

## 認証運用 (パスキー)

ADR-003 のとおり、本アプリはパスキーのみ + 招待制。登録の入口は 2 本だけ:

| 経路 | 誰が | 手段 |
|---|---|---|
| 初回 owner | スペースがまだ無い最初の 1 人 | `INITIAL_REGISTRATION_TOKEN` (下記) |
| 招待リンク | 2 人目以降の家族 | アプリ内でオーナーが発行 (**通常はこちら**) |

### 家族を招待する (アプリ内、wrangler 不要)

1. オーナーがログイン → ヘッダのメニュー → **メンバーを招待**
2. 「招待リンクを作る」→ 出てきた URL をコピー or 共有して家族に渡す
3. 家族がそのリンクを開く
   - アカウントが無い → 表示名を入れてパスキーを作ると、そのままスペースに参加する
   - 既にアカウントがある → 「参加する」だけでそのスペースに加わる

- 招待リンクは **7 日間・1 回だけ**有効。使い切る前に取り消したければ同じ画面の 🗑️ から
- トークンは URL の**フラグメント**に載る (`/invite#token=...`)。サーバのアクセスログにも
  `Referer` にも乗らない。DB には sha256 しか保存されないので、発行画面を離れると二度と表示できない
- 発行できるのは **スペースの owner だけ**。招待から入った人は `member` なので、その人はさらに
  招待できない (増やしたいなら `space_members.role` を SQL で `owner` に上げる)
- 登録・参加は「users / space_members / 招待の消費」を 1 つの D1 batch で行う。
  「登録できたがどのスペースにも属していない」中途半端な状態は作られない

### 初回 owner の登録 (新しい環境を建てた直後だけ)

```bash
# 1. ランダムトークンを払い出して secret に投入
openssl rand -hex 32 | pnpm --filter @nyalog/web exec wrangler secret put INITIAL_REGISTRATION_TOKEN

# 2. 本番 URL の「新規登録」タブで、表示名 + そのトークンを入れてパスキーを登録
#    (この経路は users + spaces + space_members(owner) + credentials を 1 batch で作る)

# 3. 登録できたら secret を即削除 (リプレイ防止)
pnpm --filter @nyalog/web exec wrangler secret delete INITIAL_REGISTRATION_TOKEN
```

`INITIAL_REGISTRATION_TOKEN` が未設定の状態では `/api/auth/register/begin` の初回登録経路が
403 (`registration_closed`) を返す。招待リンク経路はこの secret とは無関係に動く。

### 追加デバイスのパスキー登録

既存ユーザが別のデバイス (スマホ / 別 PC) を使えるようにする場合は、トークン不要:

1. 既にパスキー登録済みのデバイスでログイン
2. ヘッダのメニュー →「パスキー管理」
3. 「このデバイスのパスキーを追加」ボタン → そのデバイスの OS パスキー UI で登録

### パスキー紛失時 / ドメイン変更時

最後の 1 つのパスキーを削除しようとするとサーバが 409 (`last_credential`) を返してブロックする。
全てのパスキーを失った場合や、RP_ID を変えて既存パスキーが全滅した場合は、**旧 `users` 行は
削除せず**、新規ユーザとして登録し直して既存スペースに入り直す。`cats` / `toilet_records` /
`weight_records` / `medical_records` / `cat_tasks` / `cat_task_completions` の `created_by` /
`completed_by` が audit 用に旧行を参照しているため ([ADR-004](./docs/adr/004-family-shared-with-created-by.md))。

- **オーナーが 1 人でも生きているなら**: 上の「家族を招待する」で招待リンクを送るだけでよい。
  猫・記録はユーザではなくスペースに属するので、新ユーザをスペースに入れれば全データが見える
  ([ADR-005](./docs/adr/005-per-space-membership.md))
- **オーナーが全員ログインできなくなったら**: `INITIAL_REGISTRATION_TOKEN` で登録し直した上で、
  既存スペースへの紐付けを SQL でやる (INSERT のみ = cascade リスクなし):

```bash
pnpm --filter @nyalog/web exec wrangler d1 execute nyalog-db --remote --command "SELECT id, display_name, created_at FROM users ORDER BY created_at DESC LIMIT 5;"
pnpm --filter @nyalog/web exec wrangler d1 execute nyalog-db --remote --command "SELECT id, name FROM spaces;"
pnpm --filter @nyalog/web exec wrangler d1 execute nyalog-db --remote --command "INSERT INTO space_members (space_id, user_id, role, created_at) VALUES ('<SPACE_ID>', '<NEW_USER_ID>', 'owner', '<NOW ISO8601>');"
```

使えなくなった旧 credential だけ消したい場合 (旧 `users` 行は残す):

```bash
pnpm --filter @nyalog/web exec wrangler d1 execute nyalog-db --remote --command "DELETE FROM credentials WHERE user_id = '<lost-user-id>';"
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
