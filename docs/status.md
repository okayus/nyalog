# プロジェクトステータス

> このファイルは「今の状態」だけを記録する。履歴は git log と ADR を参照。

## 現在のフェーズ

**UX 改善 — トップページのトイレ記録ワンタップ化**

パスキー認証は本番稼働中、モバイル向け最小 CSS も投入済み、CI/CD (PR check + main push で自動デプロイ) もグリーン。日々の使い勝手を上げるため、「ログイン後トップでそのまま今日のトイレ記録が見えて、ワンタップで記録できる」フローを作る。

## 進行中

- **トップページ (猫一覧) のトイレ CRUD UI** — 次セッションで着手

## 次にやること (次セッションの出発点)

### 1. トップページにトイレ CRUD を統合 (今やる)

現在は `CatList` → 猫をタップ → `ToiletRecordView` に遷移、という 2 画面構成。これをトップページ (猫一覧) にまとめて、ログイン後すぐに記録できる UI にする。

**仕様:**

- **今日のトイレ記録リスト**: ログイン後のトップ画面で、各猫の「今日」のトイレ記録を時系列に並べて表示
  - 各行: 猫名 / 種別 (💧 排尿 or 💩 排便 + condition) / 時刻
  - 各アイテムに **時間編集** (時刻だけ) と **削除** ボタン
- **クイック記録ボタン**: 猫 × {おしっこ, うんち} のボタンを並べる。例 (猫が「おかゆ」「しらたま」の場合):
  ```
  [おかゆ おしっこ]  [しらたま おしっこ]
  [おかゆ うんち]    [しらたま うんち]
  ```
  ボタンを押すと **現在時刻 (`new Date().toISOString()`)** で POST → リスト即時更新
  - うんちボタンは condition デフォルト `normal` で投入。後から編集はまだ作らない (時刻編集だけで十分)
- **日付境界**: クライアントのローカル日付で「今日 00:00〜現在」を対象に
- **既存の `ToiletRecordView` (詳細フォーム付き)** はそのまま残すか消すか要判断。リンクとして「詳細記録 (日付指定や condition 指定)」を残しておくのが無難

**触るファイル:**

- `packages/web/src/App.tsx` — `view` state を再設計 (トップを 1 画面に寄せる)
- `packages/web/src/components/CatList.tsx` — 猫リスト + クイックボタン + 今日の記録リストに拡張、もしくは新コンポーネント `TodayView.tsx` に分離
- `packages/web/src/api.ts` — トイレ記録の **update API クライアントが未実装**。PUT 経路は既に backend にある (`packages/web/worker/routes/toilet-records.ts:162` `.put("/:id", ...)`) ので、`updateToiletRecord(catId, id, { timestamp })` を追加するだけ
- `packages/web/src/components/ToiletRecordView.tsx` — 流用 or 縮小。時間編集 UI (time input + save) は新規に書く必要あり (現行は削除ボタンのみ)

**backend は原則いじらない:**

- POST/GET/PUT/DELETE は既に揃っている (`routes/toilet-records.ts`)
- ドメインロジックは `worker/domain/toilet-record.ts` (Discriminated Union + neverthrow)
- 「今日の記録だけを取る」クエリパラメタは現状なし → フロントでフィルタ (件数少ないので OK)。将来必要になれば `?from=&to=` を生やす

**デザイン指針:**

- 既存モバイル CSS (44px タップ領域 / card 風) に乗せる
- ボタンは 2 列グリッド (猫数が増えたら縦スクロール)
- 時刻編集は inline の `<input type="time">` + 保存 (モーダルは作らない)

### 2. README 更新 (CI/CD 反映)

- 「デプロイ」節を「main へのマージで自動デプロイ。手動は非常時のみ」に書き換え
- 「CI/CD」節を新設して check / deploy の役割を説明
- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` の Repository secret 投入手順を追記

### 3. (任意) スモーク E2E

- Playwright + CDP Virtual Authenticator で「登録 → ログイン → 猫作成 → トイレ記録 → ログアウト」を 1 本
- staging Worker を別建てするかは規模次第 (今は本番直で OK)
- 優先度は低い。家族以外のユーザに開く段階になってから

## 後回し (Backlog)

- Hono RPC クライアント (chore) — 現在は手書き fetch ラッパで型安全は確保済み
- 薬・動物病院の予定管理 — リリース後に着手
- ご飯・カロリー管理 — リリース後に着手

## 完了済み (最近)

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
