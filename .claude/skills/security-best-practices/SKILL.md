---
name: security-best-practices
description: 家族限定の小規模 Web アプリでも効くセキュリティ観点ガイドライン。認可・入力検証・シークレット管理・認証/Cookie・レスポンスヘッダ・エラー処理・依存ライブラリ・運用/バックアップについて、よくある脆弱性と正しい実装パターンを nyalog の Hono/React/Drizzle/Cloudflare Workers スタックに合わせて示す。新機能の実装、認証/認可、フォーム、ファイルアップロード、DB 操作、API 実装、Cookie 設定、外部連携、エラーハンドリング、依存追加などのタスクで発動する。
license: MIT
metadata:
  author: nyalog
  version: "1.0.0"
---

# nyalog Security Best Practices

家族限定の Web アプリ nyalog を実装・レビュー・リファクタリングするときに参照するセキュリティガイド。23 ルールを Impact 順に並べ、Hono/React/Drizzle のコード例で具体的に示す。

## 適用する場面

- 新しい Hono ハンドラや React コンポーネントを書くとき
- DB アクセス (Drizzle) を実装するとき
- 認証・認可・セッション周りに触るとき
- 外部 URL・ファイル・ユーザー入力を扱うとき
- Cookie やレスポンスヘッダを追加・変更するとき
- 依存ライブラリを追加するとき
- 既存コードをレビュー・リファクタリングするとき

## Rule Categories by Priority

| Priority | Category                 | Impact      | Prefix    |
| -------- | ------------------------ | ----------- | --------- |
| 1        | 認可・データアクセス制御 | CRITICAL    | `authz-`  |
| 2        | 入力バリデーション       | CRITICAL    | `input-`  |
| 3        | シークレット・鍵管理     | CRITICAL    | `secret-` |
| 4        | 認証・セッション         | HIGH        | `auth-`   |
| 5        | レスポンスヘッダ         | HIGH        | `header-` |
| 6        | エラーハンドリング・ログ | MEDIUM-HIGH | `error-`  |
| 7        | 依存ライブラリ           | MEDIUM      | `deps-`   |
| 8        | 運用・バックアップ       | MEDIUM      | `ops-`    |

## Quick Reference

### 1. 認可・データアクセス制御 (CRITICAL)

- `authz-idor-check` — リソース取得時は所有者条件を WHERE に必ず含める
- `authz-update-delete-where` — `update()`/`delete()` の WHERE に所有者条件を必ず入れる
- `authz-server-side-enforcement` — フロント側の表示制御だけで権限管理した気にならない
- `authz-no-user-response-cache` — ユーザー別レスポンスを CDN/KV にキャッシュしない

### 2. 入力バリデーション (CRITICAL)

- `input-server-validation` — Zod スキーマを Hono ハンドラで必ず実行
- `input-url-protocol` — ユーザー指定 URL は `https:` のみ許可、`javascript:` を拒否
- `input-sql-injection` — Drizzle の parameterized クエリを使う。生文字列連結禁止
- `input-html-escape` — `dangerouslySetInnerHTML` を使う前にサニタイズ
- `input-file-upload` — MIME・サイズ・ファイル名・SVG の検証

### 3. シークレット・鍵管理 (CRITICAL)

- `secret-no-hardcode` — API キーをコードに書かない。`wrangler secret` / `.dev.vars` を使う
- `secret-least-privilege` — 開発と本番で鍵を分け、権限を最小化
- `secret-no-log` — ログ・Sentry・スクリーンショットに秘密情報を含めない

### 4. 認証・セッション (HIGH)

- `auth-cookie-attributes` — セッション Cookie は `HttpOnly; Secure; SameSite=Lax`
- `auth-session-verify` — セッショントークンは署名検証 + `aud` 検証 + DB 存在確認をセットで行う

### 5. レスポンスヘッダ (HIGH)

- `header-hsts` — `Strict-Transport-Security` を設定
- `header-frame-ancestors` — CSP `frame-ancestors 'none'` でクリックジャッキング対策
- `header-nosniff` — `X-Content-Type-Options: nosniff`
- `header-no-user-input` — ユーザー入力をレスポンスヘッダに直接入れない

### 6. エラーハンドリング・ログ (MEDIUM-HIGH)

- `error-prod-message` — 本番でスタックトレース・SQL・内部パスをクライアントに返さない
- `error-log-no-secrets` — ログに PII・トークン・パスワードを出さない

### 7. 依存ライブラリ (MEDIUM)

- `deps-verify-package` — AI が提案したパッケージは実在・メンテ状況・ライセンスを確認してから追加

### 8. 運用・バックアップ (MEDIUM)

- `ops-backup-and-alerts` — D1 バックアップ、2FA、予算アラート、ログ監視
- `ops-transaction-idempotency` — 複数書き込みはトランザクションで囲み、冪等性を考慮

## 使い方

個別ルールファイルを直接読んで詳細と例を確認する:

```
rules/authz-idor-check.md
rules/input-server-validation.md
```

各ルールファイルは以下の構成:

- frontmatter (title, impact, impactDescription, tags)
- ルールの簡潔な説明
- **Incorrect:** 脆弱なコード例
- **Correct:** 正しい実装例
- 参考リンク

全ルールをまとめて読みたいときは `AGENTS.md` を参照。
