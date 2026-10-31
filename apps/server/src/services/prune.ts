import { audits, companies, fieldSources } from "@wbz/db";
import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { pruneCache } from "./google.ts";
import type { Runtime } from "./runtime.ts";

/** Company columns cleared when their only sources are expired Places values. `name` is kept (see PR notes). */
const PRUNABLE: Record<string, (keyof typeof companies.$inferInsert)[]> = {
  phoneE164: ["phoneE164"],
  websiteUrl: ["websiteUrl", "domain"],
  address: ["address"],
  mapsUrl: ["mapsUrl"],
  googleRating: ["googleRating"],
  googleReviewCount: ["googleReviewCount"],
};

/**
 * Daily job: data retention.
 * 1. Expired API cache rows.
 * 2. Audit raw parts (HTML excerpt) older than audit.rawRetentionDays.
 * 3. Google Places values past their TTL, unless another source (the site
 *    itself, CNPJ, a manual import) also backs the same field.
 */
export async function runPrune(rt: Runtime) {
  const now = rt.now();
  await pruneCache(rt.db, now);

  const rawBefore = new Date(now.getTime() - rt.settings.config.audit.rawRetentionDays * 86_400_000);
  await rt.db
    .update(audits)
    .set({ raw: null, rawPrunedAt: now })
    .where(and(lt(audits.finishedAt, rawBefore), isNull(audits.rawPrunedAt)));

  await rt.db.transaction(async (tx) => {
    const expired = await tx
      .select({ id: fieldSources.id, companyId: fieldSources.companyId, field: fieldSources.field })
      .from(fieldSources)
      .where(
        and(
          eq(fieldSources.source, "google_places"),
          isNotNull(fieldSources.expiresAt),
          lt(fieldSources.expiresAt, now),
        ),
      );
    for (const row of expired) {
      const columns = PRUNABLE[row.field];
      if (!columns) continue; // name: provenance stays with the kept value
      const [backed] = await tx
        .select({ id: fieldSources.id })
        .from(fieldSources)
        .where(
          and(
            eq(fieldSources.companyId, row.companyId),
            eq(fieldSources.entityType, "company"),
            eq(fieldSources.field, row.field),
            sql`(${fieldSources.expiresAt} is null or ${fieldSources.expiresAt} >= ${now})`,
          ),
        )
        .limit(1);
      if (!backed) {
        await tx
          .update(companies)
          .set(Object.fromEntries(columns.map((c) => [c, null])))
          .where(eq(companies.id, row.companyId));
      }
      await tx.delete(fieldSources).where(eq(fieldSources.id, row.id));
    }
  });
}
