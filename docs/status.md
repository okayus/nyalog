# プロジェクトステータス

> このファイルは「今の状態」だけを記録する。履歴は git log と ADR を参照。

## 現在のフェーズ

**フロントエンド改善フェーズ (2026-08-04 開始)**。`modern-web-guidance` (12 ガイド) + `vercel-react-best-practices` の両 skill でフロント全体 (index.html / index.css / 全コンポーネント / api.ts) を監査し、改善項目と実施順を確定した。「次にやること > 1」を上から順に PR 化していく。

**セキュリティ検査・防御強化フェーズ**は主要対応 (auth rate limit / Observability / robots.txt / セキュリティヘッダ) を反映済み。CT Log 経由で外部スキャン bot に晒される前提の防御は入っており、残タスクは運用系と再検証のみ (「次にやること > 2」)。

**開発環境がサンドボックス化された** ([ADR-008](./adr/008-sandboxed-development-and-credential-free-pipeline.md))。開発は egress 制限つきコンテナ内（credential ゼロ）、dev/e2e は `ai` binding なしの `wrangler.local.jsonc` + mock analyzer で起動し、CI から Cloudflare token を撤去済み。

**ホスト側リレー稼働開始** (2026-06-12)。GitHub App `nyalog-relay` + systemd timer (60s)。サンドボックス内エージェントは `claude/*` ブランチへ commit するだけで push / PR 化され、`Relay-Merge: yes` トレーラーで CI green 後の自動 merge まで委任できる（PR #65 で E2E 実証済み）。

**workers.dev サブドメインを `shiraoka` に改名** (2026-06)。全パスキーが RP_ID 束縛で無効化されるため、家族の再登録 + 既存スペースへの再紐付けを実施する（手順: `packages/web/scripts/2026-06-subdomain-rename-rebind.sql`）。

**デプロイは Workers Builds（キーレス）に完全移行** (2026-06-12)。初回ビルド green・非本番ブランチビルド OFF 確認後、`deploy.yml` と GitHub Actions Secrets（`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`）を撤去。デプロイ credential は Cloudflare の外に存在しない。残タスク: 旧デプロイ用 API トークンの CF ダッシュボードでの失効、D1 週次バックアップ導入（後日）。

**Agent skills を vendoring に統一 + modern-web-guidance 導入** (2026-08-03、PR [#70](https://github.com/okayus/nyalog/pull/70))。Google Chrome / Microsoft Edge チームの [modern-web-guidance](https://github.com/GoogleChrome/modern-web-guidance) を入れ、HTML/CSS/クライアント JS を書く前に必ず引く運用にした。あわせて third-party skill は `.claude/skills/` に実体を置く方針に統一（`--copy` 必須。既定の symlink は gitignore 済みの `.agents/` を指すため clone 先で必ず壊れ、しかも無警告 — `vercel-react-best-practices` が 2 ヶ月これで壊れていた）。ルールと Browser Support 方針（Baseline Newly available まで採用可 / polyfill は入れない）は CLAUDE.md の「Agent skills の管理」「フロントエンド: モダン Web 前提」に記載。`web-design-guidelines` は 2 ヶ月壊れたまま誰も困らなかったため lock ごと撤去。

## 直近完了フェーズ

**猫タスク (定期 todo) 機能 完了** (PR [#61](https://github.com/okayus/nyalog/pull/61) + [#62](https://github.com/okayus/nyalog/pull/62))

薬・通院・グルーミング等の定期タスクを猫毎にチェックリスト化する新機能。schema + domain + API の PR-1 と UI の PR-2 に分割:

- **PR-1 ([#61](https://github.com/okayus/nyalog/pull/61))** schema + domain + API: 3 テーブル (`cat_tasks` / `cat_task_cats` 多対多 / `cat_task_completions` UNIQUE(task,cat,due_date))。`Recurrence` は discriminated union (`daily | interval_days | interval_months | once`)、純粋関数 `isDueOn` / `enumerateDueDates` で月末日/年跨ぎ/endDate 打ち切りを表現。`/api/tasks` で CRUD + `GET /today?date=` (task×cat フラット list + completion 状態) + `POST|DELETE /:id/completions[/...]`。49 vitest cases。Migration `0011_*.sql` は CREATE TABLE のみで rebuild なしのため D1 CASCADE 事故リスクなし
- **PR-2 ([#62](https://github.com/okayus/nyalog/pull/62))** UI: `TodayView` に「今日のタスク」セクション (タスク毎にカード、対象猫毎にチェックボックス、完了は打ち消し線 + 完了時刻 + 画面残し)、`TasksView` 新規 (タイトル / 繰り返し radio + 必要時 N 入力 / 開始日 / 終了日 / 対象猫複数選択 / メモ / inline edit + delete)。`App.tsx` View union に `{ kind: "tasks" }` 追加、TodayView から「タスク管理 →」遷移。Playwright MCP で create → check → reload persist → uncheck → edit → delete の golden path 確認済、console 0 errors

月カレンダー表示 / 通知 / 週次 (曜日指定) は意図的にスコープ外 (将来 PR)。e2e は未実装 (クリティカルパス外 + 認可は既存パターンの素直な複製)。

**血液検査 Vision 解析 + 表示 UI 完了** ([ADR-007](./adr/007-blood-test-vision-analysis.md))

医療記録に upload された血液検査画像を Vision LLM (Workers AI Gemma 12B) で構造化抽出し、カテゴリ別テーブル + 前回比 + sparkline + per-item 詳細チャート popover で表示する機能。土台 3 PR + chunking fix 1 PR + 表示 3 PR + ADR 1 PR の計 8 PR で完走:

- **PR 1 ([#45](https://github.com/okayus/nyalog/pull/45))** schema + domain + analyzer 雛形: `blood_test_analyses` (1:1 with attachment) + `blood_test_values` (N rows) テーブル。`worker/domain/blood-test-analysis.ts` (Branded ID + Zod + 純粋関数 `parseGemmaJsonResponse` / `normalizeFlag`) + 項目辞書 (`blood-test-items.ts`、CBC/生化学/電解質/ホルモン/胆汁酸/凝固) + `BloodTestAnalyzer` interface + `WorkersAIGemmaAnalyzer` (default `@cf/google/gemma-3-12b-it`) + `factory.ts` + 抽出 prompt
- **PR 2 ([#46](https://github.com/okayus/nyalog/pull/46))** API + 非同期トリガー: 5 endpoint (`GET /analysis` / `POST /analyze` / `PUT|POST|DELETE /analysis/values[/:vid]`)、`POST /attachments` で `blood_test` + 解析可能 MIME の時に `ctx.waitUntil(runAnalyzer)` で発火
- **fix ([#47](https://github.com/okayus/nyalog/pull/47))** Cloudflare Workflows への移行: PR 2 本番反映後の最初の upload で `ctx.waitUntil()` の **wall-clock 30 秒上限** で kill され status stuck。`AnalyzeBloodTestWorkflow extends WorkflowEntrypoint` に書き換え、`step.do()` で `mark-running` → `fetch-and-analyze` (retries 2 + timeout 5min) → `persist-values` を分割、catch で `mark-failed`。教訓は okayus-skills の [`cloudflare-workflows-for-long-tasks`](https://github.com/okayus/okayus-skills/tree/main/skills/cloudflare-workflows-for-long-tasks) skill に集約
- **PR 3 ([#56](https://github.com/okayus/nyalog/pull/56))** D1 chunking fix: Gemma が 34 項目抽出 × 16 列 = 544 placeholders で D1 の per-statement 100 上限超過。`persist-values` の insert を 5 行ずつ chunk 分割。本番再 upload で 31 行 succeeded を確認 (97 秒、Gemma の応答時間ぶれが想定範囲に収束)
- **PR 4 ([#57](https://github.com/okayus/nyalog/pull/57))** 表示ロジック純粋関数: `buildItemSeries` / `findPreviousPoint` / `computeDelta` (DU で `toward` / `away` / `neutral`) / `buildItemChartGeometry` (refBand 入り) / `buildSparklineGeometry` / `groupItemsByCategory` を `src/components/blood-test-display.ts` に集約、vitest 31 cases
- **PR 5 ([#58](https://github.com/okayus/nyalog/pull/58))** `BloodTestAnalysisPanel`: カテゴリ別 `<details>` テーブル (CBC + 生化学のみ open)、flag emoji バッジ + 14% danger tint、前回比は `towardNormal` で色付け。`MedicalRecordsView` の attachment N+1 ループに追従して blood_test image attachment 全件の analysis を並列フェッチ
- **PR 6 ([#59](https://github.com/okayus/nyalog/pull/59))** sparkline + popover: 推移列に 60×20px の inline SVG sparkline。クリックで native `[popover="auto"]` 開いて reference band + line chart + flag 色 dot の per-item 詳細チャート
- **PR 7 ([#60](https://github.com/okayus/nyalog/pull/60))** ADR-007: 上記 3 つの主要設計判断 (Workflow / 差し替え可能 analyzer / client 側 presentation 集約) を記録

[ADR-007](./adr/007-blood-test-vision-analysis.md) の移行トリガー (Gemma の応答時間が常態的に数分、抽出漏れ多発、trend 表示が遅い) に当てはまったら次の判断 (Claude Vision 切替 / inline 編集 UI / 集約 endpoint 新設) に入る。

**医療記録機能 (画像/PDF 添付付き) 完了** ([ADR-006](./adr/006-medical-records-r2.md))

血液検査結果など、猫毎の医療記録を画像/PDF 添付付きで保存する新機能。R2 + Worker proxy 配信で機微情報の認可を担保 (Cloudflare Images Paid は不採用)。3 PR + 1 fix PR で完走:

- **PR 1 ([#40](https://github.com/okayus/nyalog/pull/40))**: R2 binding (`MEDICAL_BUCKET` → `nyalog-medical`) + `medical_records` / `medical_record_attachments` スキーマ + domain (Branded ID + Discriminated Union + Zod) + 空骨格 (501 stub)。本 PR の deploy で `CLOUDFLARE_API_TOKEN` の `Workers R2 Storage` → `D1` 権限が連鎖して欠けていることが発覚し 3 回失敗。教訓は okayus-skills の [`cloudflare-api-token-permissions`](https://github.com/okayus/okayus-skills/pull/3) skill に記録済み
- **PR 2 ([#41](https://github.com/okayus/nyalog/pull/41))**: 医療記録 CRUD API + UI (テキスト系のみ、画像なし)。`type: "blood_test" | "other"` の Discriminated Union、所属外 cat の id 直叩きは 404 で存在秘匿
- **PR 3 ([#42](https://github.com/okayus/nyalog/pull/42))**: 画像/PDF 添付 (multipart upload + 認可付き Worker proxy 配信 + 削除時 R2 掃除) + ADR-006。受け入れ MIME: jpeg/png/webp/heic/heif/pdf、1 ファイル 10 MB 上限。HEIC は `<img>` 表示が不確実なのでダウンロードリンクへフォールバック
- **fix ([#43](https://github.com/okayus/nyalog/pull/43))**: 添付 UI の CSS スタイル。`.attachment img` を `max-inline-size: 8rem` でサムネイル化、`.attachment-add` を破線ボーダーのボタン風に

医療記録の e2e は意図的に未実装 (PR スコープ管理で見送り)。次に医療記録周辺を触る PR で、クリティカルパス 1 本 (記録作成 → 画像 1 枚 upload → 表示 → 削除 → R2/DB 両方から消える) を足す。

**per-space メンバーシップへの認可モデル移行 完了** ([ADR-005](./adr/005-per-space-membership.md))

実装上「認証済み = 全データ共有」になっていた状態を `spaces` / `space_members` テーブルで形式化した。家族 4 人前提なので 1 スペース固定で UI は変えず、内部モデルだけ正規化。4 PR で段階移行完了:

- **PR 1 ([#34](https://github.com/okayus/nyalog/pull/34))**: `spaces` / `space_members` 追加、`cats.space_id` を NULLABLE 追加、`sessionMiddleware` に `memberSpaceIds` 解決を追加。挙動変化なし
- **PR 2 ([#35](https://github.com/okayus/nyalog/pull/35))**: 本番 bootstrap 実行 (`spaces` 1 行 / `space_members` 3 行 owner / cats.space_id + cats.created_by + toilet_records.created_by すべて backfill 完了。ADR-004 phase 2 同時実施)。SQL は `packages/web/scripts/2026-04-22-space-bootstrap.sql` に固定
- **PR 3 ([#36](https://github.com/okayus/nyalog/pull/36))**: routes の WHERE に `inArray(spaceId, c.var.memberSpaceIds)` 導入 + 新規 INSERT に `space_id` バインド + dev bypass で dev space ensure + cross-space e2e (3本) 追加
- **PR 4 ([#37](https://github.com/okayus/nyalog/pull/37))**: `cats.space_id` を `.notNull()` 化。ADR-005 完走。本番 migration 適用時に D1 が `PRAGMA foreign_keys=OFF` を無視したため `DROP TABLE cats` が `toilet_records.cat_id` の cascade を発火させ 1257 行が消失、backup から全件復旧済 ([ADR-005 Addendum](./adr/005-per-space-membership.md#addendum-2026-04-22-pr-4-で踏んだ-d1-cascade-事故))

招待機能 (`/api/spaces/:id/invites`) は家族追加サイクル完了済みのため保留。

**CSS 近代化フェーズ完了**

PR-A〜F (6 本) で「モダン CSS を実践するサンプル」として nyalog の UI スタックを刷新完了済み:

- **PR-A** `@layer` + OKLCH トークン + ダークモード (#15)
- **PR-B** logical properties / `dvh` / `:focus-visible` / `text-wrap` / `accent-color` (#16)
- **PR-C** container queries + subgrid (#17)
- **PR-D** `:has()` / `[popover]` / `<details>` + `::details-content` + `interpolate-size` (#18)
- **PR-E** View Transitions API (#19)
- **PR-F** scroll-driven animations (`scroll()` / `view()` timeline) (#20)

今後の新機能は このモダン CSS 前提 (トークン + logical + CQ + popover + VT + scroll-driven) で書く。

## 次にやること (次セッションの出発点)

### 1. フロントエンド改善 (2026-08-04 調査完了、これを順番に実施)

`modern-web-guidance` (brand-consistent-forms / forms / required-field-feedback / accessible-error-announcement / accessibility / html / css / performance / faster-spa-view-transitions / defer-rendering-heavy-content / dark-mode / passkey-authentication の 12 ガイド) と `vercel-react-best-practices` をコード全体に突き合わせた監査結果。@layer + OKLCH / container queries / logical properties / `:focus-visible` / popover / View Transitions / scroll-driven / `loading="lazy"` は規範適合を確認済みで再監査不要。以下を上から順に PR 化する。

**実施順 (優先度高):**

1. **base layer のフォームコントロール根治 (PR #69 で発見済みの既知課題)** — base layer の `input, select, textarea { inline-size: 100%; min-block-size: var(--control-min); padding; border }` と `label { flex-direction: column }` が checkbox / radio にも効き、TasksView の繰り返しラジオ・対象猫チェックボックス、ToiletRecordView の 💧💩 ラジオ、MedicalRecordsView の種類ラジオが「全幅 44px 枠付きボックス + ラベル縦積み」になっている (実測 44px × 335px)。`brand-consistent-forms` ガイドの通りネイティブコントロール + `accent-color` (設定済み) が正解なので、base 側を `input:not([type="checkbox"], [type="radio"])` に限定し、radio/checkbox を含む label は row 方向に。PR #69 でチップ側に入れた個別打ち消しは根治後に削除する。**全フォームに影響するので単独 PR + 視覚確認必須**
2. **a11y/UX 小束 (1 PR)** — (a) TodayView `handleQuick` に in-flight ガード (ダブルタップで重複記録が入る)。(b) `.error-text` に `role="alert"` (動的エラーが SR に通知されない)。(c) view 遷移時に `document.title` 更新 + 新 view の見出しへ focus 移動 (押したボタンごと DOM が消え focus が body に落ちる)。(d) AuthView の「入力するまで submit disabled」をやめ busy のみに (forms ガイドの DON'T)。(e) base layer に `:user-invalid` スタイル + `aria-invalid` 同期 (`required-field-feedback` ガイド、Baseline Widely 2023)
3. **トイレ記録の全件フェッチ / 全件レンダリング解消** — list API が無パラメータ全件返し (本番 1200 件超) で、TodayView は今日の表示のために全猫の全履歴 + 全体重を取得しクライアント filter、ToiletRecordView は 860+ 件の li を一括レンダーしている。(a) API に `?since=` / `?limit=` を追加 (TodayView は since=今日、詳細画面は直近 N 件 + もっと見る、体重サマリは最新 2 件で足りる)。(b) `.record-item` に `content-visibility: auto` + `contain-intrinsic-size` (`defer-rendering-heavy-content` ガイド、Baseline Newly・未対応でも無害)
4. **`<Activity>` で TodayView の状態保持** — App.tsx が view 切替でアンマウントするため、詳細から戻るたびに cats + 全記録 + 体重 + タスクを再フェッチしている。React 19.2.4 なので `<Activity mode>` (vercel `rendering-activity`) で TodayView を hidden 保持し、戻り即表示 + フェッチゼロ + スクロール位置維持に (`faster-spa-view-transitions` ガイドと同思想の React ネイティブ版)

**続けて実施 (優先度中、まとめ方は着手時に判断):**

- `<summary>` 内の h2 (猫の管理) — SR の見出しナビから消える、accessibility ガイド明記の DON'T。見出しを summary の外へ or `h2 > button[aria-expanded]` 化
- 主要 `<ul>` に `role="list"` — base の `list-style: none` + flex で Safari が list 意味論を除去する (家族は iPhone 利用)
- `.attachment img` の CLS — `inline-size / block-size: 8rem` 固定 or `aspect-ratio` でロード前に空間予約
- `body { font-size: 16px }` → `1rem` (ユーザーのブラウザ文字サイズ設定を尊重、css ガイドの DON'T)
- reduced motion は `0.01ms` 一括上書きでなく `view-transition.ts` 側で `matchMedia("(prefers-reduced-motion: reduce)")` を見て VT 自体をスキップ
- `env(safe-area-inset-bottom)` (main の padding) が viewport meta に `viewport-fit=cover` が無いため iOS で常に 0 — 付けるか消すか
- TodayView 初期ロード: `listTodayTasks` は cats に依存しないので `listCats` と並列化 + 1 猫のエラーで全体 return せず部分表示
- 血液検査 running 中の自動更新 (ポーリング or visibilitychange 再フェッチ) — 現状リロードするまで結果が出ない
- ToiletRecordView / WeightRecordView の create 後全リスト再フェッチ (2 往復) → 作成レスポンスの局所 insert に (TodayView と一貫させる)

**任意 (未計画、やるなら上記後):** ConfirmButton の `<dialog closedby="any">` 化 (破壊的確認は dialog が本来の道具) / パスキー Conditional UI (`autocomplete="username webauthn"` + `mediation: "conditional"`) / favicon + PWA manifest + `theme-color` (ホーム画面アプリとしての体裁) / 微細群 (TasksView catName の Map 化、`interpolate-size` の :root 集約、`.item-detail-popover` の無効な `position-area: center` 削除と `overscroll-behavior: contain` 追加、CredentialsView の disabled ボタンの aria-label 見直し)

**見送り:** SWR 等のフェッチライブラリ導入 — 家族規模 + neverthrow ラッパ確立済みでは「過度な抽象化をしない」が勝つ。上記 4 (Activity) と局所 insert で実害は消える

### 2. セキュリティ検査の残タスク

bot スキャン耐性 (CT Log 起因) を観点に現状を調査済み。重要な実態:

- **エッジキャッシュの吸収**: `/.env` `/admin` `/wp-login.php` などの典型スキャンパスは Cloudflare CDN edge が SPA `index.html` を `cf-cache-status: HIT` で返し、Worker は起動していない。D1/CPU 消費なし
- **未認証で叩ける経路は限定的**: `/api/*` は session middleware で D1 不参照のまま 401。`/api/auth/login/begin` だけが challenge 生成 (CPU + Worker invocation) を引き起こす経路
- **ビルド成果物の漏洩なし**: `.assetsignore` で `dist/nyalog/.dev.vars` `wrangler.json` は除外、`assets.directory` も `dist/client` 限定
- **セキュリティヘッダ**: HSTS / CSP frame-ancestors / X-Frame-Options DENY / X-Content-Type-Options 全部出ている

**完了**: PR [#49](https://github.com/okayus/nyalog/pull/49) で Workers Observability 有効化 (`enabled: true`, `head_sampling_rate: 1`) + `/api/auth/{login,register}/{begin,verify}` に Workers Rate Limiting バインド (`AUTH_RATE_LIMITER`, IP あたり 30 req / 60s) を投入、本番反映済 (Worker version `8a11b677`)。`wrangler versions view` で `env.AUTH_RATE_LIMITER (30 requests/60s)` がバインド一覧に出ること、Observability に POST `/api/auth/login/begin` の構造化ログが出ることを確認。

**完了**: PR [#52](https://github.com/okayus/nyalog/pull/52) で `packages/web/public/robots.txt` を追加し全 bot に `Disallow: /` を宣言。Meta-ExternalAgent / GPTBot / Google-Extended / ClaudeBot 等の遵守する AI クローラーに対する礼儀的 disallow。守らない bot に対しては既存の rate limit + Observability + 認証必須 API でカバー。

**他スタックでの「`/_next/image` 暴走」リスクとの対応関係 (2026-05-06 調査)**: Next.js + OpenNext + R2 構成で AI クローラーが `/_next/image` を連打して Cloudflare Images Transformation の課金が爆発する典型シナリオは nyalog では構造的に発生しない。理由 3 点 — (1) Next.js / OpenNext を使っていない (`/_next/image` 経路自体が無い)、(2) 画像配信は `GET /api/cats/.../attachments/:id` の Worker proxy 配信で `protectedApi` 配下のため認証必須、(3) Cloudflare Images Transformation を [ADR-006](./adr/006-medical-records-r2.md) で意図的に不採用、R2 から直接 raw bytes を proxy 配信しており Images Transformation の従量課金経路自体が無い。

**Rate Limit 動作確認の宿題 (後で再検証)**:

PR #49 deploy 後、本番 `/api/auth/login/begin` に対して **35 req 順次 / 60 req 並列 / 80 req 並列 / 持続 10 rps × 12s = 計 295 req** を実施したが、すべて 200 で 429 が一度も返らなかった。Worker bundle (`dist/nyalog/index.js`) には `c.env.AUTH_RATE_LIMITER.limit(...)` と `rate_limited` 文字列が含まれており middleware は確実に動作している (Observability 上の status 200 もそれを示す) ので、`limit()` が `{ success: true }` を返し続けている挙動。

仮説:

1. **Cloudflare Workers Rate Limiting は eventually consistent / approximate enforcement** で突発バーストを取りこぼす設計、と docs 明記あり
2. `simple.limit` のカウントは **per Cloudflare colocation** なので colo を跨ぐと閾値が緩くなる
3. ベータ期遺物として、初回バインド使用直後の数分間はカウンタが収束しない可能性

次に検証する時の手順:

- 本番 deploy から 30 分〜数時間置いて同じバースト (持続 10 rps × 12s) を再実行し 429 が出るか
- 出ない場合は `simple.limit: 5` まで絞った fix PR で「実装側か Cloudflare 側か」を切り分け
- それでも engage しないなら **WAF Rate Limiting Rules (Dashboard 設定)** に切り替える。Worker binding より厳密に効く

家族用低トラフィック前提では「binding が緩めでも Observability 側で異常検知 → 後追い対処」で実害は出にくいので、本検証は急ぎではない。

**残 TODO (本セッションで未着手)**:

- Cloudflare Dashboard で Workers の月次予算アラート (Notifications) を設定 — UI 操作のみ
- `/security-review` skill による広域レビュー (本対応とは別 PR)
- (任意) Cloudflare Dashboard の **Bot Fight Mode** (Free プラン可) を有効化、または **WAF Custom Rule** で `(http.user_agent contains "MetaExternalFetcher" or ... )` に Managed Challenge — robots.txt を無視する bot に対する追加層。家族 UX への影響は通常ブラウザでは無いが、誤検知リスクと比較して保留中

### 3. その他の機能候補 (順序は流動)

- **猫タスクの月カレンダー表示** — PR-2 で `enumerateDueDates` まで純粋関数で実装済なので、UI だけ追加すれば月単位の予定一覧が作れる。今やる順序の妥当性次第
- **ご飯・カロリー管理** — DB スキーマ設計から
- **ADR-004 phase 2 の残り**: `cats.created_by` / `toilet_records.created_by` を NOT NULL 化。ただし **PR #37 と同じ D1 CASCADE 事故を踏まないよう**、事前に [ADR-005 Addendum](./adr/005-per-space-membership.md#addendum-2026-04-22-pr-4-で踏んだ-d1-cascade-事故) のチェックリストを必ず実施する (`cats` を rebuild すると `toilet_records.cat_id` CASCADE が再発する)

### 4. 運用 TODO (コード変更なし)

- `INITIAL_REGISTRATION_TOKEN` は家族追加直後に `wrangler secret delete` で必ず消す (現状そうしているが手順化)
- D1 バックアップ方針 (`wrangler d1 export` を週次で手動 or cron) をどこかに書く。PR #37 の事故で露見した通り、table rebuild migration の直前には必ず backup を取る運用を明文化
- Cloudflare の予算アラートを設定 (Dashboard → Notifications)。本セッションのセキュリティ強化 PR と並行で残置

## 後回し (Backlog)

- Hono RPC クライアント (chore) — 現在は手書き fetch ラッパで型安全は確保済み
- 薬・動物病院の予定管理 — リリース後に着手
- ご飯・カロリー管理 — リリース後に着手
- **e2e Phase 2: WebAuthn + 認可横流れ系** — dev bypass を切った別 webServer が必要なため優先度低。やる時の設計メモ:
  - 2-webServer 構成: `bypass` (port 5173, 既存) と `real-auth` (port 5174, `DEV_BYPASS_USER_ID` なし / `RP_ID=localhost` / `INITIAL_REGISTRATION_TOKEN` あり) を Playwright の `webServer` 配列で並走。D1 state は `--persist-to .wrangler/state_bypass` / `.wrangler/state_realauth` で分離
  - `.dev.vars.realauth` を新設 (RP_ID=localhost / ORIGIN=http://localhost:5174 / DEV_BYPASS_USER_ID を書かない)。`wrangler.jsonc` は触らない
  - CDP Virtual Authenticator fixture を `e2e/helpers/webauthn.ts` に (`page.context().addVirtualAuthenticator`)
  - テスト 3 本:
    - `webauthn.spec.ts` — 登録 (`INITIAL_REGISTRATION_TOKEN` + Virtual Authenticator) → ログアウト → 再ログイン → `/api/auth/me` で自分が見える
    - `unauthorized.spec.ts` — Cookie 無し状態で `/` に AuthView が出る / `/api/cats` が 401
    - `cross-user.spec.ts` — user A で猫 + 記録作成 → ログアウト → user B で登録 → A の `catId` / `recordId` を直接 DELETE で 404 (PR #8 WHERE 句漏れ回帰防止)
  - CI 実行時間は +1〜2 分見込み。`check.yml` の step 追加だけで完結

## 完了済み (最近)

- **今日のタスクを 1 タスク 1 行のチップ表示に (PR [#69](https://github.com/okayus/nyalog/pull/69))** — ダッシュボードの「今日のタスク」が猫ごとに全幅 44px の行を積んでいて、猫 2 匹 × タスク 3 件で 450px を消費していた。`.task-cat-row` を `.task-cat-chip` に置き換え、「タイトル + 繰り返しラベル + 猫チップ」を 1 行に収める形へ（チップは右寄せ、幅が足りなければ折り返す）。完了時刻は `済` プレフィックスをやめてチップ内に格納。メモはチップの後ろに移し `flex-basis: 100%` で独立行に。**原因は実装ミスではなく base layer のルール 3 つ**だった: `label { flex-direction: column }` でチェックボックスの下に猫名が縦積み、`input { min-block-size: 44px; padding; border }` で 20px 指定のチェックボックスが枠付き 44px ボックスに膨張、`li { padding: 12px }` で行がさらに厚く。旧 `.task-cat-row` はこれらを打ち消していなかった。チップ側で個別に打ち消し、タップ領域は label の `min-block-size: 44px` で維持。`.task-card` は TasksView と共有クラスなので `.task-today-list >` でスコープし、タスク管理画面の grid レイアウトは無傷。実測でセクション高 450px → 148px、1 カード 221px → 56px。dev サーバー実機で横スクロールなし / リロード後の完了保持 / ダークモードのチップ tint / TasksView 無影響を確認
- **パスキー全紛失時のリカバリ手順を安全な方法に修正 (PR [#68](https://github.com/okayus/nyalog/pull/68))** — README の旧手順が `DELETE FROM users` を指示していたが、ADR-004 の `created_by` / `completed_by` が 6 テーブル (`cats` / `toilet_records` / `weight_records` / `medical_records` / `cat_tasks` / `cat_task_completions`) から参照しており、削除すると FK 制約違反か監査情報の破壊になる。「新規ユーザとして登録し直し → `space_members` に INSERT で既存スペースへ再紐付け → 旧 credentials のみ掃除（旧 users 行は残す）」に置き換えた。INSERT のみなので PR #37 の D1 CASCADE 事故のリスクもない。ADR-005 で猫・記録はユーザではなくスペースに属するため、新ユーザをスペースに加えるだけで既存データが見える
- **過去体重ログ一括インポート (2026-05-21)** — CSV「おかゆとしらたま - 体重.csv」(50 行) を本番 D1 に投入。おかゆ 49 件 (2025-07-14 〜 2026-05-19、5000g〜5260g)、しらたま 1 件 (2025-07-14: 4600g)。`measured_at` は日付のみだったので朝 8:00 JST (`+09:00`) で固定。使い捨て JS スクリプトで INSERT SQL を生成 → `wrangler d1 execute --remote --file` で一括流し込み。`created_at = '2026-05-21T11:55:00.000+09:00'` の同値マーカーを付与しており、事故時は `DELETE FROM weight_records WHERE created_at = '<marker>'` で一括ロールバック可能。事前に `wrangler d1 export --remote` で `backups/2026-05-21-pre-weight-import.sql` (512KB、1512 INSERT) を取得。CSV・SQL・スクリプトは取り込み後削除済み。バックアップは `backups/` 配下 (`.gitignore` 済) でローカル保持
- **体重記録機能 + 自作 SVG グラフ (PR [#53](https://github.com/okayus/nyalog/pull/53))** — 体重を継続記録する CRUD 機能を追加。`weight_records` (cat_id FK CASCADE + `weight_grams INTEGER` + `measured_at TEXT`) を新規スキーマで起こし、トイレ記録の domain/routes パターンを thinnest copy で踏襲 (discriminated union は不要、フラットな record 型)。`worker/domain/weight-record.ts` で Branded `WeightRecordId` / `WeightGrams` (z.number().int().positive().max(50_000)) / `MeasuredAt` (Timestamp と同じ未来 60s 制約) を定義、vitest 15 cases。Routes は `/api/cats/:catId/weights` で list/get/post/put/delete の 5 endpoint、認可は `resolveCatId()` をローカル複製 (所属外 cat は 404)。フロントは `WeightChart` (自前 SVG 折れ線、props は `{ measuredAt, weightGrams }[]` の JSON-serializable な最小データに固定、`buildChartGeometry` を純粋関数として分離し後でライブラリ差し替え可能な境界に) + `WeightRecordView` (グラフ + フォーム + 履歴 + inline 編集/削除) を新規、`App.tsx` の View union に `kind: "weight"` 追加、`TodayView` の各猫 quick-cell に「⚖️ **4.2 kg** (-0.1 kg)」のような最新体重 + 前回比サマリと「体重 →」リンクを追加。保存は整数グラム / 表示は kg 1桁 (浮動小数誤差ゼロ)。トップにクイック記録ボタンは置かない判断 (体重測定は頻繁でないため詳細画面でのみ記録)。Migration `0010_*.sql` は CREATE TABLE のみで cats rebuild なしのため D1 CASCADE 事故リスクなし。e2e 未実装 (クリティカルパス外 / 認可は既存パターンの素直な複製)
- **Workers Observability + auth エンドポイント rate limit (PR [#49](https://github.com/okayus/nyalog/pull/49))** — `wrangler.jsonc` に `observability: { enabled: true, head_sampling_rate: 1 }` と `ratelimits[].AUTH_RATE_LIMITER` (`namespace_id: "1001"`, `simple: { limit: 30, period: 60 }`) を追加。`worker/middleware/rate-limit.ts` で `CF-Connecting-IP` を key に `limit({ key })` し、超過時に 429 `{error:{type:"rate_limited"}}` を返す Hono middleware を新設。`worker/routes/auth.ts` の `/register/{begin,verify}` `/login/{begin,verify}` の 4 経路に適用。`worker/types.ts` の `Bindings` に `AUTH_RATE_LIMITER: RateLimit` を追加。本番反映 (Worker version `8a11b677`) 後、`wrangler versions view` で `env.AUTH_RATE_LIMITER (30 requests/60s)` バインドが登録されていること、Workers Observability に POST `/api/auth/login/begin` の構造化ログ (`cpuTimeMs: 1`, `wallTimeMs: 1`) が出ることを確認。Rate limit の 429 動作確認は計 295 req のバーストでも 429 が返らず宿題化 (詳細は「次にやること > 2」の Rate Limit 動作確認の宿題)
- **カード内ラベルの絵文字化 (PR #23)** — 今日のトイレ記録カードを筆頭に `排尿` `排便` `編集` `削除` の4語を絵文字 (💧💩✏️🗑️) に置換し、同じ語を使う詳細トイレ記録・猫の管理・パスキー管理でも横断で揃えた。`typeLabel` は `"💧"` / `"💩 (${STOOL_LABEL[r.condition]})"` に短縮 (便の状態は残す)。`ConfirmButton` は `triggerLabel` に絵文字を渡すだけで成立するよう元々設計されていたため props 追加なし。クイック記録ボタンも `{cat.name} 💧` / `{cat.name} 💩` に整理し `aria-label={\`${cat.name} の排尿を記録\`}` を付与。`CredentialsView`の削除ボタンは既存`title`に加えて`aria-label`を追加してアクセシブル名を重ねた。detail view のラジオは`<label aria-label="排尿">💧</label>` 形で視覚と SR の両立。セクション見出し (`今日のトイレ記録` 等)・フォームラベル (`名前`/`誕生日`/`日時`/`状態`)・便状態ラベル (`普通`/`軟便`/等)・確認ダイアログ本文 (`削除する`/`キャンセル`) は残している
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

- 本番 URL: `https://nyalog.shiraoka.workers.dev`
- Cloudflare Account ID: `b206ff3a1f57cd57469b20adaf8be123`
- D1 `database_id`: `82db6367-0a73-46d3-baf3-c665adf1e10b` (`wrangler.jsonc` にも記載)
- Worker 名: `nyalog`
- RP_ID: `nyalog.shiraoka.workers.dev`
- 現在投入済みの secret: `SESSION_SECRET` (HS256 JWT 用)
- `INITIAL_REGISTRATION_TOKEN` は失効済み (家族追加時のみ再投入)
- 手動デプロイ経路は今も生きている: `pnpm run deploy` (`packages/web` から)
