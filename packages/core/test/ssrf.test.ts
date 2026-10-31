import { describe, expect, it } from "vitest";
import { checkFetchUrl, isPublicAddress } from "../src/ssrf.ts";

describe("checkFetchUrl", () => {
  it("allows public http(s) URLs on default ports", () => {
    expect(checkFetchUrl("https://clinica.com.br/").ok).toBe(true);
    expect(checkFetchUrl("http://clinica.com.br:80/x").ok).toBe(true);
    expect(checkFetchUrl("https://clinica.com.br:443/").ok).toBe(true);
  });

  it.each([
    ["file:///etc/passwd", "only http(s)"],
    ["ftp://clinica.com.br/", "only http(s)"],
    ["gopher://clinica.com.br/", "only http(s)"],
    ["https://clinica.com.br:8080/", "ports"],
    ["https://user:pass@clinica.com.br/", "credentials"],
    ["http://localhost/", "public name"],
    ["http://intranet/", "public name"],
    ["http://printer.local/", "public name"],
    ["http://127.0.0.1/", "not public"],
    ["http://10.1.2.3/", "not public"],
    ["http://169.254.169.254/latest/meta-data", "not public"],
    ["http://[::1]/", "not public"],
    ["http://[fd00::1]/", "not public"],
    ["http://[::ffff:127.0.0.1]/", "not public"],
    ["not a url", "invalid"],
  ])("blocks %s", (url, reason) => {
    const r = checkFetchUrl(url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(reason);
  });
});

describe("isPublicAddress", () => {
  it.each(["8.8.8.8", "177.71.1.1", "2001:4860:4860::8888"])("%s is public", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });
  it.each([
    "0.0.0.0",
    "127.0.0.1",
    "10.0.0.1",
    "172.16.5.4",
    "192.168.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "192.0.2.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1",
    "garbage",
  ])("%s is blocked", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
});
