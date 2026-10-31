import { createNeonDb } from "@wbz/db/neon";
import { createApp } from "./app.tsx";
import { loadSettings, type Settings } from "./lib/env.ts";
import { logError } from "./lib/log.ts";
import { dohResolver } from "./lib/safe-fetch.ts";
import { JOB_HANDLERS } from "./services/handlers.ts";
import { enqueue, runJob, sweepJobs } from "./services/jobs.ts";
import { type JobQueue, placesLimiter, type Runtime } from "./services/runtime.ts";

type Bindings = Record<string, unknown> & { JOBS?: Queue<{ jobId: string }> };

/** Cloudflare Queues carry only the job id; the jobs table holds the state. */
function cfQueue(binding: Bindings["JOBS"]): JobQueue {
  return {
    async send(jobId, delaySeconds = 0) {
      if (!binding) return; // No queue bound: the cron sweep picks jobs up.
      await binding.send({ jobId }, { delaySeconds: Math.min(Math.ceil(delaySeconds), 43_200) });
    },
  };
}

let settings: Settings | null = null;
let app: ReturnType<typeof createApp> | null = null;
const getSettings = (env: Bindings) => {
  settings ??= loadSettings(env);
  return settings;
};

function runtime(env: Bindings): { rt: Runtime; close: () => Promise<void> } {
  const s = getSettings(env);
  const { db, close } = createNeonDb(s.env.DATABASE_URL);
  return {
    close,
    rt: {
      db,
      settings: s,
      queue: cfQueue(env.JOBS),
      http: fetch,
      resolve: dohResolver(),
      now: () => new Date(),
      placesLimiter: placesLimiter(s.config.places.ratePerSecond),
    },
  };
}

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    if (!app) {
      const s = getSettings(env);
      // A Neon WebSocket pool cannot be shared across requests on Workers: one per request, closed after.
      app = createApp(
        s,
        async () => {
          const { db, close } = createNeonDb(s.env.DATABASE_URL);
          return { db, settings: s, release: close, queue: cfQueue(env.JOBS) };
        },
        { http: fetch, resolve: dohResolver() },
      );
    }
    return app.fetch(request, env, ctx);
  },

  async queue(batch: MessageBatch<{ jobId: string }>, env: Bindings): Promise<void> {
    const { rt, close } = runtime(env);
    try {
      for (const msg of batch.messages) {
        try {
          // runJob records failures and schedules its own retry, so the message is always acked.
          await runJob(rt, msg.body.jobId, JOB_HANDLERS);
        } catch (err) {
          logError(err, { job: msg.body.jobId });
        }
        msg.ack();
      }
    } finally {
      await close();
    }
  },

  async scheduled(controller: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void> {
    const { rt, close } = runtime(env);
    const work = (async () => {
      try {
        await sweepJobs(rt);
        if (controller.cron === "0 6 * * *") {
          const day = new Date(controller.scheduledTime).toISOString().slice(0, 10);
          await enqueue(rt.db, rt.queue, {
            kind: "prune_expired",
            key: `prune:${day}`,
            maxAttempts: rt.settings.config.jobs.maxAttempts,
          });
        }
      } finally {
        await close();
      }
    })();
    ctx.waitUntil(work);
    await work;
  },
} satisfies ExportedHandler<Bindings, { jobId: string }>;
