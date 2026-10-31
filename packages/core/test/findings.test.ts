import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.ts";
import { type AuditFacts, buildFindings } from "../src/findings.ts";
import type { HtmlChecks } from "../src/html-audit.ts";

const NOW = new Date("2026-10-31T12:00:00Z");
const goodHtml: HtmlChecks = {
  finalUrl: "https://x.com.br/",
  https: true,
  viewport: true,
  title: "X",
  metaDescription: "desc",
  h1Count: 1,
  whatsapp: true,
  booking: ["Calendly"],
  contactForm: true,
  copyrightYear: 2026,
  platform: "custom",
  platformEvidence: [],
  chatWidgets: [],
  internalLinks: [],
  phoneDigits: [],
  instagramHandles: [],
};
const base: AuditFacts = {
  status: "ok",
  url: "https://x.com.br/",
  niche: "clínica odontológica",
  html: goodHtml,
  pagespeed: { score: 95, lcpMs: 1200, cls: 0.01, inpMs: 100 },
  brokenLinks: { checked: 10, broken: [] },
  reviews: null,
  place: null,
};
const codes = (f: AuditFacts) => buildFindings(f, defaultConfig, NOW).map((x) => x.code);

describe("buildFindings", () => {
  it("has nothing to say about a healthy site", () => {
    expect(codes(base)).toEqual([]);
  });

  it("writes the spec's example finding in Portuguese with the evidence", () => {
    const [f] = buildFindings(
      { ...base, pagespeed: { score: 23, lcpMs: 9200, cls: 0.01, inpMs: null } },
      defaultConfig,
      NOW,
    );
    expect(f).toMatchObject({ code: "slow_mobile", severity: "high", offer: "website" });
    expect(f?.text).toBe("Site leva 9,2s para carregar no celular (PageSpeed 23/100).");
  });

  it("no website is a strong website finding and stops there", () => {
    const f = buildFindings(
      {
        ...base,
        status: "no_website",
        url: null,
        html: null,
        pagespeed: null,
        place: { rating: 4.8, reviewCount: 120 },
      },
      defaultConfig,
      NOW,
    );
    expect(f.map((x) => x.code)).toEqual(["no_website"]);
    expect(f[0]?.text).toContain("nota 4,8 com 120 avaliações");
  });

  it("an unreachable site says why", () => {
    const f = buildFindings(
      { ...base, status: "unreachable", html: null, pagespeed: null, error: "certificado SSL inválido" },
      defaultConfig,
      NOW,
    );
    expect(f[0]?.text).toContain("certificado SSL inválido");
  });

  it("covers the HTML checks", () => {
    const html = {
      ...goodHtml,
      https: false,
      viewport: false,
      title: null,
      metaDescription: null,
      h1Count: 0,
      whatsapp: false,
      booking: [],
      contactForm: false,
      copyrightYear: 2019,
    };
    expect(codes({ ...base, html, brokenLinks: { checked: 20, broken: ["https://x.com.br/promo"] } })).toEqual([
      "no_https",
      "no_viewport",
      "no_title",
      "no_meta_description",
      "no_h1",
      "broken_links",
      "stale_copyright",
      "no_whatsapp",
      "no_online_booking",
      "no_contact_channel",
    ]);
  });

  it("only asks for online booking in booking niches", () => {
    const html = { ...goodHtml, booking: [] };
    expect(codes({ ...base, html })).toContain("no_online_booking");
    expect(codes({ ...base, html, niche: "escritório de advocacia" })).not.toContain("no_online_booking");
  });

  it("marks stores for the e-commerce offer, Shopify included", () => {
    const f = buildFindings({ ...base, html: { ...goodHtml, platform: "shopify" } }, defaultConfig, NOW);
    expect(f).toEqual([
      expect.objectContaining({ code: "ecommerce_platform", offer: "ecommerce", text: "Loja virtual em Shopify." }),
    ]);
    expect(codes({ ...base, html: { ...goodHtml, platform: "woocommerce" } })).toEqual(["ecommerce_platform"]);
  });

  it("turns review pain into automation findings", () => {
    const f = buildFindings(
      { ...base, reviews: { reviewed: 5, counts: { slow_reply: 2, whatsapp: 0, phone: 1, booking: 0 } } },
      defaultConfig,
      NOW,
    );
    expect(f.map((x) => [x.code, x.offer])).toEqual([
      ["reviews_slow_reply", "automation"],
      ["reviews_phone", "automation"],
    ]);
    expect(f[0]?.text).toBe("2 de 5 avaliações recentes no Google reclamam de demora para responder.");
  });

  it("reads thresholds from config", () => {
    const strict = { ...defaultConfig, findings: { ...defaultConfig.findings, poorPerformanceScore: 99 } };
    expect(buildFindings(base, strict, NOW).map((x) => x.code)).toEqual(["slow_mobile"]);
  });
});
