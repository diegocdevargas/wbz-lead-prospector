import { campaigns, companies, jobs } from "@wbz/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.tsx";
import { loadSettings } from "../src/lib/env.ts";
import { ManualQueue } from "../src/services/runtime.ts";
import { drain, fakeResolver, googleAndSites, makeRuntime } from "./fakes.ts";
import { SECRET, TEST_DB_URL, useTestDb } from "./helpers.ts";

const db = useTestDb();
const ORIGIN = "http://localhost";
const GOOGLE_KEY = "test-google-key-0123456789";

function makeApp(extra: Record<string, string> = { GOOGLE_API_KEY: GOOGLE_KEY }) {
  const settings = loadSettings({
    DATABASE_URL: TEST_DB_URL,
    SUPPRESSION_SECRET: SECRET,
    ENVIRONMENT: "development",
    AUTH_MODE: "basic",
    BASIC_AUTH_USER: "diego",
    BASIC_AUTH_PASSWORD: "correct-horse-battery",
    ...extra,
  });
  const queue = new ManualQueue();
  const { http } = googleAndSites();
  const app = createApp(settings, async () => ({ db, settings, queue }), { http, resolve: fakeResolver });
  return { app, queue, http };
}

const { app, queue, http } = makeApp();
const auth = { Authorization: `Basic ${btoa("diego:correct-horse-battery")}` };
const get = (path: string) => app.request(`${ORIGIN}${path}`, { headers: auth });
const post = (path: string, body: Record<string, string>) =>
  app.request(`${ORIGIN}${path}`, {
    method: "POST",
    body: new URLSearchParams(body),
    headers: { ...auth, Origin: ORIGIN },
  });

const CAMPAIGN = {
  name: "Piloto dentistas",
  niche: "clínica odontológica",
  queryTemplate: "",
  cities: "Chapecó, SC\nErechim, RS\nSarandi, RS\nChapecó, SC",
  placesRequestCap: "100",
};

describe("M2 screens", () => {
  it.each(["/campaigns", "/campaigns/new", "/jobs", "/settings", "/assets/app.js"])(
    "%s requires auth",
    async (path) => {
      expect((await app.request(`${ORIGIN}${path}`)).status).toBe(401);
    },
  );

  it("serves app.js as an external script allowed by the CSP", async () => {
    const res = await get("/assets/app.js");
    expect(res.headers.get("content-type")).toContain("javascript");
    const page = await get("/campaigns");
    const csp = page.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(await page.text()).toContain('<script src="/assets/app.js" defer');
  });

  it("creates a campaign with de-duplicated cities and validates input", async () => {
    const bad = await post("/campaigns", { ...CAMPAIGN, cities: "", queryTemplate: "{niche}" });
    expect(bad.status).toBe(422);
    const res = await post("/campaigns", CAMPAIGN);
    expect(res.status).toBe(303);
    const [c] = await db.select().from(campaigns);
    expect(c).toMatchObject({
      cities: ["Chapecó, SC", "Erechim, RS", "Sarandi, RS"],
      queryTemplate: "{niche} em {city}",
      placesRequestCap: 100,
    });
    const page = await (await get(res.headers.get("location") as string)).text();
    expect(page).toContain("Campaign created");
  });

  it("runs discovery from the dashboard and shows leads, audit tab and jobs", async () => {
    const created = await post("/campaigns", { ...CAMPAIGN, cities: "Chapecó" });
    const id = (created.headers.get("location") as string).split("/")[2]?.split("?")[0] as string;
    expect((await post(`/campaigns/${id}/run`, {})).status).toBe(303);
    const running = await (await get(`/campaigns/${id}`)).text();
    expect(running).toMatch(/<button type="submit" disabled="" title="Discovery is still running">Running…<\/button>/);
    const { rt } = makeRuntime(db, http);
    await drain({ ...rt, queue }, queue);

    const campaignHtml = await (await get(`/campaigns/${id}`)).text();
    expect(campaignHtml).toContain("done");
    const list = await (await get(`/leads?campaign=${id}&website=no`)).text();
    expect(list).toContain("Odonto Sem Site Teste");
    expect(list).not.toContain("Clínica Sorriso Teste");
    const shopify = await (await get("/leads?platform=shopify")).text();
    expect(shopify).toContain("Dental Shopify Teste");

    const [lead] = await db.select().from(companies).where(eq(companies.placeId, "ChIJtest0001"));
    const tab = await (await get(`/leads/${lead?.id}?tab=audit`)).text();
    expect(tab).toContain("Site leva 9,2s para carregar no celular (PageSpeed 23/100).");
    expect(tab).toContain("wordpress");

    const jobsHtml = await (await get("/jobs?status=succeeded")).text();
    expect(jobsHtml).toContain("audit_lead");
  });

  it("re-run audit queues one job and refuses opted-out leads", async () => {
    const [lead] = await db
      .insert(companies)
      .values({
        name: "X",
        normalizedName: "x",
        matchName: "x",
        source: "manual_form",
        websiteUrl: "https://sorriso.test/",
      })
      .returning();
    queue.take();
    await post(`/leads/${lead?.id}/audit`, {});
    await post(`/leads/${lead?.id}/audit`, {});
    expect(queue.take()).toHaveLength(1);
    await db
      .update(companies)
      .set({ stage: "opted_out" })
      .where(eq(companies.id, lead?.id as string));
    expect((await post(`/leads/${lead?.id}/audit`, {})).status).toBe(409);
  });

  it("retries a dead job from the Jobs screen", async () => {
    const [j] = await db
      .insert(jobs)
      .values({
        kind: "audit_lead",
        idempotencyKey: "x",
        maxAttempts: 1,
        attempts: 1,
        status: "dead",
        lastError: "Error: boom",
      })
      .returning();
    expect((await post(`/jobs/${j?.id}/retry`, {})).status).toBe(303);
    expect((await db.select().from(jobs))[0]?.status).toBe("pending");
    expect((await post(`/jobs/${j?.id}/retry`, {})).status).toBe(404);
  });

  it("settings show whether secrets are set, never their values", async () => {
    const html = await (await get("/settings")).text();
    expect(html).toContain("GOOGLE_API_KEY");
    expect(html).not.toContain(GOOGLE_KEY);
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain("correct-horse-battery");
    expect(html).toContain("claude-haiku-5-5");
  });

  it("without a Google key, campaigns can be created but not run", async () => {
    const { app: noKey } = makeApp({});
    const res = await noKey.request(`${ORIGIN}/campaigns`, { headers: auth });
    expect(await res.text()).toContain("GOOGLE_API_KEY is not set");
    const created = await noKey.request(`${ORIGIN}/campaigns`, {
      method: "POST",
      body: new URLSearchParams(CAMPAIGN),
      headers: { ...auth, Origin: ORIGIN },
    });
    const id = (created.headers.get("location") as string).split("/")[2]?.split("?")[0];
    const run = await noKey.request(`${ORIGIN}/campaigns/${id}/run`, {
      method: "POST",
      headers: { ...auth, Origin: ORIGIN },
    });
    expect(run.status).toBe(409);
  });

  it("paginates the lead list with a cursor that carries no PII", async () => {
    const values = Array.from({ length: 55 }, (_, i) => ({
      name: `Lead ${i}`,
      normalizedName: `lead ${i}`,
      matchName: `lead ${i}`,
      source: "manual_form" as const,
      email: `a${i}@x.test`,
    }));
    await db.insert(companies).values(values);
    const first = await (await get("/leads")).text();
    const next = /href="\/leads\?after=([^"&]+)"/.exec(first)?.[1];
    expect(next).toMatch(/^\d+\.[0-9a-f-]{36}$/);
    const second = await (await get(`/leads?after=${next}`)).text();
    const names = (h: string) => [...h.matchAll(/>Lead (\d+)</g)].map((m) => m[1]);
    expect(names(first)).toHaveLength(50);
    expect(names(second)).toHaveLength(5);
    expect(new Set([...names(first), ...names(second)]).size).toBe(55);
  });
});
