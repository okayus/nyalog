import { execSync } from "node:child_process";

const DEV_USER_ID = "00000000-0000-4000-8000-000000000000";

export default async function globalSetup() {
  const sql = [
    `DELETE FROM toilet_records WHERE created_by = '${DEV_USER_ID}';`,
    `DELETE FROM cats WHERE created_by = '${DEV_USER_ID}';`,
  ].join(" ");
  execSync(`pnpm exec wrangler d1 execute nyalog-db --local --command "${sql}"`, {
    stdio: "inherit",
  });
}
