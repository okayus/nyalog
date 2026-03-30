# nyalog - Cat Care Management App

猫の健康管理Webアプリケーション。トイレ記録、薬・動物病院の予定管理、ご飯の商品とカロリー表示を提供する。

## 技術スタック

- **インフラ**: Cloudflare Workers / Pages / D1
- **バックエンド**: Hono (RPC)
- **フロントエンド**: React + Vite+ (`vp`)
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
5. **マージ**: squash mergeでmainにマージ

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

以下の操作はClaudeが直接実行できないため、ユーザーに依頼する:

- `sudo` が必要なシステム設定変更
- 環境変数の設定（`.dev.vars`, Cloudflare Dashboardのシークレット）
- Cloudflare / Firebase のダッシュボードでの設定
- 外部サービスのアカウント作成・APIキー取得
- `wrangler login` 等の対話的な認証フロー

これらが必要な場合は、具体的な手順を提示してユーザーにアクションを求める。

## プロジェクト構成

```
nyalog/
├── docs/adr/          # Architecture Decision Records
├── CLAUDE.md          # このファイル
└── ...                # (プロジェクト初期化後に追記)
```
