import { checkFetchUrl, isPublicAddress } from "@wbz/core";

/**
 * Fetch a URL from an untrusted source (a lead's website) without SSRF:
 * http(s) on 80/443 only, every hostname resolved and every address checked
 * as public before each hop, manual redirects (max N, each re-checked), a
 * timeout, a body cap, and no cookies or credentials.
 *
 * Residual risk: the runtime's fetch resolves DNS again, so a hostname that
 * changes answers between our check and the connection (DNS rebinding) is not
 * fully covered. On Workers, outbound fetches leave from Cloudflare's network
 * and cannot reach our private ranges anyway; locally the check stops the
 * common cases.
 */

/** Resolve a hostname to every A/AAAA address. */
export type Resolver = (hostname: string) => Promise<string[]>;
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface SafeFetchOptions {
  resolve: Resolver;
  fetch: FetchLike;
  method?: "GET" | "HEAD";
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  userAgent: string;
}

export interface SafeResponse {
  status: number;
  finalUrl: string;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
  redirects: number;
}

export class SafeFetchError extends Error {
  constructor(
    readonly kind: "blocked" | "network" | "timeout" | "tls",
    message: string,
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export async function safeFetch(input: string, opts: SafeFetchOptions): Promise<SafeResponse> {
  let current = input;
  const deadline = AbortSignal.timeout(opts.timeoutMs);
  for (let redirects = 0; ; redirects++) {
    const check = checkFetchUrl(current);
    if (!check.ok) throw new SafeFetchError("blocked", check.reason);
    const url = check.url;
    await assertPublicHost(url.hostname.replace(/^\[|\]$/g, ""), opts.resolve);

    let res: Response;
    try {
      res = await opts.fetch(url.toString(), {
        method: opts.method ?? "GET",
        redirect: "manual",
        credentials: "omit",
        signal: deadline,
        headers: {
          "User-Agent": opts.userAgent,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "Accept-Language": "pt-BR,pt;q=0.9",
        },
      });
    } catch (err) {
      throw classifyNetworkError(err);
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => {});
      if (redirects >= opts.maxRedirects)
        throw new SafeFetchError("blocked", `more than ${opts.maxRedirects} redirects`);
      current = new URL(res.headers.get("location") as string, url).toString();
      continue;
    }

    const headers = Object.fromEntries([...res.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
    if (opts.method === "HEAD") {
      await res.body?.cancel().catch(() => {});
      return { status: res.status, finalUrl: url.toString(), headers, body: "", truncated: false, redirects };
    }
    const { text, truncated } = await readCapped(res, opts.maxBytes).catch((err) => {
      throw classifyNetworkError(err);
    });
    return { status: res.status, finalUrl: url.toString(), headers, body: text, truncated, redirects };
  }
}

async function assertPublicHost(host: string, resolve: Resolver) {
  if (isPublicAddress(host)) return;
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new SafeFetchError("network", "DNS lookup failed");
  }
  if (addresses.length === 0) throw new SafeFetchError("network", "host has no address");
  if (addresses.some((a) => !isPublicAddress(a)))
    throw new SafeFetchError("blocked", "host resolves to a non-public address");
}

async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) return { text: "", truncated: false };
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - size));
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  const charset = /charset=([\w-]+)/i.exec(res.headers.get("content-type") ?? "")?.[1] ?? "utf-8";
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset);
  } catch {
    decoder = new TextDecoder("utf-8");
  }
  return { text: decoder.decode(bytes), truncated };
}

function classifyNetworkError(err: unknown): SafeFetchError {
  if (err instanceof SafeFetchError) return err;
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return new SafeFetchError("timeout", "timed out");
  const detail = `${e?.cause?.code ?? ""} ${e?.cause?.message ?? ""} ${e?.message ?? ""}`;
  if (/CERT|SSL|TLS|self.signed|certificate/i.test(detail)) return new SafeFetchError("tls", "invalid SSL certificate");
  return new SafeFetchError("network", e?.cause?.code ?? "connection failed");
}

/** Node: the OS resolver. */
export async function nodeResolver(hostname: string): Promise<string[]> {
  const { lookup } = await import("node:dns/promises");
  const res = await lookup(hostname, { all: true, verbatim: true });
  return res.map((r) => r.address);
}

/** Workers (no DNS API): DNS-over-HTTPS against Cloudflare's resolver. */
export function dohResolver(fetchImpl: FetchLike = fetch): Resolver {
  return async (hostname) => {
    const out: string[] = [];
    for (const type of ["A", "AAAA"]) {
      const res = await fetchImpl(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
        {
          headers: { Accept: "application/dns-json" },
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!res.ok) throw new Error(`DoH ${res.status}`);
      const json = (await res.json()) as { Answer?: { type: number; data: string }[] };
      for (const a of json.Answer ?? []) if (a.type === 1 || a.type === 28) out.push(a.data);
    }
    return out;
  };
}
