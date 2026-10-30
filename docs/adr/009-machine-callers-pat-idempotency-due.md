## ADR-009: 機械呼び出し用の API（PAT、Idempotency-Key、期間指定の due 一覧）

- ステータス: Accepted
- 日付: 2026-10-30
- 関連: yane（家のシステムの横断リポジトリ）の段 A。送信側は ochanoma（家庭内 LAN のハブ、Rust、未作成）。呼び出し側の契約は [docs/senders.md](../senders.md)

## 背景

家のシステム（kakitome → ochanoma → nyalog）で、スピーカーの発話を ochanoma が nyalog のトイレ記録とタスク完了に転送し、ダッシュボードが nyalog の予定日を月表示する。nyalog の認証はパスキーのセッションだけで、機械が人の代わりに書く経路が無い。ochanoma はオフラインキューから再送するので、同じ発話が 2 件になる経路を塞ぐ必要がある。`toilet-records` の `timestamp` は受けた文字列をそのまま保存しており、一覧の並びと `since` が UTC の `Z` 表記を前提に文字列比較するため、`+09:00` を送る機械呼び出しが混ざると順序が崩れる。

okayus-skills の cloudflare-workers-pat-bearer-auth（mazuoboeru で稼働中）を下敷きにする。nyalog には CSRF の Origin 検査が無い（cookie は SameSite=Lax）ので、Bearer を検査から除く工程は要らない。

## 決定

### 1. PAT（Bearer）を cookie セッションの前に置く

- 表 `personal_access_tokens`: `id`、`user_id`（users に CASCADE）、`name`、`token_hash` UNIQUE、`scopes`（JSON 配列の TEXT）、`created_at`、`last_used_at`、`expires_at`、`revoked_at`。時刻は既存どおり ISO 8601 の TEXT
- トークンは `nyalog_pat_` + 64 桁 hex（32 byte 乱数。招待トークンと同じ `randomTokenHex`）。保存は `sha256(token + PAT_PEPPER)` だけ。平文は `POST /api/tokens` の 201 に一度だけ出る
- `PAT_PEPPER` は Worker Secret。本番（`ORIGIN` が localhost でない）で未設定なら発行は 503 `pat_unavailable`、検証は 401。pepper を後から入れると既発行のトークンが全部死ぬので、未設定のまま発行できないようにする。dev / CI は未設定で動く
- `Authorization: Bearer` があるリクエストは PAT の経路だけを通る（cookie や dev bypass に落ちない）。無ければ従来のセッション
- scope は `toilet:write` / `tasks:read` / `tasks:write`。MVP は全トークンに 3 つとも付ける
- PAT で呼べるルートは `worker/domain/pat.ts` の表に列挙し、表に無いルートは 403 `insufficient_scope`（既定拒否）。初期の表: `GET /api/auth/me`（scope 不問、疎通確認用）、`POST` と `DELETE` の `/api/cats/:catId/toilet-records[/:id]`（toilet:write。DELETE は kakitome docs/06 §4 の取り消し用）、`GET /api/tasks/due`（tasks:read）、`POST` と `DELETE` の `/api/tasks/:id/completions[/:completionId]`（tasks:write）
- `/api/tokens/*`、`/api/auth/logout`、`/api/auth/credentials/*` はセッション限定。PAT には 403 `session_required`
- `last_used_at` の更新は 1 時間に 1 回。`expires_at` は列だけ用意し、発行 API からは設定しない（無期限）
- 設定 UI（アカウントメニュー「API トークン」）: 名前を付けて発行 → 一度だけ表示 → 一覧（名前、作成、最終使用、状態）→ 失効。失効は行を残して `revoked_at` を立てる
- トークンと `Authorization` ヘッダは log に出さない（observability の head_sampling_rate=1 で全部残る）

### 2. `Idempotency-Key`（toilet-records POST）

- ヘッダ `Idempotency-Key`。1〜128 文字の表示可能 ASCII（空白を含まない）。スコープは user 単位。保持は 30 日
- 表 `idempotency_keys`: `user_id`、`key`、`request_hash`、`response_status`、`response_body`、`created_at`。PK (user_id, key)
- `request_hash` は検証後の body と `catId` をキー順に正規化した JSON の sha256
- 同じ key + 同じ hash → 保存した body を 200 で返す。同じ key + 違う hash → 422 `idempotency_key_mismatch`。ヘッダ無し → 従来どおり毎回 201
- 記録の INSERT とキーの INSERT を D1 の batch で 1 トランザクションにする。同時到着は PK 衝突で片方が失敗し、失敗側はキー行を読み直して 200 を返す
- completions は (task, cat, dueDate) の UNIQUE で既に冪等（2 回目は既存行を 200）なので対象外

### 3. `GET /api/tasks/due?from&to`

- `from`、`to` は `YYYY-MM-DD` で両方必須。`from <= to`、両端含めて 62 日以内。外れたら 400
- 応答は (task × cat × dueDate) の配列 `{ taskId, title, catId, catName, dueDate, completed }`。`enumerateDueDates` で列挙し、completions を期間でまとめて引く。並びは dueDate、taskId、catId
- `/:id` より前に登録する（`/today` と同じ理由）

### 4. timestamp の正規化

`toilet-records` の `timestamp` と completions の `completedAt` は、受信時に `toISOString()` で UTC の `Z` 表記に直して保存する。オフセット付きは受け付ける。送信側の約束にはしない（受信側で直す）。

### 5. 契約は nyalog が公開する

[docs/senders.md](../senders.md) が呼び出し側の唯一の入口。`docs/senders/*.schema.json` は route の zod スキーマから `zod-to-json-schema`（Draft-07）で生成し、vitest のファイルスナップショットで固定する。手書きしない。JSON Schema に書けない規則（key の導出、200 と 201、timestamp、期間上限）は senders.md に書く。

生成に `zod/v4` の `z.toJSONSchema` を使わないのは、nyalog の zod が 3.25 で、スキーマを v4 に移すと差分が全域に及ぶため。`zod-to-json-schema` は v3 のスキーマをそのまま読む。

## 検討した代替案

- route ごとに `requireScope` を積む（skill の形）。付け忘れたルートが PAT に開くので、表の既定拒否にした
- 冪等化を汎用 middleware にする。handler の INSERT と同じトランザクションに入れられないので、handler から呼ぶ helper にした
- ochanoma 用の device token を別に作る。kakitome docs/06 §5 の原則どおり、個人のセッションを流用せず scope 付き PAT を 1 本発行する方が、表も UI も増えない

## 帰結

- migration が 2 本増える（`personal_access_tokens`、`idempotency_keys`）。どちらも新規表で rebuild を伴わない。migration を含む PR は人間が merge する
- 人手: migration PR の merge → `wrangler secret put PAT_PEPPER` → 設定 UI で ochanoma 用トークンを 1 本発行。NucBox では systemd の `LoadCredential=` で ochanoma に渡す
- CI（check.yml）は vitest を走らせていない。スナップショットの固定は `pnpm test` を CI に足して初めて効く。relay は workflow ファイルを push できないので人手
- PAT で届くルートの rate limit は未対応。`AUTH_RATE_LIMITER`（30 req / 60 s）とは別の binding が要る。[plans/security-remaining.md](../plans/security-remaining.md) に積む
- Worker 同士が同じ zone で `fetch` すると 1042 で届かない罠（skill）は、ochanoma が NucBox 上の Rust なので該当しない
