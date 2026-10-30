# 機械呼び出しの契約（送信側が読むもの）

nyalog に利用者の代わりに書く機械（いまは ochanoma）向けの入口。決定は [ADR-009](adr/009-machine-callers-pat-idempotency-due.md)。契約はこの文書と `docs/senders/*.schema.json` で、schema は route の zod スキーマから生成し `pnpm test` で固定している（`worker/__tests__/senders-contract.test.ts`）。送信側は schema を vendoring して契約テストし、この文書の規則を自分の文書に写さない（写すと数日でずれる）。

## 認証

- 設定 UI（アカウントメニュー「API トークン」）で発行した `nyalog_pat_…` を `Authorization: Bearer` に付ける。cookie も Origin も要らない
- PAT は発行した利用者として振る舞う。記録の `createdBy` / `completedBy` はその人
- `Authorization` を付けたリクエストは PAT としてだけ判定する。失効・期限切れ・偽トークンはどれも 401 で、理由は返さない
- 呼べるルートは下の表だけ。表に無いルートは 403 `insufficient_scope`、`/api/tokens` と `/api/auth/*` は 403 `session_required`
- 疎通確認: `GET /api/auth/me` → `{ "id", "displayName" }`

## ルート

| ルート | scope | body の schema | 応答の schema |
|---|---|---|---|
| `GET /api/auth/me` | なし | | `{ id, displayName }` |
| `POST /api/cats/{catId}/toilet-records` | toilet:write | [toilet-record-create](senders/toilet-record-create.schema.json) | [toilet-record](senders/toilet-record.schema.json) |
| `DELETE /api/cats/{catId}/toilet-records/{id}` | toilet:write | | `{}` |
| `GET /api/tasks/due?from&to` | tasks:read | | [tasks-due-response](senders/tasks-due-response.schema.json) |
| `POST /api/tasks/{taskId}/completions` | tasks:write | [task-completion-create](senders/task-completion-create.schema.json) | [task-completion](senders/task-completion.schema.json) |
| `DELETE /api/tasks/{taskId}/completions/{completionId}` | tasks:write | | `{}` |

`catId` と `taskId` は nyalog の UUID。送信側の内部 ID（`shiratama` など）との写像は送信側が持つ。所属スペース外の id は 404（存在を漏らさない）。

## 応答コード

| コード | 意味 | 送信側の扱い |
|---|---|---|
| 201 | 作った | 成功。`id` を控える（取り消しに使う） |
| 200 | 既に処理済み（同じ `Idempotency-Key` の再送、または同じ (task, cat, dueDate) の完了） | 成功 |
| 400 | body、ヘッダ、クエリの形が違う | 再送しても直らない。要確認に落とす |
| 401 | トークンが無効 | キューに残す。トークンを直せば後から送れる |
| 403 | scope 不足、または表に無いルート | 再送しても直らない |
| 404 | cat / task が無い（所属外を含む） | 再送しても直らない。写像を疑う |
| 422 | 同じ `Idempotency-Key` で違う内容 | 再送しても直らない。要確認に落とす |
| 5xx | nyalog 側の失敗 | 指数バックオフで再送 |

エラーの本文は `{ "error": { "type": "<上の種類>", "message": "…" } }`。400 は `issues`（zod の issue 配列）も持つ。

## Idempotency-Key（toilet-records POST だけ）

- ヘッダ `Idempotency-Key`。1〜128 文字の表示可能 ASCII（空白なし）。利用者（= トークンの発行者）単位で一意。保持は 30 日
- 同じ key + 同じ内容（cat と body）→ 最初の応答の本文を 200 で返す。同じ key + 違う内容 → 422
- 送信側の 1 リクエストに 1 つの key。`both`（排尿と排便）を 2 件に分けるときは、送信側のイベント ID から `<client_event_id>/urination`、`<client_event_id>/defecation` のように導出する。同じ値を 2 回使うと 2 件目が 422 になる
- ヘッダ無しなら毎回 201（再送すると 2 件になる）
- completions には要らない。(task, cat, dueDate) で既に冪等

## schema に書けない規則

- 時刻（`timestamp`、`completedAt`）は RFC 3339。オフセット付きで送ってよい。未来は 60 秒まで。保存と応答は UTC の `Z` 表記（ミリ秒付き）に正規化する
- `dueDate`、`from`、`to` は `YYYY-MM-DD`。実在しない日は 400
- `GET /api/tasks/due` は `from` と `to` が両方必須、`from <= to`、両端含めて 62 日まで。並びは dueDate、taskId、catId
- `type: both` は無い。排尿と排便を 1 件ずつ送る。取り消しも 2 件とも消す
- `DELETE` は 200 `{}`。無い id は 404（既に消えているなら成功として扱ってよい）

## curl

```sh
export NYALOG_PAT='nyalog_pat_…'
BASE=https://nyalog.shiraoka.workers.dev

curl -s $BASE/api/auth/me -H "Authorization: Bearer $NYALOG_PAT"

curl -s -X POST "$BASE/api/cats/$CAT_ID/toilet-records" \
  -H "Authorization: Bearer $NYALOG_PAT" -H 'content-type: application/json' \
  -H "Idempotency-Key: $EVENT_ID/urination" \
  -d '{"type":"urination","timestamp":"2026-10-30T21:03:11+09:00"}'

curl -s "$BASE/api/tasks/due?from=2026-11-01&to=2026-11-30" -H "Authorization: Bearer $NYALOG_PAT"

curl -s -X POST "$BASE/api/tasks/$TASK_ID/completions" \
  -H "Authorization: Bearer $NYALOG_PAT" -H 'content-type: application/json' \
  -d "{\"catId\":\"$CAT_ID\",\"dueDate\":\"2026-11-01\",\"completedAt\":\"2026-11-01T08:00:00+09:00\"}"
```

## schema の取り方

raw GitHub から取る（nyalog は public）。`$id` がその URL。

```
https://raw.githubusercontent.com/okayus/nyalog/main/docs/senders/<file>.schema.json
```

Draft-07。zod の `.refine`（未来の拒否、期間上限）と `.transform`（正規化）は schema に出ないので、上の「schema に書けない規則」を併せて読む。`additionalProperties: false` なので、schema に無い項目は送らない。

## 呼び出し側

契約を変えるときは、先にここを読んでから変更履歴を書く。

- ochanoma（家庭内 LAN のハブ。横断の所有表は yane/docs/contracts.md）

## 変更履歴

- 2026-10-30 初版（ADR-009）。PAT、`Idempotency-Key`、`GET /api/tasks/due`、timestamp の正規化
