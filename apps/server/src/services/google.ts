import {
  countPainPhrases,
  type PageSpeedResult,
  PLACE_REVIEWS_FIELD_MASK,
  PLACES_FIELD_MASK,
  PLACES_TEXT_SEARCH_URL,
  placeDetailsUrl,
  placeReviewsSchema,
  type TextSearchResponse,
  textSearchResponseSchema,
} from "@wbz/core";
import { apiCache, campaigns, type DbOrTx, discoveryQueries } from "@wbz/db";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { sha256Hex } from "../lib/hash.ts";
import type { Runtime } from "./runtime.ts";

type Provider = (typeof apiCache.provider.enumValues)[number];

export class ApiError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class BudgetExhaustedError extends Error {
  constructor(readonly campaignId: string) {
    super("campaign Places request cap reached");
    this.name = "BudgetExhaustedError";
  }
}

async function cacheGet(db: DbOrTx, provider: Provider, key: string, now: Date) {
  const keyHash = await sha256Hex(key);
  const [hit] = await db
    .select({ response: apiCache.response })
    .from(apiCache)
    .where(and(eq(apiCache.provider, provider), eq(apiCache.keyHash, keyHash), gt(apiCache.expiresAt, now)));
  return hit?.response ?? null;
}

async function cachePut(db: DbOrTx, provider: Provider, key: string, response: unknown, ttlDays: number, now: Date) {
  const keyHash = await sha256Hex(key);
  const expiresAt = new Date(now.getTime() + ttlDays * 86_400_000);
  await db
    .insert(apiCache)
    .values({ provider, keyHash, response, fetchedAt: now, expiresAt })
    .onConflictDoUpdate({
      target: [apiCache.provider, apiCache.keyHash],
      set: { response, fetchedAt: now, expiresAt },
    });
}

export async function pruneCache(db: DbOrTx, now: Date) {
  await db.delete(apiCache).where(lt(apiCache.expiresAt, now));
}

/**
 * Reserve one Places request against the campaign cap BEFORE calling Google.
 * A single conditional UPDATE, so concurrent jobs cannot overshoot the cap.
 */
export async function chargePlacesRequest(
  db: DbOrTx,
  campaignId: string,
  costUsd: number,
  /** Requests to leave untouched for other work (search pages). The charge fails if it would eat into them. */
  reserve = 0,
): Promise<void> {
  const [row] = await db
    .update(campaigns)
    .set({
      placesRequestsUsed: sql`${campaigns.placesRequestsUsed} + 1`,
      estCostUsd: sql`${campaigns.estCostUsd} + ${costUsd}`,
    })
    .where(
      and(
        eq(campaigns.id, campaignId),
        lt(sql`${campaigns.placesRequestsUsed} + ${reserve}::int`, campaigns.placesRequestCap),
      ),
    )
    .returning({ id: campaigns.id });
  if (!row) throw new BudgetExhaustedError(campaignId);
}

/**
 * Search pages the campaign may still need: every pending or budget-skipped
 * page plus the pages after it, and every city not queried yet. Place Details
 * (reviews) may only spend what is left above this, so finding businesses
 * always comes before reading their reviews. Slightly generous on purpose:
 * a page with no next page simply leaves the reserve unused.
 */
export async function discoveryReserve(db: DbOrTx, campaignId: string, maxPages: number): Promise<number> {
  const [c] = await db.select({ cities: campaigns.cities }).from(campaigns).where(eq(campaigns.id, campaignId));
  if (!c) return 0;
  const rows = await db
    .select({ city: discoveryQueries.city, page: discoveryQueries.page, status: discoveryQueries.status })
    .from(discoveryQueries)
    .where(eq(discoveryQueries.campaignId, campaignId));
  const started = new Set(rows.map((r) => r.city));
  const open = rows
    .filter((r) => r.status === "pending" || r.status === "skipped_budget")
    .reduce((n, r) => n + Math.max(1, maxPages - r.page + 1), 0);
  return open + c.cities.filter((city) => !started.has(city)).length * maxPages;
}

function requireKey(rt: Runtime): string {
  const key = rt.settings.env.GOOGLE_API_KEY;
  if (!key) throw new ApiError("google", 0, "GOOGLE_API_KEY is not set");
  return key;
}

async function googleJson(rt: Runtime, provider: string, url: string, init: RequestInit, timeoutMs: number) {
  const res = await rt.http(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    // Google error bodies can echo the request; keep only the status.
    await res.body?.cancel().catch(() => {});
    throw new ApiError(provider, res.status, `${provider} returned HTTP ${res.status}`);
  }
  return res.json();
}

/** Places Text Search (New), one page. Cached for the Places content TTL; a cache hit costs nothing. */
export async function placesTextSearch(
  rt: Runtime,
  input: { query: string; pageToken: string | null; campaignId: string },
): Promise<{ data: TextSearchResponse; cached: boolean }> {
  const cfg = rt.settings.config.places;
  const cacheKey = JSON.stringify([input.query, input.pageToken, cfg.languageCode, cfg.regionCode]);
  const hit = await cacheGet(rt.db, "places_text_search", cacheKey, rt.now());
  if (hit) return { data: textSearchResponseSchema.parse(hit), cached: true };

  const key = requireKey(rt);
  await chargePlacesRequest(rt.db, input.campaignId, cfg.textSearchCostUsd);
  await rt.placesLimiter.take();
  const json = await googleJson(
    rt,
    "places",
    PLACES_TEXT_SEARCH_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": PLACES_FIELD_MASK },
      body: JSON.stringify({
        textQuery: input.query,
        languageCode: cfg.languageCode,
        regionCode: cfg.regionCode,
        pageSize: 20,
        ...(input.pageToken ? { pageToken: input.pageToken } : {}),
      }),
    },
    15_000,
  );
  const data = textSearchResponseSchema.parse(json);
  await cachePut(rt.db, "places_text_search", cacheKey, data, cfg.contentTtlDays, rt.now());
  return { data, cached: false };
}

/**
 * Pain-phrase counts over a place's (up to 5) Google reviews, via Place Details.
 * Review text is counted in memory and discarded; only the counts are cached
 * or stored. Reviewer names are never requested.
 */
export async function placeReviewSignals(rt: Runtime, placeId: string, campaignId: string) {
  const cfg = rt.settings.config.places;
  const hit = await cacheGet(rt.db, "places_details", placeId, rt.now());
  if (hit) return hit as ReturnType<typeof countPainPhrases>;
  const key = requireKey(rt);
  const reserve = await discoveryReserve(rt.db, campaignId, cfg.maxPagesPerQuery);
  await chargePlacesRequest(rt.db, campaignId, cfg.placeDetailsCostUsd, reserve);
  await rt.placesLimiter.take();
  const url = `${placeDetailsUrl(placeId)}?languageCode=${encodeURIComponent(cfg.languageCode)}`;
  const json = await googleJson(
    rt,
    "places",
    url,
    { headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": PLACE_REVIEWS_FIELD_MASK } },
    15_000,
  );
  const texts = placeReviewsSchema
    .parse(json)
    .reviews.map((r) => r.text?.text ?? "")
    .filter(Boolean);
  const signals = countPainPhrases(texts);
  await cachePut(rt.db, "places_details", placeId, signals, cfg.contentTtlDays, rt.now());
  return signals;
}

const metric = z.object({ numericValue: z.number().optional() }).optional();
const pagespeedSchema = z.object({
  lighthouseResult: z
    .object({
      categories: z
        .object({ performance: z.object({ score: z.number().nullable().optional() }).optional() })
        .optional(),
      audits: z
        .object({
          "largest-contentful-paint": metric,
          "cumulative-layout-shift": metric,
          "interaction-to-next-paint": metric,
        })
        .partial()
        .optional(),
    })
    .optional(),
  loadingExperience: z
    .object({
      metrics: z
        .object({ INTERACTION_TO_NEXT_PAINT: z.object({ percentile: z.number() }).optional() })
        .partial()
        .optional(),
    })
    .optional(),
});

/** PageSpeed Insights, mobile, performance only. Only the four numbers are kept (the raw report is megabytes). */
export async function pagespeed(rt: Runtime, url: string): Promise<PageSpeedResult> {
  const cfg = rt.settings.config.audit;
  const hit = await cacheGet(rt.db, "pagespeed", url, rt.now());
  if (hit) return hit as PageSpeedResult;
  const key = requireKey(rt);
  const api = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  api.searchParams.set("url", url);
  api.searchParams.set("strategy", "mobile");
  api.searchParams.set("category", "performance");
  api.searchParams.set("key", key);
  const json = pagespeedSchema.parse(await googleJson(rt, "pagespeed", api.toString(), {}, cfg.pagespeedTimeoutMs));
  const lh = json.lighthouseResult;
  const score = lh?.categories?.performance?.score;
  const result: PageSpeedResult = {
    score: score == null ? null : Math.round(score * 100),
    lcpMs: lh?.audits?.["largest-contentful-paint"]?.numericValue ?? null,
    cls: lh?.audits?.["cumulative-layout-shift"]?.numericValue ?? null,
    // INP only exists as field data (real Chrome users); lab runs have no interactions.
    inpMs: json.loadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
  };
  await cachePut(rt.db, "pagespeed", url, result, cfg.pagespeedCacheDays, rt.now());
  return result;
}
