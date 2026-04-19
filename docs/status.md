# プロジェクトステータス

> このファイルは「今の状態」だけを記録する。履歴は git log と ADR を参照。

## 現在のフェーズ

**CSS 近代化フェーズ完了 — 次フェーズ検討中**

PR-A〜F (6 本) で「モダン CSS を実践するサンプル」として nyalog の UI スタックを刷新完了:

- **PR-A** `@layer` + OKLCH トークン + ダークモード (#15)
- **PR-B** logical properties / `dvh` / `:focus-visible` / `text-wrap` / `accent-color` (#16)
- **PR-C** container queries + subgrid (#17)
- **PR-D** `:has()` / `[popover]` / `<details>` + `::details-content` + `interpolate-size` (#18)
- **PR-E** View Transitions API (#19)
- **PR-F** scroll-driven animations (`scroll()` / `view()` timeline) (#20)

今後の新機能は このモダン CSS 前提 (トークン + logical + CQ + popover + VT + scroll-driven) で書く。

## 進行中

- なし

## 次にやること (次セッションの出発点)

### 1. 次フェーズの選択

候補:

- **薬・動物病院の予定管理** — 機能追加、モダン CSS を実戦投入する初の題材
- **ご飯・カロリー管理** — 同上、DB スキーマ設計から
- **PR #11 phase 2** (下記 2 番) — 運用負債の解消
- **スモーク E2E** — Playwright + CDP Virtual Authenticator で基本フローを CI に乗せる

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
- `docs/local-dev.md` と `DEV_BYPASS_USER_ID` の実挙動が乖離: `sessionMiddleware` は `isLocalOrigin(c.env.ORIGIN)` を追加で要求する (PR #12) が、docs は「`DEV_BYPASS_USER_ID` を書くだけで発動」と書いている。`.dev.vars.example` に `ORIGIN=http://localhost:5173` のコメントアウト行を追加 + docs に補足を足すだけの小 PR

### 4. (任意) スモーク E2E

- Playwright + CDP Virtual Authenticator で「登録 → ログイン → 猫作成 → トイレ記録 → ログアウト」を 1 本
- staging Worker を別建てするかは規模次第 (今は本番直で OK)
- 優先度は低い。家族以外のユーザに開く段階になってから

## 後回し (Backlog)

- Hono RPC クライアント (chore) — 現在は手書き fetch ラッパで型安全は確保済み
- 薬・動物病院の予定管理 — リリース後に着手
- ご飯・カロリー管理 — リリース後に着手

## 完了済み (最近)

- **猫ごとのテーマカラー (PR #22)** — `cats` に `theme_color TEXT NOT NULL DEFAULT 'gray'` カラムを追加し、7 色プリセット (`gray` / `pink` / `blue` / `mint` / `peach` / `lavender` / `yellow`) を `THEME_COLORS` + `ThemeColor` (Zod enum + branded) でドメインに宣言。CSS は `[data-cat-theme]` 属性セレクタで `--cat-hue` だけ差し替え、`--cat-tint: oklch(0.96 0.035 var(--cat-hue))` / `--cat-border: oklch(0.82 0.09 H)` / `--cat-accent: oklch(0.62 0.17 H)` を公式派生。ダークモードは明度式だけ差し替え (hue は同じ)。`.record-item` / `.quick-cell` は tint 背景 + border、`.cat-list > li` は左 4px の accent ボーダーで控えめ識別。`ThemeSwatchGroup` コンポーネントで fieldset + button のスウォッチ UI (選択中は `aria-pressed=true` + accent の dot)。`TodayView` の新規作成フォームと既存猫行の両方でテーマ変更可能、`updateCat` API 新設で `PUT /api/cats/:id` の `themeColor` も反映。`ToiletRecordView` も `themeColor` prop で記録カードを色付け。playwright で しらたま相当→pink / おかゆ相当→blue を設定して `oklch(0.96 0.035 10)` / `oklch(0.96 0.035 250)` の計算値とレイアウトを確認
- **動物病院カレンダー埋め込み (PR #21)** — 行きつけのビンゴ動物病院 (bingo-ah.com) の診療カレンダーを nyalog 内に表示。同サイトのカレンダーは公開 Google Calendar を JS 描画しているだけだったのでスクレイピング不要、公式 iframe 埋め込みで済んだ。`src/config/vet-calendar.ts` にカレンダー ID 一覧 + TZ (`Asia/Tokyo`) + `buildGoogleEmbedUrl()` 純粋関数、`src/components/VetCalendar.tsx` に iframe コンポーネントを置き、将来 B 案 (iCal を Worker で fetch + エッジキャッシュ + 自前 UI 描画) に移行する際は VetCalendar の中身だけ差し替えれば済む境界に。CSP は `frame-src https://calendar.google.com https://accounts.google.com` を明示 (後者は embed 内部のサブ iframe が認証状態チェックに使う)。playwright で 2026 年 4 月の月表示カレンダー (院長/副院長/休診日/祝日イベント) が完全ロードされることを確認
- **CSS 近代化 PR-F — scroll-driven animations (PR #20)** — 2 種類の scroll-driven animation を導入。(1) ページ全体のスクロール進捗バー: `index.html` に `<div class="scroll-progress" aria-hidden="true">` を追加し、`position: fixed; inset-block-start: 0; inset-inline: 0; block-size: 2px; background: var(--color-primary)` の 2px バーを `animation-timeline: scroll(root)` + `@keyframes { to { scale: 1 1 } }` でスクロール量に応じて左から右へ scale させる。(2) 記録 li のエントリリビール: `.record-item` に `animation-timeline: view()` + `animation-range: entry 0% cover 35%` + `@keyframes { from { opacity: 0.55 } to { opacity: 1 } }` で各記録が viewport に入ってくるタイミングで fade-in。既存の PR-E View Transition アニメ (`::view-transition-new(.record)`) と直交 (DOM 変更 vs スクロール) するため並存 OK。`@media (prefers-reduced-motion: reduce)` で `.scroll-progress { display: none }` + `.record-item { animation: none }` で a11y 尊重。playwright で `CSS.supports('animation-timeline', 'scroll()' / 'view()')` 両 true、スクロール 75% 時点で `progressScale: 0.7503 1` / width 311px と完全連動を確認
- **CSS 近代化 PR-E — View Transitions API (PR #19)** — 新規 `src/view-transition.ts` に `withViewTransition(update)` ヘルパー: `"startViewTransition" in document` で機能検出 + `flushSync` で React 状態更新を同期 commit してスナップショット取得タイミングを合わせる。未対応ブラウザは即時 `update()` にフォールバック。App.tsx の 4 箇所の `setView` 呼び出し (TodayView ↔ ToiletRecordView ↔ CredentialsView + logout) をラップして画面遷移をブラウザ内蔵フェードに。TodayView / ToiletRecordView の記録追加 / 削除 / 時刻編集での `setRecords*` をラップし、各記録 li に `className="record-item"` + `style={{ viewTransitionName: \`record-${id}\` }}` を付与。`.record-item { view-transition-class: record }`+`::view-transition-new(.record)`= 260ms slide+fade-in /`::view-transition-old(.record)`= 180ms fade-out の`@keyframes`。`::view-transition-old(root)`/`::view-transition-new(root)`で画面全体遷移は 240ms`cubic-bezier(0.2, 0.7, 0.3, 1)`。`@media (prefers-reduced-motion: reduce)`で全 VT pseudo-elements の`animation-duration: 0.01ms`に。playwright で`startViewTransition`/`view-transition-class`/`view-transition-name` のサポート検出 + 実トランジションの start/finish を確認
- **CSS 近代化 PR-D — `:has()` / popover / details + interpolate-size (PR #18)** — 3 箇所の `confirm()` (TodayView 記録削除 / 猫削除 + ToiletRecordView 記録削除) を native `[popover]` ベースの `<ConfirmButton>` に置換。`popoverTarget` + `popoverTargetAction="hide"` で JS ゼロの開閉、`popover="auto"` の light-dismiss (Escape / backdrop click) をそのまま活用。TodayView の 擬似 disclosure `h2 > button[aria-expanded]` + `showCatManager` useState を native `<details><summary><h2>...</h2></summary>` に置換し、`<ul className="cat-manager">` + `::details-content` + `interpolate-size: allow-keywords` で block-size auto への transition を補間可能に。`.cat-list > li:has(:popover-open)` で削除確認 popover 開中の猫カードに `color-mix(in oklch, var(--color-danger) 10%, var(--color-surface))` の warning tint + danger border を当てて視覚フィードバック。`::backdrop` に `backdrop-filter: blur(2px)` の半透明ダーク overlay、削除確定ボタンは `.confirm-popover-actions > button:last-child` で danger 色。React 19 標準の popover 属性タイプで型もクリーン。playwright で `:has(:popover-open)` マッチ / `oklch(0.955 0.02 2.5)` の tint / `oklch(0.55 0.2 25)` の danger border / details ↔ ::details-content + interpolate-size サポートを確認
- **CSS 近代化 PR-C — container queries + subgrid (PR #17)** — `main` を `container: app / inline-size` の named container にし、`.quick-grid` が `@container app (min-inline-size: 30rem)` で 1 列 ↔ 2 列を切替。`.quick-cell` を `container: cell / inline-size` の入れ子 container にして、2 つのプライマリボタンを `.quick-cell-actions` でラップし `@container cell (min-inline-size: 20rem)` で `flex-direction: column ↔ row` を切替。**main が広がって grid が 2 列になると各 cell は逆に狭くなり、cell 自身のコンテナクエリで actions が再び column に戻る** という入れ子コンテナの実例。猫リスト `<ul>` に `className="cat-list"` を付与し、`grid-template-columns: 1fr auto auto` + 子 `<li>` を `display: grid; grid-template-columns: subgrid; grid-column: 1 / -1` で列を継承。名前 / 誕生日 / 削除ボタンが行をまたいで縦に揃う。JSX 側は 2 つ (`<div className="quick-cell-actions">` ラップ追加、`<ul>` → `<ul className="cat-list">`) のみ
- **CSS 近代化 PR-B — logical properties / dvh / `:focus-visible` / `text-wrap` / `accent-color` (PR #16)** — `index.css` の base / components / utilities layer にブロック軸 logical property を導入: `margin-block` / `padding-block` / `border-block-end` / `min-block-size` / `max-inline-size` / `inline-size` / `block-size` に置換 (上下左右が同値の shorthand と `margin: 0`/`padding: 0` などの完全ゼロ系は可読性優先で物理のまま)。`body` に `min-block-size: 100dvh` を追加しモバイル URL バー変動で背景が縮まない状態に。`input/select/textarea:focus` と `button` のフォーカスリングを `:focus-visible` に切替 (マウスクリック時は非表示、Tab 時のみ primary リング)。button にフォーカスリングがなかった状態を解消。見出し (`h1` / `h2`) に `text-wrap: balance`、段落 (`p`) に `text-wrap: pretty` を付与。`:root { accent-color: var(--color-primary) }` でネイティブ radio / checkbox / range / progress もプライマリ青に統一。playwright で `min-block-size: 900px` / `text-wrap: balance|pretty` / `accent-color: oklch(0.55 0.22 263)` / Tab フォーカスリング表示 / マウスクリックで非表示 を視認確認
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
