import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createNodeDb } from "./node.ts";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const { db, close } = createNodeDb(url, 1);
const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
try {
  await migrate(db as never, { migrationsFolder });
  console.log("migrations applied");
} finally {
  await close();
}
