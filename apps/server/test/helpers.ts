import { defaultConfig } from "@wbz/core";
import type { Db } from "@wbz/db";
import { createNodeDb } from "@wbz/db/node";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach } from "vitest";

export const TEST_DB_URL = process.env.DATABASE_URL_TEST ?? "";
if (!TEST_DB_URL) {
  throw new Error("DATABASE_URL_TEST is not set. Point it at a migrated, disposable Postgres database (see README).");
}

export const SECRET = "test-suppression-secret-0123456789abcdef";
export const deps = { config: defaultConfig, suppressionSecret: SECRET };

export function useTestDb(): Db {
  const { db, close } = createNodeDb(TEST_DB_URL, 3);
  beforeEach(async () => {
    await db.execute(sql`
      truncate companies, contacts, field_sources, imports, import_rows,
               dedupe_candidates, suppressions, stage_events, campaigns, discovery_queries,
               campaign_companies, jobs, api_cache, audits, findings restart identity cascade`);
  });
  afterAll(close);
  return db;
}

export async function countRows(db: Db, table: string): Promise<number> {
  const res = (await db.execute(sql.raw(`select count(*)::int as n from ${table}`))) as unknown as {
    rows: { n: number }[];
  };
  return res.rows[0]?.n ?? 0;
}
