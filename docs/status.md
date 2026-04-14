# プロジェクトステータス

> このファイルは「今の状態」だけを記録する。履歴は git log と ADR を参照。

## 現在のフェーズ

**運用安定化 — 機能追加より整備フェーズ**

トップページ UX 改善 (PR #5)、過去排尿ログ 1201 件のインポート、Claude Code skills の Git 登録 (PR #6) まで完了。日次運用は回っており、追加機能より整備・レビュー観点の充実に軸足を置いている。

## 進行中

- **PR #8 `fix/credentials-delete-where`** — CRITICAL の防御多層化。`db.delete(credentialsTable)` の WHERE に `userId` を追加。レビュー/マージ待ち

## 次にやること (次セッションの出発点)

### 1. README 更新 (CI/CD 反映)

- 「デプロイ」節を「main へのマージで自動デプロイ。手動は非常時のみ」に書き換え
- 「CI/CD」節を新設して check / deploy の役割を説明
- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` の Repository secret 投入手順を追記

### 2. セキュリティ監査対応 (PR #7)

`security-best-practices` skill での監査結果 (PR #7 本文参照) を順に潰す。**データ所有モデル**は「記録は家族全員で共有 (閲覧・編集・削除すべて可)、ただし `createdBy` で作成者を記録する」方針で固める。作成者以外も触れるのは意図的: 家族の誰が付けた記録でもあとから補正できる。

対応順は「影響 × 着手しやすさ」で並べた。上 4 つは別 PR 推奨、下 2 つは運用 TODO。

1. **`feat/security-headers`** (HIGH、1 PR)
   - `hono/secure-headers` を `app.use("*", secureHeaders({...}))` で導入
   - 最低セット: HSTS / CSP `frame-ancestors 'none'` / `X-Content-Type-Options: nosniff` / `Referrer-Policy: strict-origin-when-cross-origin`
   - 独自ドメイン化したときに HSTS 無しで事故らないための予防

2. **`fix/global-error-handler`** (MEDIUM-HIGH、1 PR、小)
   - `app.onError((err, c) => c.json({ error: { type: "internal" } }, 500))` を `worker/index.ts` に追加
   - 本番で D1/Drizzle 例外のメッセージ・スタックがクライアントに漏れないようにする
   - ログは `console.error(err)` で wrangler tail に残す

3. **`feat/created-by-column`** (CRITICAL、1 PR、中)
   - `cats` と `toilet_records` に `created_by TEXT NOT NULL REFERENCES users(id)` を追加するマイグレーション
   - Drizzle スキーマ更新 → ハンドラで INSERT 時に `c.get("userId")` を設定
   - **アクセス制御は変えない**: SELECT/UPDATE/DELETE の WHERE に `createdBy` は入れない。家族全員が全件触れる
   - `TodayView` で「誰が登録したか」を表示したい気持ちはあるが、それは別 PR
   - 既存 1201 件のレコードは backfill が必要: 「家族の誰か代表 1 名」を `wrangler d1 execute --remote` で UPDATE → その後 NOT NULL 化 (2 段階マイグレーション)
   - ADR を 1 本追加: 「family-shared + createdBy 属性」モデルの設計意図と、将来マルチテナント化する場合の影響範囲を明記

4. **`chore/dev-bypass-guard`** (MEDIUM、小 or 運用 TODO)
   - `DEV_BYPASS_USER_ID` は `c.env.ORIGIN` が本番ドメインと一致するときは無視するランタイムガードを `sessionMiddleware` に入れる
   - 事故耐性を 1 段上げるだけ。後回し可

5. **運用 TODO (コード変更なし、このステータスに残す)**
   - `INITIAL_REGISTRATION_TOKEN` は家族追加直後に `wrangler secret delete` で必ず消す (現状そうしているが手順化)
   - Cloudflare WAF rate-limit を `/api/auth/*` に 1 ルール
   - D1 バックアップ方針 (`wrangler d1 export` を週次で手動 or cron) をどこかに書く
   - Cloudflare の予算アラートを設定

完了した項目は上から順にチェックを消してこの節を縮める。全部消えたら節ごと削除。

### 3. (任意) スモーク E2E

- Playwright + CDP Virtual Authenticator で「登録 → ログイン → 猫作成 → トイレ記録 → ログアウト」を 1 本
- staging Worker を別建てするかは規模次第 (今は本番直で OK)
- 優先度は低い。家族以外のユーザに開く段階になってから

## 後回し (Backlog)

- Hono RPC クライアント (chore) — 現在は手書き fetch ラッパで型安全は確保済み
- 薬・動物病院の予定管理 — リリース後に着手
- ご飯・カロリー管理 — リリース後に着手

## 完了済み (最近)

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
