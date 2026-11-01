import { buildQuery, placeToRow } from "@wbz/core";
import {
  campaignCompanies,
  campaigns,
  companies,
  type Db,
  discoveryQueries,
  fieldSources,
  jobs,
  type Tx,
} from "@wbz/db";
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { BudgetExhaustedError, placesTextSearch } from "./google.ts";
import { runImport } from "./import.ts";
import { dispatch, enqueue } from "./jobs.ts";
import type { Runtime } from "./runtime.ts";

/** Places fields whose stored values expire under Google's terms (place_id, city, state and niche do not). */
const EXPIRING_FIELDS = ["name", "phoneE164", "websiteUrl"] as const;

export interface NewCampaign {
  name: string;
  niche: string;
  queryTemplate: string;
  cities: string[];
  placesRequestCap: number;
}

export async function createCampaign(db: Db, input: NewCampaign) {
  const [row] = await db.insert(campaigns).values(input).returning({ id: campaigns.id });
  if (!row) throw new Error("insert into campaigns returned nothing");
  return row.id;
}

/**
 * Queue page 1 for every city that has not been queried yet. Re-running a
 * campaign is safe: existing pages are skipped by their unique key, so a
 * page is never billed twice.
 */
export async function startCampaign(rt: Runtime, campaignId: string) {
  const ids = await rt.db.transaction(async (tx) => {
    const [c] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId)).for("update");
    if (!c) return null;
    const out: (string | null)[] = [];
    for (const city of c.cities) {
      const [dq] = await tx
        .insert(discoveryQueries)
        .values({ campaignId, city, page: 1, query: buildQuery(c.queryTemplate, c.niche, city) })
        .onConflictDoNothing()
        .returning({ id: discoveryQueries.id });
      if (!dq) continue;
      const job = await enqueue(tx, null, {
        kind: "discover_query",
        key: `discover:${dq.id}`,
        payload: { queryId: dq.id },
        maxAttempts: rt.settings.config.jobs.maxAttempts,
      });
      out.push(job.id);
    }
    if (c.placesRequestsUsed < c.placesRequestCap) {
      await tx.update(campaigns).set({ status: "running" }).where(eq(campaigns.id, campaignId));
    }
    return out;
  });
  if (ids === null) return false;
  await dispatch(rt.queue, ids, { urgent: true });
  await refreshCampaignStatus(rt.db, campaignId);
  return true;
}

/** Job: run one Text Search page, import its places, queue their audits and the next page. */
export async function runDiscoveryQuery(rt: Runtime, payload: Record<string, unknown>) {
  const queryId = String(payload.queryId);
  const [dq] = await rt.db.select().from(discoveryQueries).where(eq(discoveryQueries.id, queryId));
  if (!dq || dq.status === "done" || dq.status === "skipped_budget") return;
  const [campaign] = await rt.db.select().from(campaigns).where(eq(campaigns.id, dq.campaignId));
  if (!campaign) return;

  let data: Awaited<ReturnType<typeof placesTextSearch>>["data"];
  try {
    ({ data } = await placesTextSearch(rt, { query: dq.query, pageToken: dq.pageToken, campaignId: campaign.id }));
  } catch (err) {
    if (err instanceof BudgetExhaustedError) {
      await rt.db.update(discoveryQueries).set({ status: "skipped_budget" }).where(eq(discoveryQueries.id, dq.id));
      await rt.db.update(campaigns).set({ status: "stopped_budget" }).where(eq(campaigns.id, campaign.id));
      return; // Not a failure: the cap did its job. The Campaigns screen shows it.
    }
    throw err;
  }

  const now = rt.now();
  const expiresAt = new Date(now.getTime() + rt.settings.config.places.contentTtlDays * 86_400_000);
  const mapped = data.places.flatMap((p) => {
    const m = placeToRow(p, campaign.niche);
    return m ? [m] : [];
  });

  const queued = await rt.db.transaction(async (tx) => {
    // Places we already have (by place_id) only get their Places values refreshed.
    const known = mapped.length
      ? await tx
          .select({ id: companies.id, placeId: companies.placeId, stage: companies.stage })
          .from(companies)
          .where(
            inArray(
              companies.placeId,
              mapped.map((m) => m.extras.placeId),
            ),
          )
      : [];
    const knownIds = new Map(known.map((k) => [k.placeId, k.stage === "opted_out" ? null : k.id]));
    const fresh = mapped.filter((m) => !knownIds.has(m.extras.placeId));
    const touched: string[] = [];

    for (const m of mapped) {
      const id = knownIds.get(m.extras.placeId);
      if (id) {
        await applyPlaceExtras(tx, id, m.extras, now, expiresAt);
        touched.push(id);
      }
    }

    let importId: string | null = null;
    let created = 0;
    let merged = known.filter((k) => k.stage !== "opted_out").length;
    if (fresh.length) {
      const report = await runImport(
        tx as unknown as Db,
        { config: rt.settings.config, suppressionSecret: rt.settings.env.SUPPRESSION_SECRET },
        {
          source: "google_places",
          filename: `${dq.query} (p${dq.page})`.slice(0, 200),
          content: JSON.stringify(fresh.map((m) => m.extras.placeId)),
          rows: fresh.map((m) => m.row),
          sourceRefs: fresh.map((m) => `place:${m.extras.placeId}`),
          expiry: { fields: EXPIRING_FIELDS, expiresAt },
          afterRow: async (rowTx, index, row) => {
            const extras = fresh[index]?.extras;
            if (!extras || !row.companyId) return;
            await applyPlaceExtras(rowTx, row.companyId, extras, now, expiresAt);
            touched.push(row.companyId);
          },
        },
        { dryRun: false },
      );
      importId = report.importId;
      created = report.counts.created + report.counts.review;
      merged += report.counts.merged;
    }

    if (touched.length) {
      await tx
        .insert(campaignCompanies)
        .values([...new Set(touched)].map((companyId) => ({ campaignId: campaign.id, companyId })))
        .onConflictDoNothing();
    }

    await tx
      .update(discoveryQueries)
      .set({ status: "done", resultCount: data.places.length, created, merged, importId })
      .where(eq(discoveryQueries.id, dq.id));

    let nextPage: string | null = null;
    const audits: (string | null)[] = [];
    if (data.nextPageToken && dq.page < rt.settings.config.places.maxPagesPerQuery) {
      const [next] = await tx
        .insert(discoveryQueries)
        .values({
          campaignId: campaign.id,
          city: dq.city,
          query: dq.query,
          page: dq.page + 1,
          pageToken: data.nextPageToken,
        })
        .onConflictDoNothing()
        .returning({ id: discoveryQueries.id });
      if (next) {
        const job = await enqueue(tx, null, {
          kind: "discover_query",
          key: `discover:${next.id}`,
          payload: { queryId: next.id },
          maxAttempts: rt.settings.config.jobs.maxAttempts,
        });
        nextPage = job.id;
      }
    }
    // First audit of each lead, once. Re-audits are queued from the lead page with their own key.
    for (const companyId of new Set(touched)) {
      const job = await enqueue(tx, null, {
        kind: "audit_lead",
        key: `audit:${companyId}:initial`,
        payload: { companyId, campaignId: campaign.id },
        maxAttempts: rt.settings.config.jobs.maxAttempts,
      });
      audits.push(job.id);
    }
    return { nextPage, audits };
  });

  // The next page jumps ahead of the audits, so discovery finishes first and audits follow.
  await dispatch(rt.queue, [queued.nextPage], { urgent: true });
  await dispatch(rt.queue, queued.audits);
  await refreshCampaignStatus(rt.db, campaign.id);
}

/** Attach Places-only values. place_id is set only if the company has none (a merge target may already hold another). */
async function applyPlaceExtras(
  tx: Tx,
  companyId: string,
  extras: NonNullable<ReturnType<typeof placeToRow>>["extras"],
  now: Date,
  expiresAt: Date,
) {
  await tx
    .update(companies)
    .set({ placeId: extras.placeId })
    .where(
      and(
        eq(companies.id, companyId),
        isNull(companies.placeId),
        sql`not exists (select 1 from companies c2 where c2.place_id = ${extras.placeId})`,
      ),
    );
  await tx
    .update(companies)
    .set({
      address: extras.address,
      mapsUrl: extras.mapsUrl,
      googleRating: extras.rating,
      googleReviewCount: extras.reviewCount,
      placesFetchedAt: now,
    })
    .where(eq(companies.id, companyId));
  const values = {
    address: extras.address,
    mapsUrl: extras.mapsUrl,
    googleRating: extras.rating?.toString() ?? null,
    googleReviewCount: extras.reviewCount?.toString() ?? null,
  };
  const rows = Object.entries(values).flatMap(([field, value]) =>
    value
      ? [
          {
            companyId,
            entityType: "company" as const,
            entityId: companyId,
            field,
            value,
            source: "google_places" as const,
            sourceRef: `place:${extras.placeId}`,
            collectedAt: now,
            expiresAt,
          },
        ]
      : [],
  );
  if (rows.length) await tx.insert(fieldSources).values(rows);
}

/** running → done when no page is pending; stays stopped_budget if the cap stopped it. */
export async function refreshCampaignStatus(db: Db, campaignId: string) {
  await db
    .update(campaigns)
    .set({ status: "done" })
    .where(
      and(
        eq(campaigns.id, campaignId),
        eq(campaigns.status, "running"),
        sql`not exists (select 1 from ${discoveryQueries} where ${discoveryQueries.campaignId} = ${campaignId} and ${discoveryQueries.status} = 'pending')`,
        sql`exists (select 1 from ${discoveryQueries} where ${discoveryQueries.campaignId} = ${campaignId})`,
      ),
    );
}

export async function listCampaigns(db: Db) {
  return db
    .select({
      campaign: campaigns,
      leads: sql<number>`(select count(*)::int from ${campaignCompanies} cc where cc.campaign_id = ${campaigns.id})`,
      audited: sql<number>`(select count(*)::int from ${campaignCompanies} cc join ${companies} co on co.id = cc.company_id where cc.campaign_id = ${campaigns.id} and co.last_audited_at is not null)`,
    })
    .from(campaigns)
    .orderBy(sql`${campaigns.createdAt} desc`)
    .limit(200);
}

export async function getCampaign(db: Db, id: string) {
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!c) return null;
  const queries = await db
    .select()
    .from(discoveryQueries)
    .where(eq(discoveryQueries.campaignId, id))
    .orderBy(discoveryQueries.city, discoveryQueries.page);
  const [stats] = await db
    .select({
      leads: sql<number>`count(*)::int`,
      audited: sql<number>`count(${companies.lastAuditedAt})::int`,
      withSite: sql<number>`count(${companies.websiteUrl})::int`,
    })
    .from(campaignCompanies)
    .innerJoin(companies, eq(companies.id, campaignCompanies.companyId))
    .where(eq(campaignCompanies.campaignId, id));
  const platforms = await db
    .select({ platform: companies.platform, n: sql<number>`count(*)::int` })
    .from(campaignCompanies)
    .innerJoin(companies, eq(companies.id, campaignCompanies.companyId))
    .where(and(eq(campaignCompanies.campaignId, id), notInArray(companies.stage, ["opted_out"])))
    .groupBy(companies.platform);
  return { campaign: c, queries, stats: stats ?? { leads: 0, audited: 0, withSite: 0 }, platforms };
}

/**
 * Change the request cap (never below what was used). If the cap had stopped
 * the campaign and there is room again, the skipped pages run again.
 */
export async function updateCampaignCap(rt: Runtime, campaignId: string, cap: number): Promise<boolean> {
  const ids = await rt.db.transaction(async (tx) => {
    const [row] = await tx
      .update(campaigns)
      .set({
        placesRequestCap: cap,
        status: sql`case when ${campaigns.status} = 'stopped_budget' and ${campaigns.placesRequestsUsed} < ${cap} then 'running'::campaign_status else ${campaigns.status} end`,
      })
      .where(and(eq(campaigns.id, campaignId), sql`${campaigns.placesRequestsUsed} <= ${cap}`))
      .returning({ status: campaigns.status });
    if (!row) return null;
    if (row.status !== "running") return [];
    const skipped = await tx
      .update(discoveryQueries)
      .set({ status: "pending" })
      .where(and(eq(discoveryQueries.campaignId, campaignId), eq(discoveryQueries.status, "skipped_budget")))
      .returning({ id: discoveryQueries.id });
    if (!skipped.length) return [];
    const keys = skipped.map((q) => `discover:${q.id}`);
    return (
      await tx
        .update(jobs)
        .set({ status: "pending", runAfter: rt.now() })
        .where(inArray(jobs.idempotencyKey, keys))
        .returning({ id: jobs.id })
    ).map((j) => j.id);
  });
  if (ids === null) return false;
  await dispatch(rt.queue, ids, { urgent: true });
  return true;
}
