import { describe, expect, it } from "vitest";
import { SafeFetchError, safeFetch } from "../src/lib/safe-fetch.ts";
import { fakeHttp, fakeResolver, html } from "./fakes.ts";

const opts = { resolve: fakeResolver, timeoutMs: 1000, maxBytes: 1000, maxRedirects: 2, userAgent: "test" };
const redirect = (to: string) => new Response(null, { status: 301, headers: { location: to } });

async function fails(p: Promise<unknown>, kind: SafeFetchError["kind"], msg?: RegExp) {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(SafeFetchError);
  expect(err.kind).toBe(kind);
  if (msg) expect(err.message).toMatch(msg);
}

describe("safeFetch (SSRF rules)", () => {
  it("fetches a public page without cookies and follows a safe redirect", async () => {
    const { http, calls } = fakeHttp([
      ["https://a.test/old", () => redirect("/new")],
      ["https://a.test/new", () => html("<p>ok</p>")],
    ]);
    const res = await safeFetch("https://a.test/old", { ...opts, fetch: http });
    expect(res).toMatchObject({ status: 200, finalUrl: "https://a.test/new", body: "<p>ok</p>", redirects: 1 });
    expect(calls.map((c) => c.headers.cookie)).toEqual([undefined, undefined]);
  });

  it("blocks a host that resolves to a private address", async () => {
    const { http, calls } = fakeHttp([]);
    await fails(safeFetch("https://evil.test/", { ...opts, fetch: http }), "blocked", /non-public/);
    expect(calls).toHaveLength(0);
  });

  it("re-checks every redirect hop", async () => {
    const { http, calls } = fakeHttp([["https://a.test/", () => redirect("http://169.254.169.254/latest/meta-data")]]);
    await fails(safeFetch("https://a.test/", { ...opts, fetch: http }), "blocked");
    expect(calls).toHaveLength(1);
    const { http: h2 } = fakeHttp([["https://a.test/", () => redirect("https://evil.test/")]]);
    await fails(safeFetch("https://a.test/", { ...opts, fetch: h2 }), "blocked", /non-public/);
  });

  it("refuses non-http schemes and odd ports, also via redirect", async () => {
    const { http } = fakeHttp([["https://a.test/", () => redirect("file:///etc/passwd")]]);
    await fails(safeFetch("https://a.test/", { ...opts, fetch: http }), "blocked", /http/);
    await fails(safeFetch("https://a.test:8443/", { ...opts, fetch: http }), "blocked", /port/);
  });

  it("stops after the redirect limit", async () => {
    const { http } = fakeHttp([[/^https:\/\/a\.test\/\d$/, (c) => redirect(`/${Number(c.url.at(-1)) + 1}`)]]);
    await fails(safeFetch("https://a.test/1", { ...opts, fetch: http }), "blocked", /redirects/);
  });

  it("caps the body size", async () => {
    const { http } = fakeHttp([["https://a.test/", () => html("x".repeat(5000))]]);
    const res = await safeFetch("https://a.test/", { ...opts, fetch: http });
    expect(res.body).toHaveLength(1000);
    expect(res.truncated).toBe(true);
  });

  it("times out", async () => {
    const slow = async (_u: string, init: RequestInit) =>
      new Promise<Response>((_r, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    await fails(safeFetch("https://a.test/", { ...opts, timeoutMs: 20, fetch: slow }), "timeout");
  });

  it("reports TLS errors distinctly", async () => {
    const tls = async () => {
      throw new TypeError("fetch failed", { cause: { code: "CERT_HAS_EXPIRED" } });
    };
    await fails(safeFetch("https://a.test/", { ...opts, fetch: tls }), "tls");
  });

  it("fails cleanly when DNS has no answer", async () => {
    const { http } = fakeHttp([]);
    await fails(safeFetch("https://a.test/", { ...opts, resolve: async () => [], fetch: http }), "network");
  });
});
