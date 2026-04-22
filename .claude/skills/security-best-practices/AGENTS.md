# nyalog Security Best Practices — 完全ガイド

家族限定の猫ケア管理 Web アプリ **nyalog** の実装・レビュー・リファクタリング時に参照するセキュリティガイド。家族限定アプリでも効くセキュリティ観点を Hono/React/Drizzle/Cloudflare Workers スタック向けに具体化した 23 ルールをまとめる。

このファイルはクイックリファレンス。各ルールの完全な Incorrect / Correct コード例は `rules/<filename>.md` を参照する。

## 読み方

1. 今触っているコードの種類（認可・入力・Cookie・エラー等）に対応するセクションから該当ルールを探す
2. 該当するルールファイルを開き、**Incorrect** の例が自分のコードに当てはまっていないか確認する
3. **Correct** の例に沿って修正する

家族限定の前提で、公開サービス固有のルール（メールアドレス列挙防止・reserved ハンドル名・再認証必須・SEO・決済整合性・大量メール配信）は除外している。

## セクション別概要

### 1. 認可・データアクセス制御 (authz-) — CRITICAL

「ログインできている」と「他人のデータが見えない」は別物。家族間でも個別アカウントが分かれているなら、1 人のユーザーが他の家族の記録を覗ける状態は事故。

| Rule | ファイル | 要旨 |
|---|---|---|
| IDOR 対策 | `rules/authz-idor-check.md` | リソース取得時は常に所有者条件を WHERE に含める |
| UPDATE/DELETE の WHERE | `rules/authz-update-delete-where.md` | 書き込み系 WHERE に「ID + 所有者条件」を必ず両方入れる |
| サーバー側権限チェック | `rules/authz-server-side-enforcement.md` | React の表示制御だけでは権限管理にならない。Hono で再実施 |
| ユーザー別キャッシュ禁止 | `rules/authz-no-user-response-cache.md` | 認証 API には `Cache-Control: private, no-store` |

### 2. 入力バリデーション (input-) — CRITICAL

ユーザー入力・外部 API・アップロードファイルはすべて敵かもしれないと思って扱う。クライアント側バリデーションは UX 補助であり、セキュリティ境界にはならない。

| Rule | ファイル | 要旨 |
|---|---|---|
| サーバー側 Zod 検証 | `rules/input-server-validation.md` | Hono ハンドラで必ず Zod スキーマを実行 |
| URL プロトコル制限 | `rules/input-url-protocol.md` | ユーザー URL は `https:` のみ、redirect は相対 path のみ |
| SQL インジェクション | `rules/input-sql-injection.md` | Drizzle クエリビルダーを使い `sql.raw()` に入力を渡さない |
| HTML エスケープ | `rules/input-html-escape.md` | `dangerouslySetInnerHTML` の前に DOMPurify |
| ファイルアップロード | `rules/input-file-upload.md` | MIME/サイズ/ファイル名/SVG を全部検証 |

### 3. シークレット・鍵管理 (secret-) — CRITICAL

秘密情報はコード・プロンプト・ログに出さない。漏洩を前提にローテーション手順を用意しておく。

| Rule | ファイル | 要旨 |
|---|---|---|
| ハードコード禁止 | `rules/secret-no-hardcode.md` | `wrangler secret` / `.dev.vars` 経由で `c.env.XXX` |
| 最小権限 | `rules/secret-least-privilege.md` | 開発と本番で鍵を分け、権限をサービス単位で絞る |
| ログに出さない | `rules/secret-no-log.md` | Headers/Body 丸ごとログは禁止。whitelist 方式 |

### 4. 認証・セッション (auth-) — HIGH

nyalog は WebAuthn + JWT セッション Cookie (`worker/middleware/session.ts`) で認証している。Cookie 属性とトークン検証の両方が正しく揃って初めて安全。

| Rule | ファイル | 要旨 |
|---|---|---|
| Cookie 属性 | `rules/auth-cookie-attributes.md` | `HttpOnly; Secure; SameSite=Lax` を必ず指定 |
| セッション検証 | `rules/auth-session-verify.md` | 署名検証 + `aud` 検証 + DB 存在/有効期限確認をセットで |

### 5. レスポンスヘッダ (header-) — HIGH

Hono のミドルウェアでまとめて付ける。`hono/secure-headers` ミドルウェアを使う選択肢もある。

| Rule | ファイル | 要旨 |
|---|---|---|
| HSTS | `rules/header-hsts.md` | `Strict-Transport-Security: max-age=31536000; includeSubDomains` |
| CSP frame-ancestors | `rules/header-frame-ancestors.md` | `frame-ancestors 'none'` + `X-Frame-Options: DENY` |
| nosniff | `rules/header-nosniff.md` | `X-Content-Type-Options: nosniff` |
| ユーザー入力 ≠ ヘッダ | `rules/header-no-user-input.md` | CRLF インジェクション対策。Location/filename を検証 |

### 6. エラーハンドリング・ログ (error-) — MEDIUM-HIGH

neverthrow の Result 型を使い、クライアント向けメッセージとサーバー側詳細ログを分離する。

| Rule | ファイル | 要旨 |
|---|---|---|
| 本番エラーメッセージ | `rules/error-prod-message.md` | スタックトレース・SQL・内部パスをクライアントに返さない |
| ログに秘密を書かない | `rules/error-log-no-secrets.md` | 識別子と型だけ。`body`/`headers` 丸ごと禁止 |

### 7. 依存ライブラリ (deps-) — MEDIUM

| Rule | ファイル | 要旨 |
|---|---|---|
| パッケージ検証 | `rules/deps-verify-package.md` | 実在・最終更新・ライセンス・lock ファイル固定を確認 |

### 8. 運用・バックアップ (ops-) — MEDIUM

| Rule | ファイル | 要旨 |
|---|---|---|
| バックアップとアラート | `rules/ops-backup-and-alerts.md` | D1 Time Travel、2FA、予算アラート、`wrangler tail` |
| トランザクション/冪等性 | `rules/ops-transaction-idempotency.md` | D1 `batch()` でアトミックに。冪等性キーでリトライ耐性 |

## 既知の nyalog コードへの観点マップ

| ファイル | 関連ルール |
|---|---|
| `packages/web/worker/middleware/session.ts` | `auth-cookie-attributes`, `auth-session-verify`, `secret-no-hardcode` |
| `packages/web/worker/routes/toilet-records.ts` | `authz-idor-check`, `authz-update-delete-where`, `input-server-validation`, `error-prod-message` |
| `packages/web/worker/index.ts` | `header-hsts`, `header-frame-ancestors`, `header-nosniff` をミドルウェアで追加する余地 |
| `packages/web/worker/db/schema.ts` | `ops-backup-and-alerts` (D1 Time Travel 有効化) |

## レビュー時のチェック順

1. **認可 (authz-)**: そのクエリ、所有者条件入ってる?
2. **入力 (input-)**: サーバー側で Zod 通してる? URL/ファイル/HTML の扱いは?
3. **シークレット (secret-)**: コードに書いてない? ログに出してない?
4. **認証 (auth-)**: Cookie 属性と session 検証の 3 点セット揃ってる?
5. **ヘッダ (header-)**: HSTS/CSP/nosniff 付いてる?
6. **エラー (error-)**: 本番で内部情報漏れない? ログに PII 出ない?
7. **依存 (deps-)**: 新しく入れたパッケージ確認した?
8. **運用 (ops-)**: トランザクションで囲んだ? 冪等?

## 参考ドキュメント

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [MDN — Web Security](https://developer.mozilla.org/en-US/docs/Web/Security)
