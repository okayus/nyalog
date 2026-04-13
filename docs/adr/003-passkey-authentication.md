# ADR-003: パスキー認証への移行

## ステータス

承認

## 日付

2026-04-12

## コンテキスト

ADR-002 で Cloudflare Access (Zero Trust) を採用したが、実運用を見据えて以下の課題が顕在化した:

- **招待フローの摩擦**: ログインのたびに Cloudflare Access の OTP / SSO フローを経由する必要があり、モバイルでの日常利用 (トイレ記録を素早くつけるなど) に対してオーバーヘッドが大きい
- **外部 IdP への依存**: アプリの認可状態が Cloudflare ダッシュボードのポリシー設定と密結合しており、アプリ内でデバイス管理やログアウトなどの制御ができない
- **パスキーの実用段階到達**: 2025 年時点で iCloud Keychain / Google Password Manager / 1Password 等の主要プラットフォームがパスキーに対応しており、同期・バックアップ・クロスデバイス利用が現実的になった

このアプリは個人利用の cat care 管理ツール (想定ユーザ数は自分 + 家族 + テストアカウントで最大 4 名程度) であり、認証要件は「自分と招待した家族のみがログイン可能」という閉じたもの。この条件ではパスキーのユーザビリティとセキュリティが最良のバランスとなる。

## 決定

**パスキー (WebAuthn) のみ** を認証手段として採用し、Cloudflare Access は撤去する。

### 主要ライブラリ

- `@simplewebauthn/server@^13` — Workers edge runtime で動作 (WebCrypto ベース、`nodejs_compat` 不要)
- `@simplewebauthn/browser@^13` — フロントエンドで registration / authentication ceremony を実行
- `hono/jwt` + `hono/cookie` — セッション管理 (ゼロ追加依存)

Lucia Auth (2025年3月に非推奨化) と Better Auth (個人アプリにはオーバースペック) は採用しない。

### データモデル (D1)

```
users        (id, display_name, created_at)
credentials  (id = credential_id base64url, user_id FK, public_key BLOB,
              counter, transports JSON, device_name, backed_up,
              created_at, last_used_at)
sessions     (id, user_id FK, expires_at, created_at)
```

チャレンジは **署名付き短命 Cookie** に載せて無状態化する (D1 書き込み・クリーンアップを省略)。

### セッション方式

- `hono/jwt` で HS256 JWT を発行し、`HttpOnly` + `Secure` + `SameSite=Lax` の Cookie に格納
- 有効期限 30 日のスライディング更新
- `sessions` テーブルに対応行を持ち、失効 (ログアウト / デバイス紛失時) をサーバ側で強制可能

### 登録フロー

クローズド (招待制) とする:

- **初回ブートストラップ**: `INITIAL_REGISTRATION_TOKEN` シークレットで最初のユーザを登録 (ユーザ不在時のみ有効)
- **追加パスキー**: ログイン済みユーザが自分のアカウントに別デバイスのパスキーを追加可能
- **パスキー管理**: 一覧表示、デバイス名設定、個別失効 (最後の 1 つは削除不可)

### RP ID の扱い

`*.workers.dev` のサブドメイン (`nyalog.<subdomain>.workers.dev` の完全形) を RP ID として使い、独自ドメインへの移行は行わない方針で確定する。パスキーは RP ID に紐づくため、将来独自ドメインへ移る場合は全ユーザの再登録が必要。この制約を受け入れる前提。

### 初回登録トークン (`INITIAL_REGISTRATION_TOKEN`) の運用

**方式**: `wrangler secret put` で都度払い出し、登録後に削除する。

想定ユーザは最大 4 名 (自分 + 家族 + テストアカウント) 程度なので、各ユーザ登録ごとに以下のサイクルを回す:

```bash
# 1. ランダムトークン生成 + secret 登録
openssl rand -hex 32 | pnpm exec wrangler secret put INITIAL_REGISTRATION_TOKEN
# 2. 表示された値を登録者に渡し、登録画面で入力してもらう
# 3. 登録完了後 secret を削除 (リプレイ防止)
pnpm exec wrangler secret delete INITIAL_REGISTRATION_TOKEN
```

- `INITIAL_REGISTRATION_TOKEN` が未設定のときは登録エンドポイントは 403 を返す (デプロイ後のレース攻撃対策)
- 既存ユーザが追加パスキーを自分のアカウントに紐づける場合はトークン不要 (ログイン済みセッションで認証)
- 新規アカウントを作成するときのみこのトークンサイクルを回す

### 削除するもの

- `worker/access-auth.ts` (Cloudflare Access JWT 検証)
- `wrangler.jsonc` の `TEAM_DOMAIN` / `POLICY_AUD`
- Cloudflare ダッシュボード側の Access Application / Policy

## 影響

### ポジティブ

- ログインが「画面ロック解除と同じ操作」で完結し、日常利用の摩擦が激減する
- 認証状態がアプリ内で完結し、デバイス管理・ログアウトをアプリから制御できる
- パスワードが存在しないためフィッシング耐性が高い
- Cloudflare Access のライセンスフリーを維持しつつ、外部 IdP への依存を減らす

### ネガティブ / リスク

- **Worker が公開状態になる**: Access で「ドメインアクセス自体をブロック」していた層が消えるため、`/api/*` の全ルート (認証エンドポイントを除く) がセッションミドルウェアを通過することを強制する実装責任がアプリ側に移る
- **登録ブートストラップの運用**: 初回登録トークンの発行・失効・紛失時のリカバリをドキュメント化する必要がある
- **パスキー紛失時のリカバリ**: 最後の 1 つのパスキーを失うとアプリに入れなくなる。複数デバイス登録を推奨し、必要なら D1 への直接操作によるリカバリ手順を残す
- **ブラウザ互換性**: 古いブラウザやパスキー非対応環境では利用不可 (想定ユーザは最新環境を使うため許容)

### 移行

- 現状の本番環境にはまだ実データが存在しない (デプロイ検証のみ) ため、データ移行は不要
- ADR-002 は ADR-003 によって **廃止** となる。status を更新する

## 未決事項

なし (ドメイン・トークン運用とも確定)
