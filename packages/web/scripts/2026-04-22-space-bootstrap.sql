-- ADR-005 PR 2: 本番 D1 への per-space membership bootstrap
-- 同時に ADR-004 phase 2 (created_by backfill) も実施
--
-- 実行コマンド:
--   pnpm exec wrangler d1 execute nyalog-db --remote \
--     --file packages/web/scripts/2026-04-22-space-bootstrap.sql
--
-- 実行前提:
--   - PR #34 (feat: shared-space foundation) がマージ済み
--   - migration 0006_red_spacker_dave.sql が --remote 適用済み
--   - 本番 D1 のフルバックアップを取得済み (backups/2026-04-22-pre-space-bootstrap.sql)
--
-- 実行後の状態:
--   spaces           = 1 行 (nyalog family)
--   space_members    = 3 行 (全 users が owner で join)
--   cats.space_id    = 2 行とも 'dc3553bf-6937-4074-ad9b-7f90c1a5597c'
--   cats.created_by  = 2 行とも '311beb11-dcfa-4bc6-abde-269111308f91' (とち)
--   toilet_records.created_by = 全 1255 行とも non-NULL (1202 行が backfill)
--
-- 役割選定の根拠 (ADR-005):
--   - 家族 4 人規模では owner / member の差を実認可に使わない (招待機能未導入)
--   - 全員 owner にしておくことで「最後の owner が消える」状態を回避
--   - 招待機能を入れる時に owner-only 権限を見直す

-- 1. nyalog family スペースを作成
INSERT INTO spaces(id, name, created_at)
VALUES ('dc3553bf-6937-4074-ad9b-7f90c1a5597c', 'nyalog family', '2026-04-22T12:39:00.000Z');

-- 2. 全 users を space_members に owner で join
INSERT INTO space_members(space_id, user_id, role, created_at)
SELECT 'dc3553bf-6937-4074-ad9b-7f90c1a5597c', id, 'owner', '2026-04-22T12:39:00.000Z' FROM users;

-- 3. 既存の cats を nyalog family スペースに backfill
UPDATE cats SET space_id = 'dc3553bf-6937-4074-ad9b-7f90c1a5597c' WHERE space_id IS NULL;

-- 4. cats.created_by を「とち」に backfill (ADR-004 phase 2)
UPDATE cats SET created_by = '311beb11-dcfa-4bc6-abde-269111308f91' WHERE created_by IS NULL;

-- 5. toilet_records.created_by を「とち」に backfill (ADR-004 phase 2)
UPDATE toilet_records SET created_by = '311beb11-dcfa-4bc6-abde-269111308f91' WHERE created_by IS NULL;
