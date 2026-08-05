# ローカル開発ガイド

README の「ローカル開発」の補足。別マシンで開発環境を立ち上げるときや、認証まわりで詰まったときに読む。

## サンドボックス開発（標準の開発形態, ADR-008）

`pnpm install`・ビルド・テスト・Claude Code は **egress 制限つきコンテナ内**で実行する。ホストで `pnpm install` しない（サプライチェーン対策。理由と全体像は [ADR-008](./adr/008-sandboxed-development-and-credential-free-pipeline.md)）。

```bash
docker compose up -d            # 初回は build に数分。logs に Firewall verification passed ×2 が出ること
docker compose exec dev zsh     # コンテナに入る (workspace = リポジトリ root)
# 以降のこのガイドのコマンドは全部コンテナ内で実行する
```

- ホスト側は**エディタと git だけ**（bind mount なので編集は即時反映）。コンテナに Cloudflare/GitHub の credential は入れない（`wrangler login` もしない）
- dev サーバーはコンテナ内で `pnpm dev -- --host 0.0.0.0` → ホストのブラウザから **http://localhost:5473/** （他プロジェクトとのポート衝突回避。コンテナ内部は 5173 のまま）
- コンテナ内 `claude` の初回認証は OAuth URL をホストブラウザで開いてコードを貼る（auth は named volume に永続化され `docker compose down` でも消えない）
- **血液検査画像の解析は dev では mock 固定**: dev/e2e は `ai` binding を持たない `wrangler.local.jsonc` で起動するため（起動に Cloudflare 認証が必要になるのを避ける）、analyzer は固定値を返す `mock` になる。実モデル (workers-ai-gemma) の検証は本番デプロイ後のみ
- 新しい外部ドメインに繋ぐ必要が出たら `.docker/init-firewall.sh` の allowlist に追記 → `docker compose down && docker compose build && docker compose up -d`（プロジェクトディレクトリで `-f` なしで実行。症状は「新しいホストだけ繋がらない/ハングする」）

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

### 起動ログの `Unable to fetch the Request.cf object! ... EHOSTUNREACH`

無害。miniflare が本物の `Request.cf` データを Cloudflare から取りに行き、サンドボックスの egress firewall に弾かれて placeholder にフォールバックしただけ（設計どおり）。dev の動作には影響しない。

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

### e2e を回したら画面から猫が消えた

**仕様。** `e2e/global-setup.ts` が毎回 dev-bypass ユーザの `cats` / `toilet_records` を全削除する（他スペースの fixture を毎回 ensure し直すため）。`cats` の削除は cascade で `cat_task_cats` / `cat_task_completions` も落とすので、猫タスクの対象猫紐付けまで消える。`cat_tasks` 本体だけが残り、対象猫ゼロのタスクが並ぶ。

fixture を戻す:

```bash
pnpm --filter @nyalog/web exec wrangler d1 execute nyalog-db --local --file scripts/dev-seed.sql
```

猫 2 匹（しらたま / おかゆ）と、dev スペースの既存タスク全部への紐付けが入る。何度流しても同じ結果になる。トイレ記録・体重記録は入れていない（画面から作る想定）。

**画面で動作確認しながら作業しているなら、確認を撮り終えてから e2e を回すこと。**

## CSS / a11y を触る PR の before/after 実測

`scripts/measure-ui.mjs` が dev サーバー相手に 9 ビューを巡回し、JSON に落とす。2 つの JSON を突き合わせると Markdown 表が出るので、そのまま commit メッセージに貼れる。

拾うもの:

- **見た目**: `input` / `select` / `textarea` / `button` / `label` / `fieldset` の寸法・display・flex 方向・font-size・色・枠・accent-color
- **a11y**: 上記に加えて `h1`〜`h3` / `[aria-live]` / `[role]` を対象に、`role` / `aria-live` / `aria-invalid` / `aria-busy` / `tabindex` / `disabled`
- **ビュー単位**: `@title` (`document.title`) と `@focus` (`activeElement`)

a11y を表に出しているのは、**「読まれるか」は目視で判定できない**から。アクセシビリティツリーに何が居るかは属性として出せるので、レビュアーが commit メッセージだけで検証できる形にする。`@focus` を撮る位置がビュー遷移直後なのは、ビューに入るのに押したボタンごと DOM が消えるため — そこが View Transition 解決後の着地点そのものになる。

```bash
D="docker compose exec -T dev"                                # ホストから叩く場合
$D pnpm --filter @nyalog/web measure:ui --out /tmp/before.json   # 変更前
# ...CSS や aria を編集...
$D pnpm --filter @nyalog/web measure:ui --out /tmp/after.json
$D pnpm --filter @nyalog/web measure:ui --diff /tmp/before.json /tmp/after.json
```

- **ホストで直接は走らない。** chromium はイメージに焼いてあり（`.docker/Dockerfile` の `PLAYWRIGHT_VERSION`）ホストには無い。加えてホストの `pnpm` は `node_modules` を purge しにかかる（ADR-008）。必ず `docker compose exec` 越しに走らせる。JSON の置き場もコンテナ内の `/tmp`（`--diff` も同じ場所で走る）
- コンテナ内なので `--url` は既定の 5173 のまま。ホストのブラウザから見る時だけ 5473
- `--theme dark` / `--viewport 1280x900` / `--views tasks,toilet` / `--shots <dir>`（スクリーンショットも保存）
- **before と after で dev データを変えないこと。** 猫の名前が変わると要素のラベルがずれる。計測の途中で `pnpm test:e2e` を回さない（上記のとおり猫が消える）
- 意図的に無視しているもの: checkbox / radio の `color` と `font-size`（ネイティブ描画で文字を持たないので見た目に出ない）。ビューに入るのに押したボタンの hover transition は、ポインタを逃がして 300ms 待ってから計測している

同じ状態で 2 回走らせて「変化 0 件 / 不変 315 件」になることを確認済み。差分が出たら本物の変化。

## フェッチ量 / レンダリング量を触る PR の before/after 実測

`scripts/measure-perf.mjs` が `measure-ui.mjs` の対。「何件取ってきて、何ノード描いたか」を数える。

```bash
D="docker compose exec -T dev"
$D pnpm --filter @nyalog/web exec node scripts/measure-perf.mjs --out /tmp/perf-before.json
# ...実装...
$D pnpm --filter @nyalog/web exec node scripts/measure-perf.mjs --out /tmp/perf-after.json
$D pnpm --filter @nyalog/web exec node scripts/measure-perf.mjs --diff /tmp/perf-before.json /tmp/perf-after.json
```

拾うもの: `/api/` の本数・レスポンス長・配列要素数 / DOM のノード数と `.record-item` 数 / CDP `Performance.getMetrics` の `Nodes` `LayoutObjects` `LayoutCount` `RecalcStyleCount` と各 Duration。

- **CSS ルール 1 本の効きを見るなら `--override` を使う。** stash して撮り直すより確実:
  `--override '.record-item { content-visibility: visible !important }'` を付けた JSON と素の JSON を `--diff` する
- **`api.reqs` / `api.records` は dev では本番の 2 倍出る** (StrictMode が effect を二度走らせる)。比率の比較には使えるが絶対値を本番の数字として書かない
- **`content-visibility` でスキップされた件数は JS から数えられない。** `checkVisibility()` も `getBoundingClientRect()` も、問い合わせた時点で display lock が解けて「全部描いた」しか返さない。効きは `cdp.LayoutObjects` で見る
- **headless shell では `content-visibility` の off-screen スキップ自体が走らない。** 最小ページで試しても 200/200 描画される。実際に効いているかの確認は実ブラウザ (Playwright MCP など) でやる

## before/after を撮る (stash の自動化)

上の 2 つを手で回すと、`git stash` → 計測 → `git stash pop` を毎回組むことになる。**`scripts/measure-ab.sh` がそれをやる**（ホストからでもコンテナ内からでも動く）:

```bash
scripts/measure-ab.sh --marker contain-intrinsic-size        # ui (light/dark) + perf
scripts/measure-ab.sh --marker 'limit: PAGE_SIZE' --perf     # perf だけ
scripts/measure-ab.sh --marker foo --ui --views toilet,today # 対象を絞る
```

`--marker` は**変更後にだけ現れる文字列**。dev サーバーが実際に配っている中身にこれが出入りするのをポーリングして、Vite の HMR が追いつくのを待つ。手で組んだ時に踏んだ 2 つをここに閉じ込めてある:

- **stash の取りこぼし。** 途中で失敗すると作業ツリーが stash に入ったまま残り、気づかず commit すると変更が半分消える（実際に一度残った）。`trap` で必ず戻す
- **目印の選び間違い。** 変更前から存在する文字列を渡すと「消えるのを待つ」が永久に成立しない（計画 3 で `content-visibility` を渡して踏んだ — 既存の `::details-content` の transition に入っていた）。今の dev サーバーに見えるかを先に確かめ、消えなければタイムアウトして理由を出す

**計測には本番規模のデータが要る。** `dev-seed.sql` は記録を入れていない（画面から作る想定）ので、撒くのは別スクリプト:

```bash
docker compose exec -T dev sh -c 'cd packages/web && node scripts/dev-seed-bulk.mjs'
# しらたま 900 件 / おかゆ 320 件 + 体重。--records で件数を変えられる
```

固定 seed なので何度流しても同じ形になる。消すのは dev の猫 2 匹の記録だけで、cross-space の fixture は残す。`--local` 固定（本番 D1 には流せない）。**日付をまたいだら撒き直すこと** — 「今日」の件数が変わって today ビューの計測がずれる。

## CI の状態を引く

```bash
scripts/ci-status.sh            # HEAD の check-runs と PR 番号
scripts/ci-status.sh --watch    # 決着が付くまで 30 秒ごとに引き直す
```

`git rev-parse HEAD` の sha で `commits/<sha>/check-runs` を引く。branch 名で引くとリレー（60 秒 timer）が push する前の古い sha の結果が返り、CI 完了を待つループが前の commit の success で誤って抜ける（CLAUDE.md）。sha 固定をスクリプトに焼いてあるので、追いコミット後もそのまま使える。

終了コードは 0 = 全部 success / 1 = failure あり / 2 = pending か push 前。PR 番号も出るので、`docs/plans/` に `✅ (PR #nn)` を書く時の確認に使える。

## 型チェック / lint

CI と同じ順序で手元で走らせるには:

```bash
pnpm --filter @nyalog/web exec vp check                                              # format + lint
pnpm --filter @nyalog/web exec tsc --noEmit -p packages/web/tsconfig.json            # フロント
pnpm --filter @nyalog/web exec tsc --noEmit -p packages/web/tsconfig.worker.json     # Worker
pnpm --filter @nyalog/web build                                                       # 実ビルド
```

`vp check --fix` で format 自動修正。
