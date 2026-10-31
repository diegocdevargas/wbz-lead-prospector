import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Read DATABASE_URL_TEST from the root .env so `pnpm test` needs no inline env vars (Windows-friendly).
const envFile = fileURLToPath(new URL("./.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.{ts,tsx}"],
    // DB tests share one database; run files one at a time.
    fileParallelism: false,
    env: { TZ: "UTC" },
  },
});
