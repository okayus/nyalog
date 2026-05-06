# Sections

このファイルは全セクションの順序・Impact レベル・説明を定義する。
カッコ内の prefix は、ルールファイル名の先頭に使う。

---

## 1. 認可・データアクセス制御 (authz)

**Impact:** CRITICAL
**Description:** 「ログインできている」と「他人のデータが見えない」は別物。IDOR・権限チェック漏れ・WHERE 条件漏れは家族限定アプリでも致命的な事故になる。

## 2. 入力バリデーション (input)

**Impact:** CRITICAL
**Description:** ユーザー・外部 API・アップロードファイルは全て疑え。クライアント側のチェックはセキュリティ境界にならない。サーバーサイドの Zod 検証・URL プロトコル制限・SQL インジェクション対策・ファイルアップロード検証を徹底する。

## 3. シークレット・鍵管理 (secret)

**Impact:** CRITICAL
**Description:** API キーや秘密鍵をコードに書かない。`wrangler secret` / `.dev.vars` を使い、開発と本番で鍵を分け、ログに流さない。

## 4. 認証・セッション (auth)

**Impact:** HIGH
**Description:** セッション Cookie の属性を正しく設定し、セッショントークンは署名・audience・DB 存在を全て検証する。

## 5. レスポンスヘッダ (header)

**Impact:** HIGH
**Description:** HSTS・frame-ancestors・nosniff などのセキュリティヘッダを正しく設定し、ユーザー入力を直接ヘッダに含めない。

## 6. エラーハンドリング・ログ (error)

**Impact:** MEDIUM-HIGH
**Description:** 本番でスタックトレースや SQL を返さない。ログに PII・トークン・パスワードを書かない。neverthrow の Result で例外を握りつぶさない。

## 7. 依存ライブラリ (deps)

**Impact:** MEDIUM
**Description:** AI が提案するパッケージ名はハルシネーションのことがある。実在・最終更新・メンテナ・ライセンスを確認し、バージョンを固定する。

## 8. 運用・バックアップ (ops)

**Impact:** MEDIUM
**Description:** D1 の定期バックアップ、Cloudflare アカウント 2FA、予算アラート、ログ監視、トランザクション境界と冪等性で、データ喪失と運用事故を防ぐ。bot スキャン耐性 (Workers Observability + 未認証経路 rate limit) も含む。
