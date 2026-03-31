# Cloudflare Access セットアップ手順

nyalog の認証基盤として Cloudflare Access (Zero Trust) を使い、Google アカウントでログインできるようにする手順。

## 前提条件

- Cloudflare アカウント
- nyalog Worker がデプロイ済み（`nyalog.<subdomain>.workers.dev`）
- Google OAuth クライアント ID とクライアントシークレット（[google-oauth-setup.md](./google-oauth-setup.md) で取得）

## 1. Zero Trust チーム名の確認

1. [Cloudflare Zero Trust ダッシュボード](https://one.dash.cloudflare.com/) にアクセス
2. **Settings** → **Team name and domain** でチーム名を確認
   - 例: `toshiaki-mukai-9981` → TEAM_DOMAIN は `https://toshiaki-mukai-9981.cloudflareaccess.com`

## 2. Google を Identity Provider として追加

1. Zero Trust ダッシュボード → **インテグレーション** → **ID プロバイダー**
2. 「**ID プロバイダーを追加する**」をクリック
3. 一覧から「**Google**」を選択（Google Workspace ではない）
4. 以下を入力:

| フィールド | 値 |
|---|---|
| 名前 | `Google`（デフォルトのまま） |
| アプリ ID | Google OAuth クライアント ID |
| クライアントシークレット | Google OAuth クライアントシークレット |

5. 「**保存**」をクリック
6. 一覧に戻ったら「**テスト**」リンクをクリックして動作確認
   - Google のログイン画面が表示され、ログイン後に成功ページが表示されれば OK

## 3. Workers に Access を有効化

1. [Cloudflare ダッシュボード](https://dash.cloudflare.com/) → **Workers & Pages** → `nyalog`
2. **Settings** → **Domains & Routes**
3. `workers.dev` の行の「**More options**」（三点メニュー）をクリック
4. 「**Cloudflare Access**」をクリック → Access が有効化される
5. 以下の値が表示される:
   - **オーディエンス (AUD)**: JWT 検証に使用する値
   - **JWK URL**: `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/certs`

## 4. Access アプリケーションのパス設定

デフォルトでは Worker 全体が保護されるため、`/api` パスのみを保護対象にする。

1. Access 有効化時に表示される「**ポリシーを管理します**」リンクをクリック
   - または Zero Trust → **Access コントロール** → **アプリケーション** → 該当アプリ → **編集**
2. 「**基本情報**」タブ
3. **パブリックホスト名** セクションの「**パス**」フィールドに `api` を入力
4. 「**アプリケーションを保存**」

これにより:
- `/api/*` → Access で保護（未認証は Access ログインページにリダイレクト）
- `/health`, `/`, `/assets/*` → 保護なし（誰でもアクセス可能）

## 5. Access Policy の設定（アクセス制御）

Access を有効化すると、デフォルトで Cloudflare アカウントのメールアドレスに ALLOW ポリシーが作成される。

### 個人用アプリのアクセス制御

nyalog は個人用アプリのため、**招待したユーザーのみ**がログインできる。これは Access Policy の **Include ルール**で制御される:

- **セレクタ**: `Emails`
- **値**: 許可するメールアドレスを個別に指定

この設定により、Google ログインの画面は誰でも表示できるが、ログイン後に Access Policy のメールアドレスと一致しなければ**アクセスが拒否される**。不特定多数の Google アカウントがログインできるわけではない。

### ユーザーを招待する

1. Zero Trust → **Access コントロール** → **アプリケーション** → `nyalog - Cloudflare Workers` → **編集**
2. 「**ポリシー**」タブ → 既存のポリシー（`nyalog - Production`）をクリック
3. **Include** ルールにメールアドレスを追加
4. 「**アプリケーションを保存**」

コード変更やデプロイは不要。ダッシュボードの操作だけで即時反映される。

### ユーザーを削除する

同じポリシーの Include ルールからメールアドレスを削除するだけで、そのユーザーは次回アクセス時にブロックされる。既存のセッションはセッション期間（デフォルト 24 時間）の経過で失効する。

## 6. Worker の環境変数を設定

`wrangler.jsonc` の `vars` に以下を設定:

```jsonc
"vars": {
  "TEAM_DOMAIN": "https://<team-name>.cloudflareaccess.com",
  "POLICY_AUD": "<手順3で取得した AUD タグ>"
}
```

設定後、再デプロイ:

```bash
pnpm deploy
```

## 7. ローカル開発用の設定

`packages/web/.dev.vars`:

```
TEAM_DOMAIN=https://<team-name>.cloudflareaccess.com
POLICY_AUD=<AUD タグ>
DEV_SKIP_AUTH=true
```

`DEV_SKIP_AUTH=true` により、ローカルでは認証をスキップして `dev@localhost` として動作する。

`.dev.vars.example` にテンプレートがあるので、コピーして値を設定:

```bash
cp packages/web/.dev.vars.example packages/web/.dev.vars
```

## 8. 動作確認

### ヘルスチェック（認証不要）

```bash
curl https://nyalog.<subdomain>.workers.dev/health
# → {"status":"ok","timestamp":"..."}
```

### 認証保護エンドポイント（未認証）

```bash
curl -I https://nyalog.<subdomain>.workers.dev/api/me
# → HTTP/2 302 (Access ログインページにリダイレクト)
```

### ブラウザでの確認

1. `https://nyalog.<subdomain>.workers.dev/` にアクセス
2. SPA が表示される
3. SPA が `/api/me` を fetch → Access ログインページにリダイレクト
4. Google アカウントでログイン
5. SPA に戻り「ログイン中: <email>」が表示される

## 9. ログイン方法の設定

Access のログインページに表示する Identity Provider を選択する。

1. アプリケーション編集画面 → 「**ログイン方法**」タブ
2. 使用する IdP にチェックを入れる
3. 「**アプリケーションを保存**」

### 推奨設定

| ログイン方法 | 有効 | 用途 |
|---|---|---|
| **Google** | **有効** | メインのログイン方法 |
| **One-time PIN** | 有効 | フォールバック（Google に問題がある場合） |

Google IdP を追加した直後はアプリケーションのログイン方法に Google が**有効化されていない**場合がある。必ず「ログイン方法」タブで Google にチェックが入っていることを確認する。

### インスタント認証

ログイン方法が 1 つだけの場合、「**インスタント認証**」を有効にすると IdP 選択画面をスキップして直接 Google ログインに飛ばせる。

## トラブルシューティング

### Access ログイン後に 403 エラー

- `POLICY_AUD` が正しいか確認（Access アプリケーションの AUD タグと一致する必要がある）
- Worker を再デプロイしたか確認

### Google ログインで "Error 400: redirect_uri_mismatch"

- Google Cloud Console の OAuth クライアント設定で、リダイレクト URI が `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/callback` と完全一致しているか確認

### ローカルで /api/* が 401 を返す

- `.dev.vars` に `DEV_SKIP_AUTH=true` が設定されているか確認
- `vp dev` を再起動したか確認（`.dev.vars` の変更は再起動が必要）
