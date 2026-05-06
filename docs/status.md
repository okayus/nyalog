# プロジェクトステータス

> このファイルは「今の状態」だけを記録する。履歴は git log と ADR を参照。

## 現在のフェーズ

**セキュリティ検査・防御強化フェーズ (進行中)**。CT Log 経由で外部スキャン bot に確実に晒される前提で、コスト枯渇耐性と未認証経路の保護を優先。Vision 解析は中断中（以下「進行中」参照）。

## 直近完了フェーズ

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

## 進行中

**血液検査 Vision 解析 (土台 3 PR 完走、本番動作確認で 2 つの残課題により中断・後回し)**

医療記録に upload された血液検査画像を Vision LLM で構造化抽出して `blood_test_values` 行として保存する機能。設計はユーザー指示で「Workers AI Gemma を初期実装、差し替え可能 interface を切る」。土台は完成し本番に入っているが、最初の本番 upload で 2 つの想定外で values が DB に入っていない:

- **PR 1 ([#45](https://github.com/okayus/nyalog/pull/45))** schema + domain + analyzer 雛形: `blood_test_analyses` (1:1 with attachment) + `blood_test_values` (N rows) テーブル。`worker/domain/blood-test-analysis.ts` (Branded ID + Zod + 純粋関数 `parseGemmaJsonResponse` / `normalizeFlag`) + 項目辞書 (`blood-test-items.ts`、CBC/生化学/電解質/ホルモン/胆汁酸/凝固) + `BloodTestAnalyzer` interface + `WorkersAIGemmaAnalyzer` (default `@cf/google/gemma-3-12b-it`) + `factory.ts` (env から実装選択) + 抽出 prompt。vitest 22 cases 導入
- **PR 2 ([#46](https://github.com/okayus/nyalog/pull/46))** API + 非同期トリガー: 5 endpoint (`GET /analysis` / `POST /analyze` / `PUT|POST|DELETE /analysis/values[/:vid]`)、POST `/attachments` で `blood_test` + `image/{jpeg,png,webp}` の時に `ctx.waitUntil(runAnalyzer)` で発火、CI workflow に `CLOUDFLARE_API_TOKEN` env を渡して `vp dev` の Workers AI remote proxy session を成立させる修正も含む
- **fix ([#47](https://github.com/okayus/nyalog/pull/47))** Cloudflare Workflows への移行: PR 2 を本番反映後、最初の upload で `ctx.waitUntil()` の **wall-clock 30 秒上限** で kill され `status='running'` のまま stuck。catch も走らない。`AnalyzeBloodTestWorkflow extends WorkflowEntrypoint` に書き換え、`step.do()` で `mark-running` → `fetch-and-analyze` (retries 2 + timeout 5min) → `persist-values` を分割、catch で `mark-failed` step。`POST /attachments` と `POST /analyze` の発火は `c.env.ANALYZE_WORKFLOW.create({ params })` に置換。stuck row 1 件は SQL で `'failed'` に手動 cleanup 済み。教訓は okayus-skills の [`cloudflare-workflows-for-long-tasks`](https://github.com/okayus/okayus-skills/tree/main/skills/cloudflare-workflows-for-long-tasks) skill (作成中、未コミット) に集約

**本番動作確認で判明した 2 つの残課題**:

1. **D1 bulk insert の placeholder 上限超過**: `persist-values` step で `db.insert(bloodTestValues).values([...])` が 1 SQL にまとめて発行され、`D1_ERROR: too many SQL variables at offset 545: SQLITE_ERROR` で throw。Workers AI Gemma は ~34 項目を抽出していて、34 行 × 16 列 ≒ 544 placeholders で D1 制限に当たった (詳細は #47 の error_message)。**修正**: insert を chunk 分割 (例 25 行ずつ = 400 placeholders) すれば通る、小 PR で対応可
2. **Workers AI Gemma 3 12B vision の応答時間 7 分**: `started_at = 21:44:08 → finished_at = 21:51:25` で 7 分 17 秒。`waitUntil` 30 秒は問題外、Workflows 5 分 timeout でも retry 1 回踏む。UX として「アップロードから 7 分後に値が見える」は厳しい。差し替え interface を活かして Claude Vision (Sonnet 4.6、5-15s 期待) に切り替える検討が後ろに残る。Workflow 自体は「失敗が visible に残る」ことが実証できた (`error_message` 明確、Cloudflare Workflows Dashboard で各 step 観察可)

**Workflow 移行で実証されたこと (前向き材料)**:
- `ctx.waitUntil` の 30 秒制限 → 7 分処理が完走できる durable execution に移行成功
- 失敗時 catch が走り `error_message` が DB に明確に残る (今回 D1 limit エラーが正確に文字列で取れた)
- `step.do()` 単位で retry / persist が効く土台ができた
- Workflow 関連の落とし穴 (`Workflow<Params>` は workers-types の global、bytes は step 間で渡せない、step.do の冪等性) は okayus-skills の skill 化で固定化

**次に再開する時の手順**: D1 chunking fix → 同じ画像で再 upload 検証 → values が DB に入るのを確認 → UI (`BloodTestAnalysisPanel`、PR 3 として計画されていた行 inline 編集 + 異常値強調) → ADR-007 起こし → Gemma 応答時間問題の評価 (Claude Vision 比較は別検討)。

## 次にやること (次セッションの出発点)

### 1. セキュリティ検査 (ユーザー指示で最優先、進行中)

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

### 2. 血液検査 Vision 解析の再開 (上記「進行中」の残課題)

セキュリティ検査が一区切りついたら戻る。再開手順は「進行中」末尾の通り。最初の手は **D1 bulk insert chunking の小 fix PR** (25 行/insert に分割)。これで本番動作確認の最後の山を越えるはず。

### 3. その他の機能候補 (順序は流動)

- **薬・動物病院の予定管理** — 機能追加、モダン CSS を実戦投入する初の題材
- **ご飯・カロリー管理** — 同上、DB スキーマ設計から
- **ADR-004 phase 2 の残り**: `cats.created_by` / `toilet_records.created_by` を NOT NULL 化。ただし **PR #37 と同じ D1 CASCADE 事故を踏まないよう**、事前に [ADR-005 Addendum](./adr/005-per-space-membership.md#addendum-2026-04-22-pr-4-で踏んだ-d1-cascade-事故) のチェックリストを必ず実施する (`cats` を rebuild すると `toilet_records.cat_id` CASCADE が再発する)

### 2. 運用 TODO (コード変更なし)

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

- **Workers Observability + auth エンドポイント rate limit (PR [#49](https://github.com/okayus/nyalog/pull/49))** — `wrangler.jsonc` に `observability: { enabled: true, head_sampling_rate: 1 }` と `ratelimits[].AUTH_RATE_LIMITER` (`namespace_id: "1001"`, `simple: { limit: 30, period: 60 }`) を追加。`worker/middleware/rate-limit.ts` で `CF-Connecting-IP` を key に `limit({ key })` し、超過時に 429 `{error:{type:"rate_limited"}}` を返す Hono middleware を新設。`worker/routes/auth.ts` の `/register/{begin,verify}` `/login/{begin,verify}` の 4 経路に適用。`worker/types.ts` の `Bindings` に `AUTH_RATE_LIMITER: RateLimit` を追加。本番反映 (Worker version `8a11b677`) 後、`wrangler versions view` で `env.AUTH_RATE_LIMITER (30 requests/60s)` バインドが登録されていること、Workers Observability に POST `/api/auth/login/begin` の構造化ログ (`cpuTimeMs: 1`, `wallTimeMs: 1`) が出ることを確認。Rate limit の 429 動作確認は計 295 req のバーストでも 429 が返らず宿題化 (詳細は「次にやること > 1」の Rate Limit 動作確認の宿題)
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

- 本番 URL: `https://nyalog.toshiaki-mukai-9981.workers.dev`
- Cloudflare Account ID: `b206ff3a1f57cd57469b20adaf8be123`
- D1 `database_id`: `82db6367-0a73-46d3-baf3-c665adf1e10b` (`wrangler.jsonc` にも記載)
- Worker 名: `nyalog`
- RP_ID: `nyalog.toshiaki-mukai-9981.workers.dev`
- 現在投入済みの secret: `SESSION_SECRET` (HS256 JWT 用)
- `INITIAL_REGISTRATION_TOKEN` は失効済み (家族追加時のみ再投入)
- 手動デプロイ経路は今も生きている: `pnpm run deploy` (`packages/web` から)
