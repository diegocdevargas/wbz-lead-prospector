import { companies, dedupeCandidates } from "@wbz/db";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.tsx";
import { loadSettings } from "../src/lib/env.ts";
import { countRows, SECRET, TEST_DB_URL, useTestDb } from "./helpers.ts";

const db = useTestDb();
const ORIGIN = "http://localhost";

function makeApp(extra: Record<string, string> = {}) {
  const settings = loadSettings({
    DATABASE_URL: TEST_DB_URL,
    SUPPRESSION_SECRET: SECRET,
    ENVIRONMENT: "development",
    AUTH_MODE: "basic",
    BASIC_AUTH_USER: "diego",
    BASIC_AUTH_PASSWORD: "correct-horse-battery",
    ...extra,
  });
  return createApp(settings, async () => ({ db, settings }));
}

const app = makeApp();
const auth = { Authorization: `Basic ${btoa("diego:correct-horse-battery")}` };
const post = (path: string, body: FormData | URLSearchParams, headers: Record<string, string> = {}) =>
  app.request(`${ORIGIN}${path}`, { method: "POST", body, headers: { ...auth, Origin: ORIGIN, ...headers } });

describe("env validation", () => {
  it("refuses to run without auth in production", () => {
    expect(() =>
      loadSettings({ DATABASE_URL: "x", SUPPRESSION_SECRET: SECRET, ENVIRONMENT: "production", AUTH_MODE: "none" }),
    ).toThrow(/not allowed in production/);
  });
  it("defaults to Cloudflare Access and requires its settings", () => {
    expect(() => loadSettings({ DATABASE_URL: "x", SUPPRESSION_SECRET: SECRET })).toThrow(/CF_ACCESS/);
  });
  it("requires a long suppression secret", () => {
    expect(() =>
      loadSettings({ DATABASE_URL: "x", SUPPRESSION_SECRET: "short", ENVIRONMENT: "development", AUTH_MODE: "none" }),
    ).toThrow(/SUPPRESSION_SECRET/);
  });
});

describe("HTTP security", () => {
  it("requires auth on every page but not on the health check", async () => {
    expect((await app.request(`${ORIGIN}/leads`)).status).toBe(401);
    expect((await app.request(`${ORIGIN}/assets/app.css`)).status).toBe(401);
    expect((await app.request(`${ORIGIN}/healthz`)).status).toBe(200);
  });

  it("rejects requests without a valid Cloudflare Access token in access mode", async () => {
    const access = makeApp({
      AUTH_MODE: "access",
      CF_ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
      CF_ACCESS_AUD: "aud",
    });
    expect((await access.request(`${ORIGIN}/leads`)).status).toBe(401);
    const forged = access.request(`${ORIGIN}/leads`, { headers: { "Cf-Access-Jwt-Assertion": "a.b.c" } });
    expect((await forged).status).toBe(401);
  });

  it("sets security headers and no-store on pages", async () => {
    const res = await app.request(`${ORIGIN}/leads`, { headers: auth });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("blocks cross-site form posts (CSRF)", async () => {
    const form = new URLSearchParams({ company: "Evil Corp" });
    const res = await post("/leads/new", form, { Origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(await countRows(db, "companies")).toBe(0);
  });

  it("returns 404 for malformed ids instead of a database error", async () => {
    expect((await app.request(`${ORIGIN}/leads/not-a-uuid`, { headers: auth })).status).toBe(404);
  });

  it("escapes user data in HTML", async () => {
    await post("/leads/new", new URLSearchParams({ company: "<script>alert(1)</script>" }));
    const res = await app.request(`${ORIGIN}/leads`, { headers: auth });
    const html = await res.text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("dashboard flows", () => {
  it("previews a semicolon CSV without saving, then imports it", async () => {
    const csv =
      "Empresa;Cidade;UF;Telefone;Site\nClínica Sorriso;Passo Fundo;RS;(54) 99999-1234;clinicasorriso.com.br\n;Erechim;RS;;\n";
    const preview = new FormData();
    preview.set("file", new File([csv], "leads.csv", { type: "text/csv" }));
    const res = await post("/imports/preview", preview);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("created: 1");
    expect(html).toContain("invalid: 1");
    expect(await countRows(db, "companies")).toBe(0);

    const commit = new FormData();
    commit.set("content", csv);
    commit.set("source", "manual_csv");
    commit.set("filename", "leads.csv");
    for (const [i, f] of ["company", "city", "state", "phone", "website"].entries()) commit.set(`map_${i}`, f);
    const done = await post("/imports/commit", commit);
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toMatch(/^\/imports\/[0-9a-f-]{36}$/);
    expect(await countRows(db, "companies")).toBe(1);
  });

  it("adds a lead by form and shows it with its sources", async () => {
    const res = await post(
      "/leads/new",
      new URLSearchParams({ company: "Advocacia Silva", city: "Passo Fundo", email: "x@silva.adv.br" }),
    );
    expect(res.status).toBe(303);
    const page = await app.request(`${ORIGIN}${res.headers.get("location")}`, { headers: auth });
    const html = await page.text();
    expect(html).toContain("Advocacia Silva");
    expect(html).toContain("manual_form");
  });

  it("filters the lead list", async () => {
    await post("/leads/new", new URLSearchParams({ company: "A", niche: "odontologia" }));
    await post("/leads/new", new URLSearchParams({ company: "B", niche: "advocacia" }));
    const html = await (await app.request(`${ORIGIN}/leads?niche=advocacia&stage=bogus`, { headers: auth })).text();
    expect(html).toContain('<span class="muted"> (1)</span>');
  });

  it("merges from the review queue", async () => {
    await post("/leads/new", new URLSearchParams({ company: "Clínica Odontológica Sorriso", city: "Passo Fundo" }));
    await post("/leads/new", new URLSearchParams({ company: "Sorriso Odontologia", city: "Passo Fundo" }));
    const [cand] = await db.select().from(dedupeCandidates);
    expect(cand).toBeDefined();
    const res = await post(`/dedupe/${cand?.id}/merge`, new URLSearchParams());
    expect(res.status).toBe(303);
    expect(await db.select().from(companies)).toHaveLength(1);
  });

  it("exports and deletes a lead (LGPD)", async () => {
    const created = await post(
      "/leads/new",
      new URLSearchParams({ company: "Imobiliária Pampa", email: "oi@pampa.com.br" }),
    );
    const id = created.headers.get("location")?.split("/")[2]?.split("?")[0] as string;
    const exp = await app.request(`${ORIGIN}/leads/${id}/export`, { headers: auth });
    expect(exp.headers.get("content-disposition")).toContain("attachment");
    expect(((await exp.json()) as { company: { email: string } }).company.email).toBe("oi@pampa.com.br");

    expect((await post(`/leads/${id}/delete`, new URLSearchParams({ suppress: "1" }))).status).toBe(400);
    expect((await post(`/leads/${id}/delete`, new URLSearchParams({ suppress: "1", confirm: "1" }))).status).toBe(303);
    expect(await countRows(db, "companies")).toBe(0);
    const again = await post("/leads/new", new URLSearchParams({ company: "Pampa", email: "OI@pampa.com.br" }));
    expect(again.status).toBe(409);
  });
});
