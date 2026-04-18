# プロジェクトステータス

> このファイルは「今の状態」だけを記録する。履歴は git log と ADR を参照。

## 現在のフェーズ

**CSS 近代化フェーズ — 最新 CSS 標準機能を実践する場として UI を整える**

セキュリティ監査対応 (PR #8〜#12) と SPA HTML への security-headers 拡張 (PR #14) まで完了し、整備系の積み残しはほぼ解消した。ここからは `packages/web/src/index.css` 223 行のベタ書き CSS を、デザイントークン / `@layer` / container queries / View Transitions といった最新 CSS 標準機能で段階的に書き換え、nyalog を「モダン CSS を実践するサンプル」として育てていく。

現状の CSS の棚卸し:

- 要素セレクタ中心 (`body`, `form`, `input`, `li` 等) で CSS custom properties なし → 色・間隔・半径のハードコードが散在
- カスケード整理なし (`@layer` 未使用)
- ダークモード未対応 (`prefers-color-scheme` 未使用)
- レイアウトは Flexbox + `grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))` 1 箇所のみ
- `dvh` / logical properties / `:has()` / `text-wrap: balance` / container queries / View Transitions はいずれも未使用

「学ぶ → 適用 → PR 本文で何を採用したか書く」を 1 PR ずつ回す。

## 進行中

- なし (PR #15 マージ待ち。次は PR-B)

## 次にやること (次セッションの出発点)

### 1. CSS 近代化ロードマップ

PR を分けて「各回で学ぶ 1 機能セット」を決める。順序は「効果 × 他 PR への影響の少なさ」。PR-A (基盤) が揃ったので、以降のトークン参照先は `:root` の `--color-*` / `--space-*` / `--radius-*` / `--font-*` に統一。

#### PR-B: logical properties + dynamic viewport + `:focus-visible` + `text-wrap`

- `margin-inline` / `padding-block` / `inset-block-end` などに置換 (RTL 可能性 + 意味論明確化)
- モバイル URL バー対応で `min-height: 100dvh` / `svh` / `lvh` を使い分ける
- `outline` 用スタイルを `:focus-visible` に切り替え (マウスクリック時の枠消し)
- 見出しに `text-wrap: balance`、本文段落に `text-wrap: pretty`
- `accent-color: var(--color-primary)` でネイティブフォーム要素を統一

#### PR-C: container queries + subgrid でレイアウト近代化

- TodayView の `.quick-grid` を container query (`@container`) ベースに移行。外側 `main` の幅ではなく、カード自身のコンテナ幅で列数を決める
- 猫リストの情報グリッド (名前 / 誕生日 / 操作ボタン) を `display: grid` + `subgrid` で縦横揃え
- `container-type: inline-size` + `@container (min-width: 30rem)` の実例を 2〜3 個つくる

#### PR-D: `:has()` + `popover` + インタラクション

- `:has()` で親要素の状態依存スタイル (例: `li:has(button[aria-expanded="true"])` で展開中カードを強調)
- 確認ダイアログを `[popover]` 属性 + `popover-open:` 擬似クラスに移行 (猫削除・記録削除の confirm)
- `details` / `summary` のスタイルを `::details-content` と `interpolate-size: allow-keywords` で滑らかに開閉

#### PR-E: View Transitions API

- `document.startViewTransition(...)` を React Router の画面遷移と記録追加タイミングに噛ませる
- 追加直後の記録カードに `view-transition-name` を振り、enter アニメーションで視線誘導
- `@view-transition { navigation: auto }` の MPA 版も試す余地があるが、SPA 優先

#### PR-F (任意): scroll-driven animations

- `scroll()` / `view()` で「今日の記録リスト」をスクロール位置に応じて微かに視覚効果
- 派手な演出は避け、実用的な「現在位置フィードバック」に絞る
- 効果が薄ければ skip して構わない

### 2. PR #11 phase 2: `created_by` backfill + NOT NULL 化 (運用 TODO)

PR #11 で `created_by` カラムを NULLABLE で追加済み。既存 1201 件は NULL のまま。残作業:

1. 本番 `users` から代表 1 名の id を確認:
   ```bash
   cd packages/web
   pnpm exec wrangler d1 execute nyalog-db --remote \
     --command "SELECT id, display_name FROM users"
   ```
2. backfill UPDATE (NULL 行のみ):
   ```bash
   pnpm exec wrangler d1 execute nyalog-db --remote --command \
     "UPDATE cats SET created_by = '<USER_ID>' WHERE created_by IS NULL; \
      UPDATE toilet_records SET created_by = '<USER_ID>' WHERE created_by IS NULL;"
   ```
3. 別 PR で Drizzle スキーマを `.notNull()` に変更 → `pnpm db:generate` → drizzle-kit が生成する SQL をレビュー (SQLite の ALTER 制約上テーブル再作成になる可能性大) → マージで本番適用

本番 DB への書き込みを伴うので必ず人間が手動で実行すること。

### 3. 運用 TODO (コード変更なし)

- `INITIAL_REGISTRATION_TOKEN` は家族追加直後に `wrangler secret delete` で必ず消す (現状そうしているが手順化)
- Cloudflare WAF rate-limit を `/api/auth/*` に 1 ルール
- D1 バックアップ方針 (`wrangler d1 export` を週次で手動 or cron) をどこかに書く
- Cloudflare の予算アラートを設定

### 4. (任意) スモーク E2E

- Playwright + CDP Virtual Authenticator で「登録 → ログイン → 猫作成 → トイレ記録 → ログアウト」を 1 本
- staging Worker を別建てするかは規模次第 (今は本番直で OK)
- 優先度は低い。家族以外のユーザに開く段階になってから

## 後回し (Backlog)

- Hono RPC クライアント (chore) — 現在は手書き fetch ラッパで型安全は確保済み
- 薬・動物病院の予定管理 — リリース後に着手
- ご飯・カロリー管理 — リリース後に着手

## 完了済み (最近)

- **CSS 近代化 PR-A — `@layer` / OKLCH トークン / ダークモード (PR #15)** — `packages/web/src/index.css` を `@layer reset, tokens, base, components, utilities` で再構成。OKLCH で表現したセマンティックトークン (`--color-bg` / `--color-surface` / `--color-text` / `--color-primary` / `--color-danger` など) を `:root` に束ね、`color-mix(in oklch, var(--color-primary) 85%, black)` で hover、`color-mix(..., --color-surface)` で tint を派生。`@property --color-primary` / `--color-surface` / `--color-border` を型付き登録し、button / input / li に `transition: background-color 150ms ease, border-color 150ms ease` を追加。`@media (prefers-color-scheme: dark)` でトークン値のみ差し替えて全画面ダーク対応。`index.html` に `<meta name="color-scheme" content="light dark">` も追加。JSX 側の inline `style={{color:"red"|"crimson"}}` 4 箇所を `.error-text` ユーティリティに置換。`packages/web/src` 配下から hex / 名前色リテラルを排除 (grep 0 件) し、成功基準「色リテラルは OKLCH トークン定義 1 箇所のみ」を達成。playwright で light/dark 両モードを視認確認
- **SPA HTML への security-headers 拡張 (PR #14)** — `wrangler.jsonc` の `run_worker_first` を `true` に、`worker/types.ts` の Bindings に `ASSETS: Fetcher` を追加、`worker/index.ts` に `app.notFound` を追加して静的レスポンスを `new Response(res.body, res)` で clone してから返すことで、secureHeaders middleware が SPA HTML にもヘッダを付けられるようにした。本番で `curl -I /` が `content-security-policy: frame-ancestors 'none'` / `x-frame-options: DENY` / HSTS を返すことを確認。clickjacking の穴が塞がった
- **README CI/CD 反映 + status 整理 (PR #13)** — README の「デプロイ」を自動デプロイ前提に書き換え、「CI/CD」節を新設、`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 登録手順を追記
- **セキュリティ監査対応 5 PR 一括マージ (PR #8〜#12)** —
  - PR #8 `fix/credentials-delete-where`: 資格情報 DELETE の WHERE に `userId` を追加 (CRITICAL 防御多層化)
  - PR #9 `feat/security-headers`: `hono/secure-headers` 導入。HSTS / CSP `frame-ancestors 'none'` / X-Frame-Options DENY / Referrer-Policy を worker レスポンスに付与。本番 `curl -I /api/health` で確認済み。SPA HTML 側は経路の都合で未カバー (follow-up あり)
  - PR #10 `fix/global-error-handler`: `app.onError` で 500 を `{error:{type:"internal"}}` に正規化、スタック漏洩防止
  - PR #11 `feat/created-by-column` (phase 1): `cats` / `toilet_records` に NULLABLE で追加、INSERT で自動埋め。ADR-004 で family-shared + createdBy の意図を明文化。phase 2 は手動運用 TODO
  - PR #12 `chore/dev-bypass-guard`: `DEV_BYPASS_USER_ID` を `c.env.ORIGIN` hostname が localhost/127.0.0.1 のときのみ発動させるランタイムガード
- **Claude Code skills を Git 登録 (PR #6)** — `.claude/skills/` 以下を追跡対象化。vercel 製 2 skill (`vercel-react-best-practices`, `web-design-guidelines`) に加え、nyalog 専用セキュリティ skill `security-best-practices` を新規作成（8 セクション 23 ルール、Hono/Drizzle/WebAuthn+JWT セッションに即したコード例）。参考ドキュメント `docs/vibe-coding-security.md` と公開前チェックリストも追加。`.gitignore` で `.claude/settings.local.json` / `.claude/plans/` / `.agents/` を除外
- **過去排尿ログ一括インポート** — おかゆ 862 件 + しらたま 339 件 (計 1201 件) を CSV から変換し本番 D1 に投入。使い捨てスクリプトで `INSERT` SQL を生成 → `wrangler d1 execute --remote --file` で一括流し込み。`created_at` マーカー付きで事故時の一括ロールバック可能にしていた。取り込み後 CSV・SQL・スクリプトとも削除済み
- **トップページのトイレ CRUD 統合** — `TodayView.tsx` を新設、`CatList.tsx` は吸収して削除。今日の全猫記録を 1 画面に集約、クイック記録ボタン (猫×{おしっこ,うんち}) で即投入、時刻 inline 編集 (PUT)、詳細記録リンクから既存 `ToiletRecordView` に遷移。`api.ts` に `updateToiletRecord` を追加。backend 変更なし。併せて dev 専用認証バイパス `DEV_BYPASS_USER_ID` を `sessionMiddleware` に追加し、`docs/local-dev.md` を新設
- 自動デプロイ workflow (`.github/workflows/deploy.yml`) — main push で `wrangler d1 migrations apply --remote` → `wrangler deploy` を実行。Repository secret (`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`) を使用。初回は `pnpm deploy` built-in と npm script 名の衝突で失敗 → root `package.json` の deploy script に `run` を明示して解消、本番デプロイ成功を確認済み
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
