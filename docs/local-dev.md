# ローカル開発ガイド

README の「ローカル開発」の補足。別マシンで開発環境を立ち上げるときや、認証まわりで詰まったときに読む。

## セットアップのおさらい

```bash
pnpm install
cp packages/web/.dev.vars.example packages/web/.dev.vars
# .dev.vars を開いて以下を記入:
#   SESSION_SECRET=...              (openssl rand -hex 32)
#   INITIAL_REGISTRATION_TOKEN=...  (任意、初回登録を試したい時のみ)
pnpm db:migrate                    # ローカル D1 にマイグレーション適用
pnpm dev                           # http://localhost:5173/
```

`.dev.vars` は gitignore 済み。コミットされないので、マシンごとに用意する。

## パスキー認証を dev でバイパスする

本番の認証経路はパスキーのみ (ADR-003)。ローカルでも本番 URL を使えば同じパスキーでログインできるが、以下のような場面では毎回パスキー UI を通すのは煩雑:

- UI の見た目や挙動をぽんぽん確認したい
- 別マシンでさっと動作確認したい
- Playwright などでスクリプト検証したい (CDP Virtual Authenticator を組む前段階)

そのために `sessionMiddleware` は `DEV_BYPASS_USER_ID` という dev 専用の逃げ道を持っている。

### 使い方

`.dev.vars` に次の 2 行を追加 (両方必要):

```bash
DEV_BYPASS_USER_ID=00000000-0000-4000-8000-000000000000
ORIGIN=http://localhost:5173
```

`sessionMiddleware` は `DEV_BYPASS_USER_ID` がセットされていて **かつ** `ORIGIN` が localhost 系 URL (`localhost` / `127.0.0.1` / `::1`) のときだけ bypass する (PR #12 の安全ガード)。`wrangler.jsonc` の default `ORIGIN` は本番 URL なので、`.dev.vars` で明示的に上書きしないと bypass は黙殺され API が 401 を返す。

UUID は何でもよい (上記はゼロ埋めの v4 形) が、同じマシン間で使い回すと D1 上の dev ユーザデータを共有できる。

`pnpm dev` で起動すると、全 API が「このユーザとしてログイン済み」として扱われる:

- `/api/auth/me` → 200 (dev ユーザを返す)
- `/api/cats`, `/api/cats/:id/toilet-records` → 普通に CRUD できる
- 該当ユーザが `users` テーブルに無ければ、ミドルウェアが初回アクセス時に `displayName="dev"` で自動 upsert

### 解除したいとき

`.dev.vars` の `DEV_BYPASS_USER_ID` 行を消す (またはコメントアウトする) → `pnpm dev` 再起動で通常のパスキーフローに戻る。

### 安全性

- `DEV_BYPASS_USER_ID` は `.dev.vars` から読むので、`wrangler secret put` しない限り本番 Worker には絶対反映されない
- 本番 Worker でこの binding が存在しないことは `sessionMiddleware` のコードを読むと分かる (`c.env.DEV_BYPASS_USER_ID` が undefined なら何もせず従来の JWT 検証に進む)
- 念のため、本番シークレットに `DEV_BYPASS_USER_ID` を入れてはいけない。`pnpm --filter @nyalog/web exec wrangler secret list` に現れていないことを時々確認する

## トラブルシューティング

### `pnpm dev` を 2 回叩いたら画面のデータが消えた

vite-plus は同じポートが埋まっていたら自動で次のポートに fallback する (5173 → 5174)。このとき **miniflare の D1 state が 2 インスタンスで競合して** 片方からはテーブルが空に見える現象が起きる。

対処: 余分な dev プロセスを止めてから再起動。

```bash
pkill -f "vp dev"
pnpm dev
```

### パスキー登録したのに 403 `registration_closed` が出る

`INITIAL_REGISTRATION_TOKEN` が `.dev.vars` に無い、または空。READMEの「新規アカウント作成 (招待)」を参照。dev で試すだけなら適当な文字列を入れてサーバ再起動。

### ローカル D1 の中身を直接見たい

```bash
pnpm --filter @nyalog/web exec wrangler d1 execute nyalog-db --local --command "SELECT * FROM cats"
```

`--local` で `.wrangler/state/v3/d1/` 配下の miniflare ストレージを参照する。`--remote` に替えると本番 D1 を触るので誤爆注意。

### ローカル D1 をリセットしたい

```bash
rm -rf packages/web/.wrangler/state
pnpm db:migrate
```

## 型チェック / lint

CI と同じ順序で手元で走らせるには:

```bash
pnpm --filter @nyalog/web exec vp check                                              # format + lint
pnpm --filter @nyalog/web exec tsc --noEmit -p packages/web/tsconfig.json            # フロント
pnpm --filter @nyalog/web exec tsc --noEmit -p packages/web/tsconfig.worker.json     # Worker
pnpm --filter @nyalog/web build                                                       # 実ビルド
```

`vp check --fix` で format 自動修正。
