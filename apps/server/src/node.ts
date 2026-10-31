import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createNodeDb } from "@wbz/db/node";
import { createApp } from "./app.tsx";
import { loadSettings } from "./lib/env.ts";
import { logError } from "./lib/log.ts";
import { nodeResolver } from "./lib/safe-fetch.ts";
import { JOB_HANDLERS } from "./services/handlers.ts";
import { enqueue, sweepJobs } from "./services/jobs.ts";
import { MemoryQueue } from "./services/memory-queue.ts";
import { placesLimiter, type Runtime } from "./services/runtime.ts";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const settings = loadSettings(process.env);
const { db, close } = createNodeDb(settings.env.DATABASE_URL);
const queue = new MemoryQueue(JOB_HANDLERS);
const rt: Runtime = {
  db,
  settings,
  queue,
  http: fetch,
  resolve: nodeResolver,
  now: () => new Date(),
  placesLimiter: placesLimiter(settings.config.places.ratePerSecond),
};
queue.bind(rt);
const app = createApp(settings, async () => ({ db, settings, queue }), { http: fetch, resolve: nodeResolver });

const port = Number(process.env.PORT ?? 8787);
const server = serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? "127.0.0.1" }, (info) => {
  console.log(`Webcraftz Prospector on http://${info.address}:${info.port} (auth: ${settings.env.AUTH_MODE})`);
});

// Same schedule as the Workers cron triggers: sweep every minute, retention once a day.
const tick = async () => {
  try {
    await sweepJobs(rt);
    const day = new Date().toISOString().slice(0, 10);
    await enqueue(db, queue, {
      kind: "prune_expired",
      key: `prune:${day}`,
      maxAttempts: settings.config.jobs.maxAttempts,
    });
  } catch (err) {
    logError(err, { step: "tick" });
  }
};
const timer = setInterval(tick, 60_000);
void tick();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    server.close();
    void close().then(() => process.exit(0));
  });
}
