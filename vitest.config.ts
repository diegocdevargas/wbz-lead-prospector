import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.{ts,tsx}"],
    // DB tests share one database; run files one at a time.
    fileParallelism: false,
    env: { TZ: "UTC" },
  },
});
