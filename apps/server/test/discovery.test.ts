import { hashSuppressionKey } from "@wbz/core";
import {
  apiCache,
  audits,
  campaignCompanies,
  campaigns,
  companies,
  discoveryQueries,
  fieldSources,
  findings,
  jobs,
  stageEvents,
  suppressions,
} from "@wbz/db";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createCampaign, startCampaign, updateCampaignCap } from "../src/services/discovery.ts";
import { runPrune } from "../src/services/prune.ts";
import { drain, googleAndSites, makeRuntime } from "./fakes.ts";
import { SECRET, useTestDb } from "./helpers.ts";

const db = useTestDb();

const newCampaign = (cap = 100, cities = ["Chapecó"]) =>
  createCampaign(db, {
    name: "Dentistas",
    niche: "clínica odontológica",
    queryTemplate: "{niche} em {city}",
    cities,
    placesRequestCap: cap,
  });

async function run(cap = 100, cities = ["Chapecó"]) {
  const { http, calls } = googleAndSites();
  const { rt, queue } = makeRuntime(db, http);
  const id = await newCampaign(cap, cities);
  await startCampaign(rt, id);
  await drain(rt, queue);
  return { id, rt, queue, calls };
}

describe("discovery (Google Places)", () => {
  it("imports places through dedupe, queues audits, and follows the next page", async () => {
    const { id, calls } = await run();
    const rows = await db.select().from(companies).orderBy(companies.name);
    // 5 places: one is closed (skipped). Page 2 has the 5th.
    expect(rows.map((r) => r.name)).toEqual([
      "Clínica Optout Teste",
      "Clínica Sorriso Teste",
      "Dental Shopify Teste",
      "Odonto Sem Site Teste",
    ]);
    const sorriso = rows.find((r) => r.name === "Clínica Sorriso Teste");
    expect(sorriso).toMatchObject({
      source: "google_places",
      placeId: "ChIJtest0001",
      city: "Chapecó",
      state: "SC",
      phoneE164: "+554933220001",
      domain: "sorriso.test",
      googleRating: 4.6,
      googleReviewCount: 87,
      niche: "clínica odontológica",
    });

    const searches = calls.filter((c) => c.url.includes(":searchText"));
    expect(searches).toHaveLength(2);
    expect(searches[0]?.headers["x-goog-fieldmask"]).toContain("places.websiteUri");
    expect(JSON.parse(searches[0]?.body ?? "{}")).toMatchObject({
      textQuery: "clínica odontológica em Chapecó",
      languageCode: "pt-BR",
    });
    expect(JSON.parse(searches[1]?.body ?? "{}").pageToken).toBe("page-2-token");

    const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    // 2 Text Search pages + 4 Place Details (review signals, one per audited lead)
    expect(c?.placesRequestsUsed).toBe(2 + 4);
    expect(c?.status).toBe("done");
    expect(await db.select().from(campaignCompanies)).toHaveLength(4);
    expect((await db.select().from(discoveryQueries)).map((q) => [q.page, q.status, q.resultCount])).toEqual([
      [1, "done", 4],
      [2, "done", 1],
    ]);
  });

  it("marks Places-sourced values with the 30-day expiry, but not place_id, city or niche", async () => {
    await run();
    const [sorriso] = await db.select().from(companies).where(eq(companies.placeId, "ChIJtest0001"));
    const src = await db
      .select()
      .from(fieldSources)
      .where(eq(fieldSources.companyId, sorriso?.id as string));
    const places = src.filter((s) => s.source === "google_places");
    const expiring = new Set(places.filter((s) => s.expiresAt).map((s) => s.field));
    expect(expiring).toEqual(
      new Set(["name", "phoneE164", "websiteUrl", "address", "mapsUrl", "googleRating", "googleReviewCount"]),
    );
    expect(places.find((s) => s.field === "city")?.expiresAt).toBeNull();
    expect(places.every((s) => s.sourceRef === "place:ChIJtest0001")).toBe(true);
  });

  it("never stores a place that is on the opt-out list", async () => {
    await db.insert(suppressions).values({
      kind: "domain",
      valueHash: await hashSuppressionKey({ kind: "domain", value: "optout.test" }, SECRET),
      reason: "asked",
    });
    await run();
    const names = (await db.select().from(companies)).map((r) => r.name);
    expect(names).not.toContain("Clínica Optout Teste");
    expect(await db.select().from(companies).where(eq(companies.placeId, "ChIJtest0005"))).toHaveLength(0);
  });

  it("re-running a campaign bills nothing twice and creates no duplicates", async () => {
    const { id, rt, queue, calls } = await run();
    const before = calls.length;
    await startCampaign(rt, id);
    await drain(rt, queue);
    expect(calls.length).toBe(before);
    expect(await db.select().from(companies)).toHaveLength(4);

    // A second campaign with the same query hits the cache, and known place_ids only refresh.
    const other = await newCampaign();
    await startCampaign(rt, other);
    await drain(rt, queue);
    expect(calls.filter((c) => c.url.includes(":searchText"))).toHaveLength(2);
    expect(await db.select().from(companies)).toHaveLength(4);
    const [c2] = await db.select().from(campaigns).where(eq(campaigns.id, other));
    expect(c2?.placesRequestsUsed).toBe(0);
    expect(await db.select().from(campaignCompanies).where(eq(campaignCompanies.campaignId, other))).toHaveLength(4);
  });

  it("stops at the budget cap before calling Google, and resumes when the cap is raised", async () => {
    const { id, rt, queue, calls } = await run(1, ["Chapecó", "Erechim"]);
    // Cap 1: only one Text Search ran; the other city and the next page were skipped, and no Place Details were bought.
    expect(calls.filter((c) => c.url.includes("places.googleapis.com"))).toHaveLength(1);
    const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    expect(c).toMatchObject({ placesRequestsUsed: 1, status: "stopped_budget" });
    expect((await db.select().from(discoveryQueries)).filter((q) => q.status === "skipped_budget")).toHaveLength(2);
    expect((await db.select().from(jobs)).filter((j) => j.status === "dead")).toHaveLength(0);

    expect(await updateCampaignCap(rt, id, 1)).toBe(true); // same cap: nothing to resume
    expect(queue.take()).toHaveLength(0);
    expect(await updateCampaignCap(rt, id, 50)).toBe(true);
    await drain(rt, queue);
    expect((await db.select().from(discoveryQueries)).every((q) => q.status === "done")).toBe(true);
    expect(await updateCampaignCap(rt, id, 1)).toBe(false); // below what was used
  });
});

describe("website audit", () => {
  it("stores raw results and Portuguese findings, and moves the lead to audited", async () => {
    const { calls } = await run();
    const [sorriso] = await db.select().from(companies).where(eq(companies.placeId, "ChIJtest0001"));
    expect(sorriso).toMatchObject({ stage: "audited", platform: "wordpress", instagramHandle: "sorrisoteste" });
    const [audit] = await db
      .select()
      .from(audits)
      .where(eq(audits.companyId, sorriso?.id as string));
    expect(audit).toMatchObject({
      status: "ok",
      platform: "wordpress",
      brokenLinks: { checked: 3, broken: ["https://sorriso.test/pagina-quebrada"] },
    });
    expect(audit?.pagespeed).toEqual({ score: 23, lcpMs: 9200, cls: 0.31, inpMs: 620 });
    expect(audit?.reviewSignals).toEqual({ reviewed: 3, counts: { slow_reply: 1, whatsapp: 0, phone: 1, booking: 1 } });

    const texts = (
      await db
        .select()
        .from(findings)
        .where(eq(findings.companyId, sorriso?.id as string))
    ).map((f) => f.text);
    expect(texts).toContain("Site leva 9,2s para carregar no celular (PageSpeed 23/100).");
    expect(texts).toContain("1 de 3 avaliações recentes no Google reclamam de dificuldade para agendar.");
    expect(texts).toContain("O rodapé ainda mostra © 2019, sinal de site sem manutenção.");
    expect(texts).toContain("1 de 3 links internos testados estão quebrados (ex.: /pagina-quebrada).");
    expect(texts).toContain("O site não é adaptado para celular (falta a meta tag viewport).");

    // Only the audit's own site links are fetched, never the external "Parceiro" link.
    expect(calls.some((c) => c.url.startsWith("https://outro-site.test"))).toBe(false);

    const [event] = await db.select().from(stageEvents).where(eq(stageEvents.toStage, "audited")).limit(1);
    expect(event).toMatchObject({ fromStage: "discovered", actor: "system" });
  });

  it("does not keep review text or reviewer names anywhere", async () => {
    await run();
    const dump = JSON.stringify([
      await db.select().from(audits),
      await db.select().from(apiCache),
      await db.select().from(findings),
    ]);
    expect(dump).not.toContain("Nome Que Nao Pode Ser Guardado");
    expect(dump).not.toContain("demoram para responder");
  });

  it("confirms name, phone and website from the site itself", async () => {
    await run();
    const [sorriso] = await db.select().from(companies).where(eq(companies.placeId, "ChIJtest0001"));
    const confirmed = (
      await db
        .select()
        .from(fieldSources)
        .where(eq(fieldSources.companyId, sorriso?.id as string))
    )
      .filter((s) => s.source === "website_audit")
      .map((s) => s.field)
      .sort();
    expect(confirmed).toEqual(["instagramHandle", "name", "phoneE164", "websiteUrl"]);
  });

  it("detects Shopify and treats it as an e-commerce lead", async () => {
    await run();
    const [shop] = await db.select().from(companies).where(eq(companies.placeId, "ChIJtest0003"));
    expect(shop?.platform).toBe("shopify");
    const f = await db
      .select()
      .from(findings)
      .where(eq(findings.companyId, shop?.id as string));
    expect(f.find((x) => x.code === "ecommerce_platform")).toMatchObject({
      offer: "ecommerce",
      text: "Loja virtual em Shopify.",
    });
  });

  it("no website is a finding, not an error", async () => {
    await run();
    const [noSite] = await db.select().from(companies).where(eq(companies.placeId, "ChIJtest0002"));
    const [audit] = await db
      .select()
      .from(audits)
      .where(eq(audits.companyId, noSite?.id as string));
    expect(audit?.status).toBe("no_website");
    const [f] = await db
      .select()
      .from(findings)
      .where(and(eq(findings.companyId, noSite?.id as string), eq(findings.code, "no_website")));
    expect(f?.text).toBe("Não tem site próprio: no Google aparece sem site (nota 4,6 com 87 avaliações).");
  });
});

describe("LGPD delete", () => {
  it("also removes cached Places responses that mention the business", async () => {
    await run();
    const [sorriso] = await db.select().from(companies).where(eq(companies.placeId, "ChIJtest0001"));
    const { deleteLead } = await import("../src/services/leads.ts");
    await deleteLead(db, sorriso?.id as string, { suppress: false, secret: SECRET });
    expect(JSON.stringify(await db.select().from(apiCache))).not.toContain("ChIJtest0001");
  });
});

describe("retention (prune job)", () => {
  it("clears expired Places values unless another source backs them", async () => {
    const { rt } = await run();
    const later = new Date(Date.now() + 31 * 86_400_000);
    await runPrune({ ...rt, now: () => later });

    const [sorriso] = await db.select().from(companies).where(eq(companies.placeId, "ChIJtest0001"));
    // Confirmed on its own site: phone and website stay. Rating, review count, address and Maps URL go.
    expect(sorriso).toMatchObject({
      phoneE164: "+554933220001",
      websiteUrl: "https://sorriso.test/",
      googleRating: null,
      googleReviewCount: null,
      address: null,
      mapsUrl: null,
    });
    expect(sorriso?.placeId).toBe("ChIJtest0001");

    const [noSite] = await db.select().from(companies).where(eq(companies.placeId, "ChIJtest0002"));
    // Phone came only from Places: cleared. Name is kept as the lead's identifier.
    expect(noSite).toMatchObject({ phoneE164: null, name: "Odonto Sem Site Teste" });
    expect(await db.select().from(apiCache)).toHaveLength(0);
    const left = await db.select().from(fieldSources).where(eq(fieldSources.source, "google_places"));
    expect(left.filter((s) => s.expiresAt && s.field !== "name")).toHaveLength(0);
  });

  it("deletes old raw HTML excerpts", async () => {
    const { rt } = await run();
    await runPrune({ ...rt, now: () => new Date(Date.now() + 91 * 86_400_000) });
    const rows = await db.select().from(audits);
    expect(rows.every((a) => a.raw === null && a.rawPrunedAt)).toBe(true);
    expect(rows.some((a) => a.htmlChecks)).toBe(true); // structured results stay
  });
});
