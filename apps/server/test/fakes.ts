import { readFileSync } from "node:fs";
import { defaultConfig } from "@wbz/core";
import type { Db } from "@wbz/db";
import { loadSettings } from "../src/lib/env.ts";
import { TokenBucket } from "../src/lib/rate-limit.ts";
import type { FetchLike, Resolver } from "../src/lib/safe-fetch.ts";
import { JOB_HANDLERS } from "../src/services/handlers.ts";
import { runJob } from "../src/services/jobs.ts";
import { ManualQueue, type Runtime } from "../src/services/runtime.ts";
import { SECRET, TEST_DB_URL } from "./helpers.ts";

export const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

export interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

type Route = (call: Call) => Response | Promise<Response>;

/** A fetch that serves recorded fixtures and records every call. Unknown URLs fail loudly. */
export function fakeHttp(routes: [match: string | RegExp, route: Route][]) {
  const calls: Call[] = [];
  const http: FetchLike = async (input, init) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const call: Call = { method: init.method ?? "GET", url: input, headers, body: (init.body as string) ?? null };
    calls.push(call);
    for (const [match, route] of routes) {
      if (typeof match === "string" ? input.startsWith(match) : match.test(input)) return route(call);
    }
    throw new TypeError(`fetch failed: no fixture for ${input}`);
  };
  return { http, calls };
}

export const html = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Every *.test host is "public" except evil.test, which resolves to a private address. */
export const fakeResolver: Resolver = async (host) => (host === "evil.test" ? ["10.0.0.5"] : ["93.184.216.34"]);

/** The usual Google + website fixtures for one campaign run. */
export function googleAndSites() {
  return fakeHttp([
    [
      "https://places.googleapis.com/v1/places:searchText",
      (c) =>
        json(JSON.parse(fixture(JSON.parse(c.body ?? "{}").pageToken ? "places-page2.json" : "places-page1.json"))),
    ],
    ["https://places.googleapis.com/v1/places/", () => json(JSON.parse(fixture("place-details.json")))],
    ["https://www.googleapis.com/pagespeedonline/", () => json(JSON.parse(fixture("pagespeed.json")))],
    ["https://sorriso.test/pagina-quebrada", () => html("not found", 404)],
    [/^https:\/\/sorriso\.test\/(servicos|contato)$/, () => html("ok")],
    ["https://sorriso.test/", () => html(fixture("site-wordpress.html"))],
    ["https://loja-dental.test/", () => html(fixture("site-shopify.html"), 200, { "x-shopid": "1" })],
    ["https://optout.test/", () => html("<title>x</title>")],
  ]);
}

export function makeRuntime(db: Db, http: FetchLike, extraEnv: Record<string, string> = {}) {
  const settings = loadSettings({
    DATABASE_URL: TEST_DB_URL,
    SUPPRESSION_SECRET: SECRET,
    ENVIRONMENT: "test",
    AUTH_MODE: "basic",
    BASIC_AUTH_USER: "diego",
    BASIC_AUTH_PASSWORD: "correct-horse-battery",
    GOOGLE_API_KEY: "test-google-key-0123456789",
    ...extraEnv,
  });
  const queue = new ManualQueue();
  const rt: Runtime = {
    db,
    settings: { ...settings, config: settings.config ?? defaultConfig },
    queue,
    http,
    resolve: fakeResolver,
    now: () => new Date(),
    placesLimiter: new TokenBucket(1000),
  };
  return { rt, queue };
}

/** Run queued jobs (and the jobs they queue) until nothing is left. Delayed retries are run too. */
export async function drain(rt: Runtime, queue: ManualQueue, maxRounds = 50) {
  for (let i = 0; i < maxRounds; i++) {
    const batch = queue.take();
    if (batch.length === 0) return;
    for (const { jobId } of batch) await runJob(rt, jobId, JOB_HANDLERS);
  }
  throw new Error("queue did not drain");
}
