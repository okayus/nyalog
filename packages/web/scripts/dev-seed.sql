-- ローカル dev (miniflare D1) の fixture 再投入。
--
-- `pnpm test:e2e` の global-setup が dev-bypass ユーザの cats / toilet_records を毎回
-- 全削除する (cascade で cat_task_cats / cat_task_completions も消える) ため、e2e を
-- 回したあとに手元の画面を元に戻すためのスクリプト。何度流しても同じ結果になる。
--
--   pnpm --filter @nyalog/web exec wrangler d1 execute nyalog-db --local \
--     --file scripts/dev-seed.sql
--
-- 本番には絶対に流さない (--remote 禁止)。dev-bypass ユーザ / dev スペース専用。
-- INSERT OR REPLACE は使わない: D1 は PRAGMA foreign_keys=OFF を無視するので REPLACE の
-- 暗黙 DELETE が子テーブルの ON DELETE CASCADE を発火させる (ADR-005 Addendum)。

-- e2e が残していった猫を掃除
DELETE FROM cats
WHERE created_by = '00000000-0000-4000-8000-000000000000'
  AND name LIKE 'e2e-%';

-- 猫 2 匹
INSERT OR IGNORE INTO cats(id, name, birthday, theme_color, space_id, created_by, created_at, updated_at)
VALUES
  ('bbbbbbbb-0000-4000-8000-000000000001', 'しらたま', NULL, 'blue',
   '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000000',
   '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'おかゆ', NULL, 'pink',
   '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000000',
   '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- dev スペースの既存タスク (投薬 / 爪切り / フィラリア予防薬 / 歯みがきと耳そうじ) を
-- 両方の猫に紐付け直す
INSERT OR IGNORE INTO cat_task_cats(task_id, cat_id)
SELECT t.id, c.id
FROM cat_tasks t
CROSS JOIN cats c
WHERE t.space_id = '00000000-0000-4000-8000-000000000001'
  AND c.id IN (
    'bbbbbbbb-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000002'
  );
