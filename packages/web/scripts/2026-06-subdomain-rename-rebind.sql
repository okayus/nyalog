-- account subdomain 改名 (toshiaki-mukai-9981 → shiraoka) 後の再オンボーディング SQL。
-- パスキーは RP_ID に束縛されるため改名で全滅し、register は常に新規 user を作る
-- (worker/routes/auth.ts — 既存 user への credential 追加経路は無い)。そのため
-- 家族の再登録後、新 user を既存スペースに紐付けて全データへのアクセスを復旧する。
--
-- 実行場所: Cloudflare dash → Storage & Databases → D1 → nyalog-db → Console
--           (または wrangler login 済みホストで
--            pnpm --filter @nyalog/web exec wrangler d1 execute nyalog-db --remote --command "...")
--
-- 手順:
-- 1) 家族全員が新 URL でパスキー再登録を済ませる
-- 2) ↓で新 user の id と既存スペースの id を確認する

SELECT id, display_name, created_at FROM users ORDER BY created_at DESC LIMIT 10;
SELECT id, name FROM spaces;
SELECT space_id, user_id, role FROM space_members;

-- 3) 新 user 1 人につき 1 行、既存スペースへ INSERT する (INSERT のみ = cascade リスクなし)。
--    <SPACE_ID> は手順2の spaces.id、<NEW_USER_ID> は再登録で出来た users.id、
--    <NOW> は ISO 8601 (例 2026-06-13T00:00:00.000Z)。

-- INSERT INTO space_members (space_id, user_id, role, created_at)
--   VALUES ('<SPACE_ID>', '<NEW_USER_ID>', 'owner', '<NOW>');

-- 4) 各自リロードして既存の猫・記録が見えることを確認する

-- 5) 後始末 (任意): 旧 RP_ID の credential は構造的に使用不能なので消してよい。
--    切替日時より前に作られたものだけを消す (再登録した新 credential を残す)。
--    旧 users 行は created_by (audit, ADR-004) が参照するため消さない。

-- DELETE FROM credentials WHERE created_at < '<切替日時のISO>';
