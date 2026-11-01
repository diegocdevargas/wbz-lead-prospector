import {
  type AuditFacts,
  type AuditStatus,
  buildFindings,
  extractHtmlChecks,
  type HtmlChecks,
  normalizeText,
  type PageSpeedResult,
  pageText,
} from "@wbz/core";
import { audits, campaignCompanies, companies, fieldSources, findings, stageEvents } from "@wbz/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { logError } from "../lib/log.ts";
import { SafeFetchError, safeFetch } from "../lib/safe-fetch.ts";
import { BudgetExhaustedError, pagespeed, placeReviewSignals } from "./google.ts";
import type { Runtime } from "./runtime.ts";

const HTML_EXCERPT_BYTES = 100_000;

/**
 * Job: audit one lead's website and store raw results plus findings.
 * Re-running is safe: each run is a new audit row; the lead page shows the latest.
 */
export async function runAudit(rt: Runtime, payload: Record<string, unknown>) {
  const companyId = String(payload.companyId);
  const [company] = await rt.db.select().from(companies).where(eq(companies.id, companyId));
  if (!company || company.stage === "opted_out") return;
  const cfg = rt.settings.config;
  const startedAt = rt.now();
  const notes: string[] = [];

  const campaignId =
    typeof payload.campaignId === "string"
      ? payload.campaignId
      : (
          await rt.db
            .select({ id: campaignCompanies.campaignId })
            .from(campaignCompanies)
            .where(eq(campaignCompanies.companyId, companyId))
            .orderBy(desc(campaignCompanies.createdAt))
            .limit(1)
        )[0]?.id;

  let reviews: AuditFacts["reviews"] = null;
  const canReadReviews = cfg.places.reviewSignals && company.placeId && campaignId && rt.settings.env.GOOGLE_API_KEY;
  // Each lookup is a paid Place Details request: only worth it when there are enough reviews to read.
  const enoughReviews = (company.googleReviewCount ?? 0) >= cfg.places.reviewSignalsMinReviews;
  if (canReadReviews && !enoughReviews) {
    notes.push(`reviews skipped: fewer than ${cfg.places.reviewSignalsMinReviews} Google reviews`);
  } else if (canReadReviews && company.placeId && campaignId) {
    try {
      reviews = await placeReviewSignals(rt, company.placeId, campaignId);
    } catch (err) {
      if (!(err instanceof BudgetExhaustedError)) logError(err, { step: "reviews", company: companyId });
      notes.push(err instanceof BudgetExhaustedError ? "reviews skipped: campaign cap reached" : "reviews failed");
    }
  }

  let status: AuditStatus = "no_website";
  let error: string | null = null;
  let html: HtmlChecks | null = null;
  let httpStatus: number | null = null;
  let excerpt: string | null = null;
  let ps: PageSpeedResult | null = null;
  let brokenLinks: AuditFacts["brokenLinks"] = null;
  let confirmName = false;
  let confirmPhone = false;

  if (company.websiteUrl) {
    const fetchOpts = {
      resolve: rt.resolve,
      fetch: rt.http,
      timeoutMs: cfg.audit.timeoutMs,
      maxBytes: cfg.audit.maxBytes,
      maxRedirects: cfg.audit.maxRedirects,
      userAgent: cfg.audit.userAgent,
    };
    try {
      const res = await safeFetch(company.websiteUrl, fetchOpts);
      httpStatus = res.status;
      if (res.status >= 400) {
        status = "unreachable";
        error = `HTTP ${res.status}`;
      } else {
        status = "ok";
        html = extractHtmlChecks(res.body, res.finalUrl, { headers: res.headers, now: rt.now() });
        excerpt = res.body.slice(0, HTML_EXCERPT_BYTES);
        if (res.truncated) notes.push("page larger than the size cap; checks ran on the first part");
        const text = normalizeText(pageText(res.body));
        confirmName = company.matchName.length >= 3 && text.includes(company.matchName);
        const phoneDigits = company.phoneE164?.replace(/\D/g, "").slice(-8);
        confirmPhone = Boolean(
          phoneDigits &&
            (html.phoneDigits.some((d) => d.endsWith(phoneDigits)) ||
              res.body.replace(/\D/g, "").includes(phoneDigits)),
        );
        brokenLinks = await checkLinks(html.internalLinks.slice(0, cfg.audit.linkSample), fetchOpts);
      }
    } catch (err) {
      if (!(err instanceof SafeFetchError)) throw err;
      status = err.kind === "blocked" ? "blocked" : "unreachable";
      error =
        err.kind === "tls" ? "certificado SSL inválido" : err.kind === "timeout" ? "não respondeu em 10s" : err.message;
    }

    if (status === "ok" && rt.settings.env.GOOGLE_API_KEY && html) {
      try {
        ps = await pagespeed(rt, html.finalUrl);
      } catch (err) {
        logError(err, { step: "pagespeed", company: companyId });
        notes.push("PageSpeed failed");
      }
    }
  }

  const facts: AuditFacts = {
    status,
    url: company.websiteUrl,
    niche: company.niche,
    error,
    html,
    pagespeed: ps,
    brokenLinks,
    reviews,
    place: company.placeId ? { rating: company.googleRating, reviewCount: company.googleReviewCount } : null,
  };
  const found = buildFindings(facts, cfg, rt.now());
  const now = rt.now();

  await rt.db.transaction(async (tx) => {
    const [audit] = await tx
      .insert(audits)
      .values({
        companyId,
        status,
        url: company.websiteUrl,
        finalUrl: html?.finalUrl ?? null,
        error,
        platform: html?.platform ?? null,
        httpStatus,
        pagespeed: ps ? { ...ps } : null,
        htmlChecks: html ? { ...html } : null,
        brokenLinks,
        reviewSignals: reviews ? { ...reviews } : null,
        raw: { htmlExcerpt: excerpt, notes },
        startedAt,
        finishedAt: now,
      })
      .returning({ id: audits.id });
    if (!audit) throw new Error("insert into audits returned nothing");
    if (found.length) {
      await tx.insert(findings).values(found.map((f) => ({ ...f, auditId: audit.id, companyId })));
    }

    // Confirmations from the business's own site: these values no longer depend on Places (no expiry).
    const confirmed: { field: string; value: string }[] = [];
    if (status === "ok" && company.websiteUrl) confirmed.push({ field: "websiteUrl", value: company.websiteUrl });
    if (confirmName) confirmed.push({ field: "name", value: company.name });
    if (confirmPhone && company.phoneE164) confirmed.push({ field: "phoneE164", value: company.phoneE164 });
    const handle = html?.instagramHandles.length === 1 ? html.instagramHandles[0] : undefined;
    if (handle && !company.instagramHandle) {
      await tx
        .update(companies)
        .set({ instagramHandle: handle })
        .where(and(eq(companies.id, companyId), isNull(companies.instagramHandle)));
      confirmed.push({ field: "instagramHandle", value: handle });
    }
    if (confirmed.length) {
      await tx.insert(fieldSources).values(
        confirmed.map((c) => ({
          companyId,
          entityType: "company" as const,
          entityId: companyId,
          field: c.field,
          value: c.value,
          source: "website_audit" as const,
          sourceRef: `audit:${audit.id}`,
          collectedAt: now,
        })),
      );
    }

    const [current] = await tx
      .select({ stage: companies.stage })
      .from(companies)
      .where(eq(companies.id, companyId))
      .for("update");
    await tx
      .update(companies)
      .set({
        platform: html?.platform ?? null,
        lastAuditedAt: now,
        ...(current?.stage === "discovered" ? { stage: "audited" as const } : {}),
      })
      .where(eq(companies.id, companyId));
    if (current?.stage === "discovered") {
      await tx.insert(stageEvents).values({
        companyId,
        fromStage: "discovered",
        toStage: "audited",
        actor: "system",
        note: `audit ${status}, ${found.length} finding(s)`,
      });
    }
  });
}

/** HEAD each link (GET if HEAD is refused); 404/410 and 5xx count as broken. Four at a time. */
async function checkLinks(urls: string[], opts: Parameters<typeof safeFetch>[1]) {
  const broken: string[] = [];
  let i = 0;
  const worker = async () => {
    while (i < urls.length) {
      const url = urls[i++] as string;
      try {
        let res = await safeFetch(url, { ...opts, method: "HEAD" });
        if (res.status === 405 || res.status === 501) res = await safeFetch(url, { ...opts, maxBytes: 1024 });
        if (res.status === 404 || res.status === 410 || res.status >= 500) broken.push(url);
      } catch (err) {
        if (err instanceof SafeFetchError && err.kind !== "blocked") broken.push(url);
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { checked: urls.length, broken: broken.sort() };
}

export async function latestAudit(db: Runtime["db"], companyId: string) {
  const [audit] = await db
    .select()
    .from(audits)
    .where(eq(audits.companyId, companyId))
    .orderBy(desc(audits.finishedAt))
    .limit(1);
  if (!audit) return null;
  const rows = await db.select().from(findings).where(eq(findings.auditId, audit.id));
  const order = { high: 0, medium: 1, low: 2 } as const;
  rows.sort((a, b) => order[a.severity] - order[b.severity]);
  return { audit, findings: rows };
}
