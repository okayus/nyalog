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

### 開発環境の前提 (ADR-008)

開発は **egress 制限つき Docker サンドボックス内**で行う（[docs/local-dev.md](./docs/local-dev.md) 冒頭参照）。コンテナには credential が一切無い: `git push` は deny かつ不可能、`gh` は未認証で動かない、`wrangler login` はしない。push/PR が必要な操作はホスト側リレーか人間が担う。

- PR / CI の状態確認は **`scripts/ci-status.sh`**（`--watch` で決着まで待つ）。public repo なので
  読み取りは認証不要・60 req/h の未認証 REST を叩いている。手で引くなら
  `curl -s https://api.github.com/repos/okayus/nyalog/commits/<sha>/check-runs`
- **追いコミット後は branch でなく sha で引く。** `commits/<branch>/check-runs` はリレーが push する前の
  古い sha の結果を返すため、CI 完了を待つループが前の commit の success を掴んで誤って抜ける。
  `ci-status.sh` は `git rev-parse HEAD` の sha 固定なのでこの穴を踏まない
- **merge 後の deploy 完了は GitHub からは見えない。** Workers Builds は commit status を出さない
  （`commits/<sha>/status` は `statuses: []` のまま）。本番の `/assets/index-*.css` のハッシュが
  ローカルビルド (`packages/web/dist/client/assets/`) と一致するかで確認する。
  **`scripts/deploy-status.sh --build --watch`** がこの照合をやる
- **リレーは先頭 commit から PR タイトルを付ける。** ブランチの先頭には本題の commit を置くこと
  （準備・段取り系を先に積むと、squash 後の main の履歴まで実態より小さい名前になる。
  PR #76 が `chore: 段取りを整える` のまま feat 本体ごとマージされた）
- 血液検査解析は dev では `mock` analyzer 固定（`wrangler.local.jsonc`）。実モデルは本番のみ

### ブランチ戦略

mainブランチは保護されている。すべての変更はPR経由でマージする。

**サンドボックス内エージェント**（コンテナ内 claude）の作業フロー:

1. **ブランチ作成**: `git switch -c claude/<type>-<short-description>` (例: `claude/feat-toilet-record`)。`claude/*` 以外はリレーが push を拒否する
2. **実装と commit**: commit までがエージェントの仕事。push はしない — ホスト側リレー (systemd timer, 60秒間隔) が自動 push し、PR を作成する
3. **CI 確認**: 上記の未認証 REST で check-runs を確認し、red なら直して commit を積む
4. **マージ**: 確信のある完成した変更のみ、最終 commit メッセージ末尾に `Relay-Merge: yes` トレーラーを付けると、CI green 後にリレーが squash merge する（トレーラーは HEAD commit のみ有効）。迷う変更・影響の大きい変更には付けず、人間のレビューとマージに委ねる。**migration（`drizzle/` の変更）を含む PR には絶対に付けない** — merge は Workers Builds の deploy command 経由で本番 D1 への migration 適用まで直結する（D1 cascade 事故の前歴: ADR-005 Addendum）
5. **ステータス更新**: 大きな節目で [docs/status.md](./docs/status.md) を併せて更新する。PRの一部に含めて良い

**ホストでの作業**（人間）は従来どおり: `git switch -c <type>/<short-description>` → 空コミット → 計画を本文に書いた Draft PR → 実装 → squash merge。

### ブランチ命名規則

- `claude/<type>-<desc>` — サンドボックス内エージェントの作業（リレーが push/PR を代行する唯一の prefix）
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

### Agent skills の管理

third-party skill は `.claude/skills/` に **実体を vendoring する（symlink にしない）**。追加・更新はサンドボックス内で実行する（ADR-008: npm パッケージをホストで走らせない）:

```bash
docker compose exec dev npx -y skills@latest add <owner>/<repo> -y -s <skill> --copy
docker compose exec dev npx -y skills@latest update -y -p    # 更新 (project スコープ)
```

- **`--copy` 必須。** 既定の symlink は gitignore 済みの `.agents/` を指すため clone 先で必ず壊れる。しかも壊れても警告が出ず、同名の user-scope skill があるとそちらが解決して「使えているように見える」。実際 `vercel-react-best-practices` はこれで 2 ヶ月壊れたまま気づかなかった（PR #70 で修正）
- **更新は単独 PR で。** 差分が数万行になるので他の変更と混ぜない
- `--copy` は `.agents/skills/` と `.claude/skills/` の両方に置き、`skills list` は前者を表示する。**git が追うのは後者**なので、更新後は `git status` に `.claude/skills/` の差分が出ていることを必ず確認する
- `skills-lock.json` は commit する。skill を捨てる時はエントリも一緒に消す（壊れたまま残さない）
- 検証: `find .claude/skills -xtype l` が空であること

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

### 認可: per-space membership

認可の単位は **スペース** ([ADR-005](./docs/adr/005-per-space-membership.md))。`sessionMiddleware` がリクエスト毎に `c.var.userId` と `c.var.memberSpaceIds: SpaceId[]` をセットする。

- **タスク系のクエリ** (`cats` / `toilet_records`) は `WHERE space_id IN c.var.memberSpaceIds` で必ず絞る。`toilet_records` は `cats` 経由で間接的にスペースに属するため、cat lookup の段階で `inArray(cats.spaceId, memberSpaceIds)` を効かせる
- **新規 INSERT** は `space_id = c.var.memberSpaceIds[0]` を bind（単一スペース所属の家族 UX 前提）。`memberSpaceIds.length === 0` なら 403
- **所属外スペースの id 直叩き** は 404 で返す（403 にすると存在が漏れる）
- **`credentials` / `sessions`** は引き続き `user_id = c.var.userId` 軸で絞る（パスキーは個人のもの）
- **`created_by`** は audit 用属性であって認可軸ではない ([ADR-004](./docs/adr/004-family-shared-with-created-by.md))

### やらないこと

- `throw` によるエラー伝播（Result型を使う）
- any型の使用
- 過度な抽象化・汎用化（現在の要件に必要な最小限の複雑さ）
- 不要なコメント・ドキュメント（型と関数名で意図を伝える）

### フロントエンド: モダン Web 前提

HTML/CSS/クライアント JS を書く前に **`modern-web-guidance` skill を引く**（[GoogleChrome/modern-web-guidance](https://github.com/GoogleChrome/modern-web-guidance)、`.claude/skills/` に導入済み）。モデルの訓練データは古いパターンに偏っており、nyalog は「モダン CSS を実践するサンプル」を標榜しているため、当てずっぽうで書かない。

**Browser Support ポリシー**: 家族数人が各自のスマホで使うだけなので、**Baseline Newly available まで採用してよい**。ただし polyfill と重い fallback は入れない — 未対応ブラウザでは *機能が消えるだけで壊れない* 形に倒す（graceful degradation）。既存の前例に倣うこと:

- `src/view-transition.ts`: `typeof doc.startViewTransition === "function"` で機能検出し、未対応なら即時 `update()`
- scroll-driven animations / `[popover]` / `:has()`: 未対応でも内容は読める前提で採用済み
- `@media (prefers-reduced-motion: reduce)` は常に添える

## テスト方針

**ユニットテストと e2e は別レイヤーの別責務**。混ぜない。

### ユニットテスト — ドメインの _意味_ を表現する

- 対象: 純粋関数、Discriminated Union のパターンマッチ、Zod スキーマ、Result を返すドメイン関数
- 問い: 「この値は何を意味するか」「この関数の契約は何か」
- 型で表現しきれない意味的制約（例: "排便記録には必ず condition が付く"）を固定する
- IO・HTTP・DB は一切持ち込まない。副作用は境界の外側なので、ここで検証しても意味を表さない
- 型で既に保証されていること（`CatId` に string を渡すとコンパイルエラー、等）はテストにしない。型がテストの代替

### e2e テスト — 配線と _存在の事実_ を表現する

- 対象: `vp dev` 相手に実ブラウザで通すユーザーシナリオ 1〜数本と、型で保証できない境界
- 問い: 「型で保証できないものが、実際に繋がって動いているか」
- 守る範囲（意図的に狭く）:
  - **クリティカルパス 1 本**: ログイン → 猫作成 → 記録 → 編集 → 削除 → ログアウト
  - **永続化の事実**: リロード後にデータが残る（ユニットでは原理的に検知不能）
  - **認可の横流れ**: 他スペースのリソースに触れない（`WHERE space_id IN c.var.memberSpaceIds` 漏れの回帰防止 / [ADR-005](./docs/adr/005-per-space-membership.md)）
  - **セキュリティヘッダ**: CSP / HSTS / X-Frame-Options の付与（ミドルウェア配線の回帰防止）
- 入れない: ドメインの意味（ユニットに譲る）、見た目のアニメーション挙動（ブラウザ依存の偶有的複雑さ）、網羅的な入力バリデーション（ユニットと Zod で押さえる）

**`pnpm test:e2e` はローカル dev の猫と記録を消す。** `e2e/global-setup.ts` が dev-bypass ユーザの `cats` / `toilet_records` を毎回全削除する（cascade で `cat_task_cats` / `cat_task_completions` も落ちる）。画面で動作確認しながら作業しているなら、e2e は**確認を撮り終えてから**回すこと。復旧:

```bash
pnpm --filter @nyalog/web exec wrangler d1 execute nyalog-db --local --file scripts/dev-seed.sql
```

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
pnpm deploy           # 手動デプロイ (緊急用、要 wrangler login)。通常は main への
                      # merge で Workers Builds が migration + deploy を自動実行

```

### D1 migration の注意点

**親テーブル (cascade FK の指される側) を drizzle で table rebuild する時は特に慎重に。** Cloudflare D1 は drizzle-kit が生成する `PRAGMA foreign_keys=OFF` を無視する。`DROP TABLE parent;` の暗黙 DELETE が child の `ON DELETE CASCADE` を発火させて child 全行が消える。PR #37 で踏んだ ([ADR-005 Addendum](./docs/adr/005-per-space-membership.md#addendum-2026-04-22-pr-4-で踏んだ-d1-cascade-事故))。

table rebuild を含む migration を本番 `--remote` 適用する前に必ず:

1. `wrangler d1 export nyalog-db --remote --output=backups/<date>-<summary>.sql`
2. schema で該当テーブルを親として指す `onDelete: "cascade"` FK の有無を確認
3. migration 後に child の `COUNT(*)` を backup 時点と照合
4. ズレたら `grep '^INSERT INTO "<child>"' backup.sql > restore.sql; wrangler d1 execute --remote --file restore.sql` で復旧

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
│       │   ├── middleware/     # session / challenge-cookie (WebAuthn)
│       │   ├── routes/         # auth / cats / toilet-records
│       │   ├── domain/         # ドメインモデル (Zod + Result)
│       │   ├── db/schema.ts    # Drizzle スキーマ
│       │   └── types.ts        # Hono Env / Bindings
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
