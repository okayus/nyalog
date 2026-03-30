# Cloudflare Access セットアップ手順

## 1. Zero Trust ダッシュボードの初期設定

1. [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) にアクセス
2. チーム名を設定（例: `nyalog`）→ `https://nyalog.cloudflareaccess.com` が TEAM_DOMAIN になる

## 2. Google を Identity Provider として追加

1. [Google Cloud Console](https://console.cloud.google.com/) で OAuth 2.0 クライアントIDを作成
   - アプリケーションの種類: ウェブアプリケーション
   - 承認済みリダイレクト URI: `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/callback`
2. Zero Trust > Settings > Authentication > Login methods で「Add new」→ Google を選択
3. クライアントID とクライアントシークレットを入力

## 3. Workers に Access を有効化

### ワンクリック設定（推奨）

1. Cloudflare ダッシュボード > Workers & Pages > `nyalog-api`
2. Settings > Domains & Routes
3. `workers.dev` の行で「Enable Cloudflare Access」をクリック
4. 「Manage Cloudflare Access」で Access Policy を設定

### Access Policy 設定

- **Policy name**: nyalog-users
- **Action**: Allow
- **Include**: Emails（許可するメールアドレスを列挙）

## 4. Workers の環境変数を設定

1. Application Audience (AUD) Tag を取得:
   - Zero Trust > Access controls > Applications > nyalog-api > Basic information
   - 「Application Audience (AUD) Tag」をコピー

2. wrangler.jsonc の vars を設定:
   ```jsonc
   "vars": {
     "TEAM_DOMAIN": "https://<team-name>.cloudflareaccess.com",
     "POLICY_AUD": "<コピーした AUD Tag>"
   }
   ```

3. デプロイ: `pnpm deploy`

## 5. 動作確認

```bash
# 未認証（Access のログインページにリダイレクト）
curl -I https://nyalog-api.<subdomain>.workers.dev/api/me

# ヘルスチェック（認証不要）
curl https://nyalog-api.<subdomain>.workers.dev/api/health
```
