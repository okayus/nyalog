# Google OAuth クライアント作成手順

Cloudflare Access で Google ログインを使うために、Google Cloud Platform で OAuth 2.0 クライアントを作成する手順。

## 前提条件

- Google アカウント
- [Google Cloud Console](https://console.cloud.google.com/) へのアクセス

## 手順

### 1. Google Cloud プロジェクトを作成

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス
2. 画面上部のプロジェクトセレクタ → 「新しいプロジェクト」
3. プロジェクト名: `nyalog` → 「作成」

### 2. OAuth 同意画面を構成

1. 左メニュー **API とサービス** → **OAuth 同意画面** に移動
   - または直接: `https://console.cloud.google.com/auth/overview?project=nyalog`
2. 「Google Auth Platform はまだ構成されていません」と表示されたら「**開始**」をクリック
3. 4ステップのウィザードに従う:

**Step 1: アプリ情報**
- アプリ名: `nyalog`
- ユーザーサポートメール: 自分のメールアドレスを選択
- 「次へ」

**Step 2: 対象**
- 「**外部**」を選択（Google Workspace ではないため）
- 「次へ」

**Step 3: 連絡先情報**
- メールアドレス: 自分のメールアドレスを入力
- 「次へ」

**Step 4: 終了**
- 「Google API サービス: ユーザーデータに関するポリシーに同意します」にチェック
- 「続行」

4. 「**作成**」をクリック

### 3. OAuth クライアント ID を作成

1. OAuth 概要画面で「**OAuth クライアントを作成**」をクリック
   - または左メニュー **クライアント** → 画面上部のリンク
   - または直接: `https://console.cloud.google.com/auth/clients/create?project=nyalog`
2. 以下を入力:

| 項目 | 値 |
|---|---|
| アプリケーションの種類 | ウェブ アプリケーション |
| 名前 | `nyalog-cloudflare-access` |
| 承認済みの JavaScript 生成元 | `https://<team-name>.cloudflareaccess.com` |
| 承認済みのリダイレクト URI | `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/callback` |

`<team-name>` は Cloudflare Zero Trust のチーム名（例: `toshiaki-mukai-9981`）。

3. 「**作成**」をクリック
4. ダイアログに **クライアント ID** が表示される → 「OK」
5. クライアント詳細画面の右サイドパネル「**情報と概要**」で **クライアントシークレット** を確認

### 4. 値を記録

以下の2つの値を Cloudflare Access の設定で使用する:

- **クライアント ID**: `xxxx.apps.googleusercontent.com` 形式
- **クライアントシークレット**: `GOCSPX-xxxx` 形式

次のステップ: [cloudflare-access-setup.md](./cloudflare-access-setup.md) の「Google を Identity Provider として追加」

## 注意事項

- OAuth 同意画面の「対象」を「外部」にした場合、アプリは**テストモード**で起動する。テストモードでは、テストユーザーとして追加されたユーザーのみが OAuth 同意画面を通過できる。ただし Cloudflare Access 経由のログインではこの制限は実質的に Access Policy 側で制御される
- OAuth クライアントの設定が有効になるまで 5 分〜数時間かかる場合がある
- 6ヶ月間使用されていない OAuth クライアントは削除対象になる（通知あり）
