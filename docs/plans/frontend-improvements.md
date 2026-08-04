# フロントエンド改善計画 (2026-08-04 調査)

[status.md](../status.md) からリンクされる詳細ドキュメント。上から順に PR 化し、完了したら項目の頭に `✅ (PR #nn)` を付け、status.md の「次」ポインタを進める。

## 調査の出自

`modern-web-guidance` (brand-consistent-forms / forms / required-field-feedback / accessible-error-announcement / accessibility / html / css / performance / faster-spa-view-transitions / defer-rendering-heavy-content / dark-mode / passkey-authentication の 12 ガイド) と `vercel-react-best-practices` を index.html / index.css / 全コンポーネント / api.ts に突き合わせた監査結果。

**規範適合を確認済みで再監査不要**: @layer + OKLCH トークン / container queries / logical properties / `:focus-visible` / popover / `::details-content` / View Transitions / scroll-driven animations / `loading="lazy"` / `color-scheme` meta / SVG チャートの `role="img"` / lazy `useState` 初期化 / functional setState。

## 実施順 (優先度高)

### ✅ (PR #74) 1. base layer のフォームコントロール根治 (PR #69 で発見済みの既知課題)

base layer の `input, select, textarea { inline-size: 100%; min-block-size: var(--control-min); padding; border }` と `label { flex-direction: column }` が checkbox / radio にも効き、TasksView の繰り返しラジオ・対象猫チェックボックス、ToiletRecordView の 💧💩 ラジオ、MedicalRecordsView の種類ラジオが「全幅 44px 枠付きボックス + ラベル縦積み」になっている (実測 44px × 335px)。

`brand-consistent-forms` ガイドの通りネイティブコントロール + `accent-color` (設定済み) が正解なので、base 側を `input:not([type="checkbox"], [type="radio"])` に限定し、radio/checkbox を含む label は row 方向に。PR #69 でチップ側 (`.task-cat-chip`) に入れた個別打ち消しは根治後に削除する。

**全フォームに影響するので単独 PR + 視覚確認必須。**

**結果**: radio/checkbox は 20×20 のネイティブ描画になり、label が row / 自然幅 / 44px タップ領域を持つ形に。実測値の before/after 全表は PR #74 の commit メッセージにある。TodayView のチップは打ち消し削除後も 1px も動かず (スクリーンショットが md5 一致)。`label:has(> input:is([type="checkbox"], [type="radio"]))` で分岐しているので、以後 checkbox/radio を足しても個別の打ち消しは要らない。

### 2. a11y/UX 小束 (1 PR)

- (a) TodayView `handleQuick` に in-flight ガード — ダブルタップで重複記録が入る
- (b) `.error-text` に `role="alert"` — 動的エラーが SR に通知されない
- (c) view 遷移時に `document.title` 更新 + 新 view の見出しへ focus 移動 — 現状は押したボタンごと DOM が消え focus が body に落ちる
- (d) AuthView の「入力するまで submit disabled」をやめ busy のみに (forms ガイドの DON'T)
- (e) base layer に `:user-invalid` スタイル + `aria-invalid` 同期 (`required-field-feedback` ガイド、Baseline Widely 2023)

### 3. トイレ記録の全件フェッチ / 全件レンダリング解消

list API が無パラメータ全件返し (本番 1200 件超) で、TodayView は今日の表示のために全猫の全履歴 + 全体重を取得しクライアント filter、ToiletRecordView は 860+ 件の li を一括レンダーしている。

- (a) API に `?since=` / `?limit=` を追加 — TodayView は since=今日、詳細画面は直近 N 件 + もっと見る、体重サマリは最新 2 件で足りる
- (b) `.record-item` に `content-visibility: auto` + `contain-intrinsic-size` (`defer-rendering-heavy-content` ガイド、Baseline Newly・未対応でも無害)

### 4. `<Activity>` で TodayView の状態保持

App.tsx が view 切替でアンマウントするため、詳細から戻るたびに cats + 全記録 + 体重 + タスクを再フェッチしている。React 19.2.4 なので `<Activity mode>` (vercel `rendering-activity`) で TodayView を hidden 保持し、戻り即表示 + フェッチゼロ + スクロール位置維持に (`faster-spa-view-transitions` ガイドと同思想の React ネイティブ版)。

## 続けて実施 (優先度中、まとめ方は着手時に判断)

- `<summary>` 内の h2 (猫の管理) — SR の見出しナビから消える、accessibility ガイド明記の DON'T。見出しを summary の外へ or `h2 > button[aria-expanded]` 化
- 主要 `<ul>` に `role="list"` — base の `list-style: none` + flex で Safari が list 意味論を除去する (家族は iPhone 利用)
- `.attachment img` の CLS — `inline-size / block-size: 8rem` 固定 or `aspect-ratio` でロード前に空間予約
- `body { font-size: 16px }` → `1rem` (ユーザーのブラウザ文字サイズ設定を尊重、css ガイドの DON'T)
- reduced motion は `0.01ms` 一括上書きでなく `view-transition.ts` 側で `matchMedia("(prefers-reduced-motion: reduce)")` を見て VT 自体をスキップ
- `env(safe-area-inset-bottom)` (main の padding) が viewport meta に `viewport-fit=cover` が無いため iOS で常に 0 — 付けるか消すか
- TodayView 初期ロード: `listTodayTasks` は cats に依存しないので `listCats` と並列化 + 1 猫のエラーで全体 return せず部分表示
- 血液検査 running 中の自動更新 (ポーリング or visibilitychange 再フェッチ) — 現状リロードするまで結果が出ない
- ToiletRecordView / WeightRecordView の create 後全リスト再フェッチ (2 往復) → 作成レスポンスの局所 insert に (TodayView と一貫させる)

## 任意 (未計画、やるなら上記後)

- ConfirmButton の `<dialog closedby="any">` 化 — 破壊的確認は dialog が本来の道具 (html ガイドのマトリクス)。focus 自動移動 + trap が付く
- パスキー Conditional UI — `autocomplete="username webauthn"` + `mediation: "conditional"` (`passkey-authentication` ガイド)
- favicon + PWA manifest + `theme-color` — ホーム画面アプリとしての体裁
- 微細群: TasksView catName の Map 化 / `interpolate-size` の :root 集約 / `.item-detail-popover` の無効な `position-area: center` 削除と `overscroll-behavior: contain` 追加 / CredentialsView の disabled ボタンの aria-label 見直し

## 見送り

- SWR 等のフェッチライブラリ導入 — 家族規模 + neverthrow ラッパ確立済みでは「過度な抽象化をしない」が勝つ。計画 4 (Activity) と局所 insert で実害は消える
