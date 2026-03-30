# ADR-002: 認証方式の選定

## ステータス

承認

## 日付

2026-03-30

## コンテキスト

ADR-001 で「Firebase Authentication または Google OAuth を採用する。比較調査の上で決定する」としていた。認証の要件は以下の通り:

- 自分と招待した Google アカウントのみがログイン可能
- バックエンドは Cloudflare Workers (Hono)
- フロントエンドは Cloudflare Pages (React)

以下の3方式を比較検討した。

## 比較

### Firebase Authentication

- Hono 公式ミドルウェア (`@hono/firebase-auth`) が存在し、Workers 上での JWT 検証が解決済み
- ユーザー許可リストは自前実装が必要（D1 + ミドルウェア）
- フロントエンドに Firebase JS SDK が必要（バンドルサイズ増加）
- 無料枠: 50,000 MAU

### Google OAuth 2.0 (Direct)

- Authorization Code Flow を全て自前実装する必要がある
- セキュリティ実装（state, PKCE, nonce）の負担が大きい
- 個人開発では保守コストに見合わない

### Cloudflare Access (Zero Trust)

- ダッシュボード設定のみで認証フロー全体を Cloudflare が処理
- Access Policy でメールアドレスを GUI 管理でき、allowlist がビルトイン
- Workers 側は `Cf-Access-Jwt-Assertion` ヘッダの JWT 検証のみ
- フロントエンドに認証用 SDK 不要
- 無料枠: 50 seats（個人アプリには十分）

## 決定

**Cloudflare Access** を採用する。

### 理由

1. 「自分と招待した Google アカウントのみ」という要件に Access Policy の allowlist が最適
2. 認証コードをほぼ書かなくてよく、実装・保守コストが最小
3. 既に Cloudflare Workers / Pages / D1 を使用しており、追加依存が最小
4. フロントエンドに認証 SDK が不要でバンドルサイズを抑えられる

### Workers 側の実装方針

- `/api/health` など公開エンドポイントは認証不要
- 保護エンドポイントでは `Cf-Access-Jwt-Assertion` ヘッダの JWT を検証
- Cloudflare Access の JWKS エンドポイントで署名検証
- 検証済みユーザー情報（email）をリクエストコンテキストに格納

## 影響

- Cloudflare エコシステムへの依存がさらに深まる（Workers + Pages + D1 + Access）
- 認証をアプリ内に移したい場合は Firebase Auth への移行パスが明確（`@hono/firebase-auth` を導入）
- ユーザー管理はダッシュボード操作になるため、アプリ内でのユーザー招待機能は不要
