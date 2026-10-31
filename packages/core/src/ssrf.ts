import ipaddr from "ipaddr.js";

/**
 * SSRF rules for fetching URLs that came from untrusted sources (Places,
 * imports, websites). Pure checks; the fetcher applies them to the URL and to
 * every resolved address, before the first request and after each redirect.
 */

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

const ALLOWED_PORTS = new Set(["", "80", "443"]);

export function checkFetchUrl(input: string | URL): UrlCheck {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: "invalid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "only http(s) allowed" };
  if (!ALLOWED_PORTS.has(url.port)) return { ok: false, reason: "only ports 80 and 443 allowed" };
  if (url.username || url.password) return { ok: false, reason: "credentials in URL not allowed" };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) return { ok: false, reason: "missing host" };
  if (ipaddr.isValid(host)) {
    if (!isPublicAddress(host)) return { ok: false, reason: "address is not public" };
  } else {
    const lower = host.toLowerCase();
    if (
      !lower.includes(".") ||
      lower === "localhost" ||
      /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(lower)
    ) {
      return { ok: false, reason: "host is not a public name" };
    }
  }
  return { ok: true, url };
}

/** True only for globally routable unicast addresses (blocks private, loopback, link-local, metadata, CGNAT, etc.). */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  let ip = ipaddr.parse(address);
  if (ip.kind() === "ipv6") {
    const v6 = ip as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) ip = v6.toIPv4Address();
  }
  // ipaddr.js classifies every special-purpose block; only "unicast" is public.
  return ip.range() === "unicast";
}
