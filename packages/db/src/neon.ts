import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { Db } from "./client.ts";
import * as schema from "./schema.ts";

/**
 * Neon over WebSockets (not the HTTP driver) so interactive transactions work.
 * On Workers a Pool must not outlive the request: create one per request and
 * end it with ctx.waitUntil(close()).
 */
export function createNeonDb(connectionString: string): { db: Db; close: () => Promise<void> } {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema }) as unknown as Db;
  return { db, close: () => pool.end() };
}
