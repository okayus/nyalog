# nyalog - Cat Care Management App

猫の健康管理Webアプリケーション。トイレ記録、薬・動物病院の予定管理、ご飯の商品とカロリー表示を提供する。

**現在のプロジェクト状況**: [docs/status.md](./docs/status.md) を参照。セッション開始時に必ず確認すること。

## 技術スタック

- **インフラ**: Cloudflare Workers (Assets + D1) — SPA と API を単一 Worker で配信
- **バックエンド**: Hono
- **フロントエンド**: React + Vite+ (`vp`) + `@cloudflare/vite-plugin`
- **ORM**: Drizzle ORM
- **バリデーション**: Zod
- **エラーハンドリング**: neverthrow (Result型)
- **パッケージマネージャ**: pnpm
- **言語**: TypeScript (strict mode)

## 開発ワークフロー

### ブランチ戦略

mainブランチは保護されている。すべての変更はPR経由でマージする。

作業開始時は以下のワークフローに従う:

1. **ブランチ作成**: `git switch -c <type>/<short-description>` (例: `feat/toilet-record`, `fix/auth-redirect`)
2. **空コミット**: `git commit --allow-empty -m "chore: start <description>"` で作業開始を記録
3. **PR作成**: 作業計画を本文に記載したDraft PRを作成し、pushする
4. **実装**: 計画に沿って実装を進め、PRの本文を実態に合わせて更新する
5. **ステータス更新**: 大きな節目 (機能完成、フェーズ移行、後回し判断) で [docs/status.md](./docs/status.md) を併せて更新する。PRの一部に含めて良い
6. **マージ**: squash mergeでmainにマージ

### ブランチ命名規則

- `feat/` — 新機能
- `fix/` — バグ修正
- `refactor/` — リファクタリング
- `chore/` — 設定・ツール・依存関係
- `docs/` — ドキュメント

### コミットメッセージ

[Conventional Commits](https://www.conventionalcommits.org/) に従う:

```
<type>: <description>
```

type: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`

## コーディング思想

**Domain Modelling Made Functional** の原則に基づく。

### 核心原則

- **型で不正な状態を表現不可能にする**: ドメインの制約を型システムで強制する。不正なデータがコンパイル時に排除されるようにする
- **代数的データ型でドメインをモデリングする**: Discriminated Unionで状態遷移を表現し、パターンマッチで網羅性を保証する
- **純粋関数でドメインロジックを書く**: 副作用（DB, API, IO）は境界に押し出し、ドメインロジックは入力→出力の純粋な変換として実装する
- **Result型でエラーを型安全に扱う**: neverthrowのResult/ResultAsyncを使い、例外をthrowしない。エラーも戻り値の型の一部として表現する
- **Zodスキーマでドメイン制約を表現する**: バリデーションをスキーマとして宣言し、Branded Typeで「検証済み」を型レベルで保証する
- **Branded Typeには `unique symbol` を使う**: 各Branded Typeが構造的に区別されるよう `{ readonly __brand: unique symbol }` で定義する。文字列リテラルではなく `unique symbol` を使うことで、異なるBranded Type間の誤った代入をコンパイル時に防ぐ

### 実装パターン

```typescript
// ドメインモデルは Discriminated Union で表現
type ToiletRecord =
  | { type: "urination"; timestamp: Date; catId: CatId }
  | { type: "defecation"; timestamp: Date; catId: CatId; condition: StoolCondition };

// Branded Type で検証済みの値を区別
type CatId = string & { readonly __brand: unique symbol };
const CatId = z.string().uuid().brand<"CatId">();

// ドメインロジックは純粋関数 + Result型
function createToiletRecord(input: unknown): Result<ToiletRecord, ValidationError> {
  // ...
}

// 副作用は境界（リポジトリ, ハンドラ）に閉じ込める
```

### やらないこと

- `throw` によるエラー伝播（Result型を使う）
- any型の使用
- 過度な抽象化・汎用化（現在の要件に必要な最小限の複雑さ）
- 不要なコメント・ドキュメント（型と関数名で意図を伝える）

## テスト方針

**ユニットテストと e2e は別レイヤーの別責務**。混ぜない。

### ユニットテスト — ドメインの *意味* を表現する

- 対象: 純粋関数、Discriminated Union のパターンマッチ、Zod スキーマ、Result を返すドメイン関数
- 問い: 「この値は何を意味するか」「この関数の契約は何か」
- 型で表現しきれない意味的制約（例: "排便記録には必ず condition が付く"）を固定する
- IO・HTTP・DB は一切持ち込まない。副作用は境界の外側なので、ここで検証しても意味を表さない
- 型で既に保証されていること（`CatId` に string を渡すとコンパイルエラー、等）はテストにしない。型がテストの代替

### e2e テスト — 配線と *存在の事実* を表現する

- 対象: `vp dev` 相手に実ブラウザで通すユーザーシナリオ 1〜数本と、型で保証できない境界
- 問い: 「型で保証できないものが、実際に繋がって動いているか」
- 守る範囲（意図的に狭く）:
  - **クリティカルパス 1 本**: ログイン → 猫作成 → 記録 → 編集 → 削除 → ログアウト
  - **永続化の事実**: リロード後にデータが残る（ユニットでは原理的に検知不能）
  - **認可の横流れ**: 他ユーザーのリソースに触れない（WHERE 句漏れの回帰防止）
  - **セキュリティヘッダ**: CSP / HSTS / X-Frame-Options の付与（ミドルウェア配線の回帰防止）
- 入れない: ドメインの意味（ユニットに譲る）、見た目のアニメーション挙動（ブラウザ依存の偶有的複雑さ）、網羅的な入力バリデーション（ユニットと Zod で押さえる）

### 棲み分けの原則

- ユニットが "means"、e2e が "exists and is wired"。ユニットが増えても e2e は増えない（増やさない）
- e2e でドメインの網羅を目指さない。1 本のスモークと、型で絶対に検知できない数点だけを持つ
- ユニットで IO をモックしない。モックが必要な時点でそれは e2e の領域

## コマンド

```bash
# 開発
pnpm dev              # 開発サーバー起動
pnpm build            # プロダクションビルド
vp check              # format, lint, type check

# データベース
pnpm db:generate      # Drizzleマイグレーション生成
pnpm db:migrate       # マイグレーション適用(ローカル)
pnpm db:migrate:prod  # マイグレーション適用(本番)

# デプロイ
pnpm deploy           # Cloudflareへデプロイ
```

## ユーザーアクションが必要な操作

**クレデンシャル（パスワード、APIキー、OAuthトークン等）の入力が必要な操作のみ**ユーザーに依頼する:

- 認証フロー（`wrangler login`, `gcloud auth login` 等）
- シークレットの設定（`.dev.vars`, Cloudflare Dashboardのシークレット管理）
- 外部サービスのアカウント作成・APIキー取得

クレデンシャルが不要な操作（対話的TUI、設定変更、コマンド実行等）はユーザーに依頼せず、設定ファイルやCLIフラグで自分で解決する。

## プロジェクト構成

```
nyalog/
├── packages/
│   └── web/                    # React SPA + Hono API (単一 Worker)
│       ├── src/                # React フロントエンド
│       │   ├── App.tsx
│       │   └── main.tsx
│       ├── worker/             # Hono バックエンド
│       │   ├── index.ts        # API エントリポイント
│       │   ├── access-auth.ts  # Cloudflare Access JWT 検証
│       │   └── db/schema.ts    # Drizzle スキーマ
│       ├── drizzle/            # マイグレーションファイル
│       ├── drizzle.config.ts
│       ├── wrangler.jsonc      # Workers 設定 (Assets + D1)
│       ├── vite.config.ts      # Vite+ + @cloudflare/vite-plugin
│       ├── index.html
│       └── tsconfig.json
├── docs/adr/                   # Architecture Decision Records
├── package.json                # ルート (pnpm workspace)
├── pnpm-workspace.yaml
└── CLAUDE.md
```
