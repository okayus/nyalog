## ADR-008: サンドボックス開発と credential ゼロのパイプライン

- ステータス: Accepted
- 日付: 2026-06-12
- 関連 PR: (本 ADR 導入 PR)

## 背景

これまで nyalog は、開発マシンのホスト上で直接 Claude Code を起動して開発してきた。ホスト直接実行には 2 つの構造的リスクがある。

1. **サプライチェーン攻撃**: `pnpm install` の postinstall 等は任意コードをホスト権限で実行できる。`~/.ssh`・`wrangler login` の OAuth 状態・gh トークンが読める環境で依存を入れるのは、依存 1 個の侵害が全クレデンシャルの侵害になる構造。
2. **エージェント自律性とのトレードオフ**: エージェントに権限プロンプトなしで自走させたいが、ホスト上でそれをやるとプロンプトインジェクションや誤動作の影響範囲がホスト全体になる。

同一マシンの mazuoboeru で同じ問題に対する 3 層構成（sandbox / relay / keyless deploy）が確立・実稼働済みであり（mazuoboeru ADR-0003）、nyalog もこれを踏襲する。ただし nyalog には mazuoboeru に無い固有の障害があった: **Workers AI binding はローカルシミュレーションが存在せず、binding が wrangler.jsonc にあるだけで `vp dev` が起動時に Cloudflare 認証つき remote proxy session を張りに行く**。つまり何もしなければ「dev サーバーを起動する」こと自体が sandbox 内に Cloudflare credential を要求する。

## 決定

**原則: sandbox（コンテナ）とリポジトリと GitHub Actions のどこにも、外部サービスの credential を置かない。** credential が必要な操作はすべて境界の外（ホストの relay / Cloudflare 側のビルド基盤）で実行する。

### 1. 開発は egress 制限つき Docker sandbox 内で行う

`docker-compose.yml` + `.docker/`（Anthropic 公開の devcontainer イメージ + default-deny iptables firewall）。`pnpm install`・ビルド・テスト・Claude Code 実行はすべてコンテナ内。egress は明示的な allowlist（npm registry / api.anthropic.com / GitHub / CF docs）のみで、コンテナには Cloudflare token も GitHub token も wrangler login 状態も存在しない。編集はホストエディタ（bind mount）、ホスト側ポートは 5473。

コンテナ内 Claude は `bypassPermissions` を既定とする。安全根拠は firewall（OS レベル境界）+ `git push` の deny ルール（bypass モードでも有効）+ 後述の relay ポリシーであり、許可プロンプトではない。

### 2. push / PR / merge はホスト側 relay が代行する（GitHub App）

コンテナ内は `claude/*` ブランチへの commit まで。ホストの systemd timer（`~/.config/nyalog-relay/`、リポ外＝sandbox から改変不能）が commit を検出し、GitHub App の 1 時間トークンを都度発行して push + PR 作成を行う。`claude/*` 以外・force push・main 直 push は relay が拒否し、main の ruleset（PR 必須 + required check `check` + bypass なし）がサーバー側でも強制する。merge は人間が行うか、HEAD commit に `Relay-Merge: yes` トレーラーを付けた場合のみ relay が CI green 後に squash merge する（迷う変更には付けない）。

### 3. デプロイは Workers Builds（キーレス）へ移行する

`deploy.yml` + GitHub Secrets の `CLOUDFLARE_API_TOKEN`（Workers Scripts Edit + D1 Edit を持つ強権限トークン）を撤去し、Cloudflare 側の git-connected ビルドに置き換える。デプロイ credential は Cloudflare の外に出ない。Worker 名と URL は変わらないため、パスキー（RP_ID, ADR-003）への影響はない。注意点は okayus-skills の `cloudflare-workers-builds-keyless-deploy` に集約済み（D1 Edit 入りカスタムトークン / Root directory = `packages/web` / **非本番ブランチビルド OFF — preview は本番 D1 を共有するため必須**）。

### 4. dev / e2e は `ai` binding を持たない wrangler.local.jsonc で起動する

Workers AI 問題への解は「最小権限の CF token を sandbox に入れる」(案A) ではなく「dev では binding ごと外す」(案B) を採る。

- `packages/web/wrangler.local.jsonc`: `ai` binding が無く `ANALYZER_MODEL=mock` である点だけが wrangler.jsonc と異なる dev 専用設定。D1 / R2 / Workflows / ratelimits はローカルシミュレーションがあるので本番と同一定義を保つ。
- `vite.config.ts`: `NYALOG_WRANGLER_LOCAL=1`（`pnpm dev` / `pnpm preview` が設定）のときだけ local 設定を使う。`pnpm build` は本物の wrangler.jsonc を使うため、デプロイ成果物には `ai` binding が残る。
- `worker/lib/analyzer/mock.ts`: 固定の抽出結果を返す analyzer。factory の `ANALYZER_MODEL=mock` case で選ばれる。
- CI の e2e もこの構成で起動するため、check.yml から Cloudflare credential を撤去した。

**受け入れたトレードオフ**: 血液検査画像の実モデル解析（workers-ai-gemma)は dev / CI では一切実行されず、検証は本番デプロイ後のみになる。これは従来と実質同じ（CI の e2e はもともと AI を実呼びしておらず、token は起動セッションのためだけに渡していた）。代わりに、エージェントが dev で AI 推論コストを発生させる経路と、sandbox 内の credential が構造的に消える。実モデルの精度検証が dev で必要になったら、その時に「検証専用の最小スコープ token を**ホスト側だけ**に置く」案を再検討する。

## 帰結

- Workers Builds 移行完了後、GitHub Actions Secrets は空になる（check.yml は本 ADR で既に token 不要）。
- sandbox 内のエージェントは PR/CI 状態を未認証 REST（`curl -s https://api.github.com/...`、public repo・60 req/h）で読む。`gh` はトークンなしでは動かないため使わない。
- relay（§2）の稼働には GitHub App 作成の人手セレモニーが必要。未稼働の間、push/PR はホストの人間が従来どおり行う（サンドボックス開発自体は relay なしでも機能する）。
- wrangler.jsonc を変更したら wrangler.local.jsonc へ同期する規律が増える（差分は `ai`/`ANALYZER_MODEL` のみという不変条件を両ファイルのコメントに明記）。
