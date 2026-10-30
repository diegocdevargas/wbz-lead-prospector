import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { Db } from "./client.ts";
import * as schema from "./schema.ts";

export function createNodeDb(connectionString: string, max = 5): { db: Db; close: () => Promise<void> } {
  const pool = new pg.Pool({ connectionString, max });
  const db = drizzle(pool, { schema }) as unknown as Db;
  return { db, close: () => pool.end() };
}
