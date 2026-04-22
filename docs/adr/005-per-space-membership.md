# ADR-005: 認可モデルを「暗黙の family-shared」から「per-space メンバーシップ」へ

## ステータス

承認

## 日付

2026-04-22

## コンテキスト

ADR-004 で「全家族 = 1 テナント」の暗黙モデルを採用した結果、現状コードは認証済みなら誰でも全ての `cats` / `toilet_records` を CRUD できる。実利用では家族 4 人で運用しているため機能は破綻しないが、以下の問題がある:

1. **CLAUDE.md / 旧設計書との乖離**: 「IDOR 対策として `WHERE user_id = ?` を必須にする」という方針が形骸化し、`packages/web/worker/routes/cats.ts` には `user_id` フィルタが一切ない
2. **一般化余地が消えている**: 「家族 = 1 テナント」を将来的に「複数の家族 / グループで使う」にスライドさせる設計余地がコードに反映されていない
3. **境界が暗黙的**: 認可の単位（家族のスコープ）がテーブル構造に存在せず、ドメインに登場する概念ではない

ADR-004 の §影響範囲で「将来マルチテナント化する場合は `tenant_id` を新設」と書いたが、ADR-004 自体ではその構造を入れていない。本 ADR でそれを実装する。

routine-tasks プロジェクト ([docs/adr/0001-shared-space-authorization.md](https://github.com/okayus/routine-tasks/blob/main/docs/adr/0001-shared-space-authorization.md)) で同じ判断に到達しており、設計はそれを踏襲する。

## 検討した選択肢

### A. 現状維持（暗黙の family-shared）

- Pros: 追加実装ゼロ
- Cons: ADR-004 の問題（暗黙性）が残る。ドキュメントとコードの乖離も残る

### B. per-space メンバーシップ（採用）

- Pros: 認可の単位が `spaces` テーブルとして明示。複数家族 / グループでの利用に拡張可能。`cats.space_id` で「この猫はどのスペース所属か」が型と DB に表現される
- Cons: `spaces` / `space_members` の 2 テーブル追加 + middleware に `memberSpaceIds` 解決を追加。クエリに `WHERE space_id IN (...)` の条件が増える

### C. `tenant_id` カラムだけ追加（テーブル追加なし）

- Pros: 軽量
- Cons: 「テナントの参加メンバー」をどこに保持するか問題が残る。結局 `space_members` 相当が必要

## 決定

**B を採用**。理由:

1. routine-tasks で先行した同じ設計判断と整合する（運用知見・docs を共有できる）
2. 家族 4 人前提の実態は当面 1 スペース固定で UI も増やさず、内部モデルだけ正規化する
3. middleware で `memberSpaceIds: SpaceId[]` を 1 クエリで解決すれば、後段の routes は `inArray(table.spaceId, c.var.memberSpaceIds)` 1 行で IDOR を塞げる

## 移行計画（4 PR、本番運用中のための段階移行）

| PR | スコープ | 本番影響 |
|---|---|---|
| **PR 1 ([#34](https://github.com/okayus/nyalog/pull/34))** | `spaces` / `space_members` テーブル追加、`cats.space_id` を NULLABLE で追加、`sessionMiddleware` に `memberSpaceIds` 解決を追加 | 挙動変化なし |
| PR 2 | 本番 bootstrap (手動 SQL): 1 スペース作成 + 全 `users` を join + `cats.space_id` backfill。ADR-004 phase 2 (`created_by` backfill) と同時実施 | DB 書き込みのみ、コード変更なし |
| PR 3 | `cats` / `toilet_records` routes の WHERE に `inArray(spaceId, c.var.memberSpaceIds)` 導入。新規 INSERT に `space_id` 指定。e2e に「他 user の id 直叩き → 404」追加。CLAUDE.md と本 ADR の認可記述を反映 | 認可が形式化される（実機能は不変） |
| PR 4 | `cats.space_id NOT NULL` 化（SQLite テーブル再作成、cats FK の ON DELETE CASCADE もここで効くようにする） | スキーマ確定 |

招待機能（`/api/spaces/:id/invites` と owner-only エンドポイント）は家族追加サイクル完了済みのため保留。必要時に別 PR で追加。

## 認可ルール（PR 3 完了後）

- `sessionMiddleware` が `c.var.userId` と `c.var.memberSpaceIds: SpaceId[]` の両方をセット
- 全 D1 クエリは `WHERE space_id IN (:memberSpaceIds)`（または middleware で絞られた後の `WHERE space_id = :spaceId`）で書く
- `toilet_records` は `cat_id` 経由で cats と JOIN し `cats.space_id IN (:memberSpaceIds)` で絞る（`toilet_records.space_id` 二重管理は避ける）
- `credentials` / `sessions` は引き続き `user_id = c.var.userId` 軸で絞る
- `created_by` は ADR-004 通り audit 用途であり認可軸ではない

## 影響範囲

- ADR-004 の「家族共有」方針は維持。差分は「家族 = 1 暗黙スコープ」を `spaces` 1 行として明示するだけ
- ADR-003 の WebAuthn / セッション設計は不変。RP_ID も不変なので既存パスキー全部有効のまま
- フロントエンドの API URL は `/api/cats` のまま据え置き（routine-tasks と違い `/api/spaces/:id/*` には移さない）。複数スペース所属が現実になった時点でルート構造を再検討

## 振り返りのタイミング

- PR 2 の bootstrap SQL が想定外に複雑になったら（複数家族で別スペース欲しい等）本 ADR を修正
- PR 3 完了後、`memberSpaceIds` 解決のためのクエリが N+1 やレイテンシ増の原因になったら JWT に embed する方向へ振る（現状は家族 4 人 × 1 スペースなので不要）
