# プロジェクトステータス

> このファイルは「今の状態」だけを持つ**ハブ**。セッション開始毎に全文が読み込まれるため、解決済み課題の詳細や残課題の長い説明はここに書かず、リンク先 ([plans/](./plans/) / ADR / PR) に置いて必要になった時だけ読みに行く。履歴は git log と ADR を参照。

## 現在のフェーズ

**フロントエンド改善フェーズ (2026-08-04 開始)**。`modern-web-guidance` + `vercel-react-best-practices` の両 skill でフロント全体を監査済み。実施順と各項目の詳細は [plans/frontend-improvements.md](./plans/frontend-improvements.md)。

セキュリティ防御強化は主要対応 (auth rate limit / Observability / robots.txt / セキュリティヘッダ) 反映済み。残タスクは [plans/security-remaining.md](./plans/security-remaining.md)。

開発基盤はサンドボックス開発 + ホストリレー + キーレスデプロイ ([ADR-008](./adr/008-sandboxed-development-and-credential-free-pipeline.md)) が稼働中。

## 次にやること (次セッションの出発点)

1. **フロントエンド改善** — [plans/frontend-improvements.md](./plans/frontend-improvements.md) を上から順に PR 化する。計画 1 (base layer のフォームコントロール根治) は [#74](https://github.com/okayus/nyalog/pull/74)、計画 2 (a11y/UX 小束) は [#76](https://github.com/okayus/nyalog/pull/76) で完了。**次: 計画 3「トイレ記録の全件フェッチ / 全件レンダリング解消」**(list API に `?since=` / `?limit=` + `.record-item` に `content-visibility`)
2. **セキュリティ残タスク** — [plans/security-remaining.md](./plans/security-remaining.md)(予算アラート / rate limit 再検証 / `/security-review` / 運用 TODO)
3. **機能候補 (順序流動)** — 猫タスクの月カレンダー表示 (`enumerateDueDates` 実装済み、UI のみ) / ご飯・カロリー管理 (スキーマ設計から) / ADR-004 phase 2 の `created_by` NOT NULL 化(**cats rebuild で D1 CASCADE 再発リスク — [ADR-005 Addendum](./adr/005-per-space-membership.md#addendum-2026-04-22-pr-4-で踏んだ-d1-cascade-事故) のチェックリスト必須**)

## 後回し (Backlog)

- Hono RPC クライアント(現状は手書き fetch ラッパで型安全確保済み)
- 薬・動物病院の予定管理 / ご飯・カロリー管理 — リリース後に着手
- e2e Phase 2 (WebAuthn + 認可横流れ) — 設計メモ: [plans/e2e-phase2.md](./plans/e2e-phase2.md)
- 医療記録の e2e 1 本 — 次に医療記録周辺を触る PR で(記録作成 → upload → 表示 → 削除 → R2/DB 両方から消える)
- スペース招待 API (`/api/spaces/:id/invites`) — 家族追加の再需要が出たら

## 完了済みフェーズ (詳細は PR / ADR)

- 猫タスク (定期 todo): schema/domain/API [#61](https://github.com/okayus/nyalog/pull/61) + UI [#62](https://github.com/okayus/nyalog/pull/62)。月カレンダー・通知・週次はスコープ外
- 血液検査 Vision 解析 + 表示 UI: [ADR-007](./adr/007-blood-test-vision-analysis.md)、PR #45〜#60(Claude Vision 等への移行トリガーも ADR に記載)
- 医療記録 (画像/PDF 添付、R2 + Worker proxy): [ADR-006](./adr/006-medical-records-r2.md)、PR #40〜#43
- per-space 認可移行: [ADR-005](./adr/005-per-space-membership.md)、PR #34〜#37(D1 CASCADE 事故と復旧は Addendum)
- CSS 近代化 PR-A〜F (#15〜#20): @layer + OKLCH / logical + dvh / CQ + subgrid / :has() + popover + details / View Transitions / scroll-driven。**今後の新機能はこのモダン CSS 前提で書く**
- 体重記録 + 自作 SVG グラフ (#53)、過去体重 50 件 + 排尿ログ 1201 件の本番一括インポート
- UI 改善: 今日のタスクのチップ化 (#69) / 絵文字ラベル (#23) / 猫テーマカラー (#22) / 動物病院カレンダー埋め込み (#21)
- セキュリティ: Observability + auth rate limit (#49) / robots.txt (#52) / SPA HTML への security headers (#14) / 監査対応 5 PR (#8〜#12)
- 基盤: Workers Builds キーレスデプロイ + ホストリレー ([ADR-008](./adr/008-sandboxed-development-and-credential-free-pipeline.md)) / skills vendoring 統一 + modern-web-guidance 導入 (#70) / workers.dev サブドメイン改名 (→ shiraoka) とパスキー再登録・再紐付け (#67) / パスキー全紛失リカバリ手順修正 (#68)
- 初期整備: パスキー認証移行 (ADR-003) / トイレ記録 CRUD / 猫プロフィール CRUD / PR check CI / main 保護 ruleset / リポジトリ public 化

## 本番環境リファレンス (次セッション向け)

- 本番 URL: `https://nyalog.shiraoka.workers.dev`
- Cloudflare Account ID: `b206ff3a1f57cd57469b20adaf8be123`
- D1 `database_id`: `82db6367-0a73-46d3-baf3-c665adf1e10b` (`wrangler.jsonc` にも記載)
- Worker 名: `nyalog`
- RP_ID: `nyalog.shiraoka.workers.dev`
- 現在投入済みの secret: `SESSION_SECRET` (HS256 JWT 用)
- `INITIAL_REGISTRATION_TOKEN` は失効済み (家族追加時のみ再投入)
- 手動デプロイ経路は今も生きている: `pnpm run deploy` (`packages/web` から)
