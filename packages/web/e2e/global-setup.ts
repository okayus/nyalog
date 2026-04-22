import { execSync } from "node:child_process";

const DEV_USER_ID = "00000000-0000-4000-8000-000000000000";

// Fixtures for cross-space.spec.ts. These rows simulate "another family"
// that the dev-bypass user should never be able to reach via the API.
// 固定 UUID にしておくと spec 側から直叩きできる。
export const OTHER_USER_ID = "00000000-0000-4000-8000-000000000099";
export const OTHER_SPACE_ID = "00000000-0000-4000-8000-000000000098";
export const OTHER_CAT_ID = "00000000-0000-4000-8000-000000000097";
export const OTHER_RECORD_ID = "00000000-0000-4000-8000-000000000096";

export default async function globalSetup() {
  const cleanupDevData = [
    `DELETE FROM toilet_records WHERE created_by = '${DEV_USER_ID}';`,
    `DELETE FROM cats WHERE created_by = '${DEV_USER_ID}';`,
  ].join(" ");

  // INSERT OR IGNORE で idempotent。spec が消した場合に備えて毎回 ensure。
  const seedOtherSpace = [
    `INSERT OR IGNORE INTO users(id, display_name, created_at) VALUES ('${OTHER_USER_ID}', 'other', '2026-04-22T00:00:00.000Z');`,
    `INSERT OR IGNORE INTO spaces(id, name, created_at) VALUES ('${OTHER_SPACE_ID}', 'other family', '2026-04-22T00:00:00.000Z');`,
    `INSERT OR IGNORE INTO space_members(space_id, user_id, role, created_at) VALUES ('${OTHER_SPACE_ID}', '${OTHER_USER_ID}', 'owner', '2026-04-22T00:00:00.000Z');`,
    `INSERT OR IGNORE INTO cats(id, name, theme_color, space_id, created_by, created_at, updated_at) VALUES ('${OTHER_CAT_ID}', 'other-cat', 'gray', '${OTHER_SPACE_ID}', '${OTHER_USER_ID}', '2026-04-22T00:00:00.000Z', '2026-04-22T00:00:00.000Z');`,
    `INSERT OR IGNORE INTO toilet_records(id, cat_id, type, timestamp, created_by, created_at, updated_at) VALUES ('${OTHER_RECORD_ID}', '${OTHER_CAT_ID}', 'urination', '2026-04-22T00:00:00.000Z', '${OTHER_USER_ID}', '2026-04-22T00:00:00.000Z', '2026-04-22T00:00:00.000Z');`,
  ].join(" ");

  execSync(
    `pnpm exec wrangler d1 execute nyalog-db --local --command "${cleanupDevData} ${seedOtherSpace}"`,
    { stdio: "inherit" },
  );
}
