import { describe, expect, it } from "vitest";
import { extractHtmlChecks, pageText } from "../src/html-audit.ts";

const NOW = new Date("2026-10-31T12:00:00Z");
const page = (head: string, body: string) => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe("extractHtmlChecks", () => {
  it("reads basic SEO and mobile signals", () => {
    const c = extractHtmlChecks(
      page(
        '<title> Clínica  X </title><meta name="viewport" content="width=device-width"><meta name="description" content="Dentista">',
        "<h1>A</h1><h1>B</h1>",
      ),
      "https://x.com.br/",
      { now: NOW },
    );
    expect(c).toMatchObject({
      https: true,
      viewport: true,
      title: "Clínica X",
      metaDescription: "Dentista",
      h1Count: 2,
    });
  });

  it("flags missing basics and http", () => {
    const c = extractHtmlChecks(page("", "<p>oi</p>"), "http://x.com.br/", { now: NOW });
    expect(c).toMatchObject({ https: false, viewport: false, title: null, metaDescription: null, h1Count: 0 });
  });

  it.each([
    ["woocommerce", '<link rel="stylesheet" href="/wp-content/plugins/woocommerce/assets/css/woocommerce.css">'],
    ["wordpress", '<link rel="stylesheet" href="/wp-content/themes/x/style.css">'],
    ["shopify", '<script src="https://cdn.shopify.com/s/files/1/x.js"></script>'],
    ["nuvemshop", '<script src="https://d26lpennugtm8s.cloudfront.net/stores/001/x.js"></script>'],
    ["vtex", '<img src="https://loja.vteximg.com.br/arquivos/logo.png">'],
    ["wix", '<meta name="generator" content="Wix.com Website Builder">'],
    ["tray", '<img src="https://images.tcdn.com.br/img/x.png">'],
    ["loja_integrada", '<script src="https://cdn.awsli.com.br/production/x.js"></script>'],
    ["custom", '<link rel="stylesheet" href="/css/site.css">'],
  ])("detects %s", (platform, head) => {
    expect(extractHtmlChecks(page(head, ""), "https://x.com.br/", { now: NOW }).platform).toBe(platform);
  });

  it("detects the platform from response headers", () => {
    const c = extractHtmlChecks(page("", ""), "https://x.com.br/", { headers: { "x-shopid": "123" }, now: NOW });
    expect(c.platform).toBe("shopify");
    const s = extractHtmlChecks(page("", ""), "https://x.com.br/", {
      headers: { "x-powered-by": "Shopify" },
      now: NOW,
    });
    expect(s.platform).toBe("shopify");
  });

  it("finds WhatsApp, booking, chat and contact form", () => {
    const c = extractHtmlChecks(
      page(
        '<script src="https://embed.tawk.to/1/default"></script>',
        '<a href="https://wa.me/5549999999999">Whats</a><a href="https://www.doctoralia.com.br/x">Agende</a><form><input type="email" name="e"></form>',
      ),
      "https://x.com.br/",
      { now: NOW },
    );
    expect(c.whatsapp).toBe(true);
    expect(c.booking).toEqual(["Doctoralia"]);
    expect(c.chatWidgets).toEqual(["Tawk.to"]);
    expect(c.contactForm).toBe(true);
  });

  it("reports none when absent", () => {
    const c = extractHtmlChecks(page("", '<a href="/contato">Contato</a>'), "https://x.com.br/", { now: NOW });
    expect(c).toMatchObject({ whatsapp: false, booking: [], chatWidgets: [], contactForm: false });
  });

  it("reads the latest copyright year from visible text only", () => {
    const c = extractHtmlChecks(
      page("<script>var y='© 2026'</script>", "<footer>Copyright © 2015 - 2019 Empresa</footer>"),
      "https://x.com.br/",
      { now: NOW },
    );
    expect(c.copyrightYear).toBe(2019);
    expect(
      extractHtmlChecks(page("", "<footer>Empresa</footer>"), "https://x.com.br/", { now: NOW }).copyrightYear,
    ).toBeNull();
  });

  it("collects same-site links without fragments, tel digits and instagram handles", () => {
    const c = extractHtmlChecks(
      page(
        "",
        '<a href="/a#top">a</a><a href="https://www.x.com.br/b">b</a><a href="https://other.com/">o</a><a href="mailto:a@x.com.br">m</a><a href="tel:+55 (49) 3322-0001">t</a><a href="https://instagram.com/clinicax/">ig</a><a href="https://www.instagram.com/p/abc/">post</a>',
      ),
      "https://x.com.br/",
      { now: NOW },
    );
    expect(c.internalLinks).toEqual(["https://x.com.br/a", "https://www.x.com.br/b"]);
    expect(c.phoneDigits).toEqual(["554933220001"]);
    expect(c.instagramHandles).toEqual(["clinicax"]);
  });

  it("does not throw on broken HTML", () => {
    expect(() =>
      extractHtmlChecks("<html><body><a href='http://[bad'>x</a><div", "https://x.com.br/", { now: NOW }),
    ).not.toThrow();
  });
});

describe("pageText", () => {
  it("returns visible text without scripts and styles", () => {
    expect(pageText("<style>.a{}</style><p>Olá <b>mundo</b></p><script>alert(1)</script>")).toBe("Olá mundo");
  });
});
