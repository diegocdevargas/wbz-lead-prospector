import type { Db } from "@wbz/db";
import type { Settings } from "../lib/env.ts";
import { TokenBucket } from "../lib/rate-limit.ts";
import type { FetchLike, Resolver } from "../lib/safe-fetch.ts";

/** Carries job ids only; the jobs table holds the state. */
export interface JobQueue {
  /** `urgent` jobs go ahead of queued ones where the transport supports it (the local queue does). */
  send(jobId: string, delaySeconds?: number, urgent?: boolean): Promise<void>;
}

/** Everything a background job needs. Tests swap `http` and `resolve` for fixtures. */
export interface Runtime {
  db: Db;
  settings: Settings;
  queue: JobQueue;
  /** For known API hosts (Google). Website fetches go through safeFetch with `resolve`. */
  http: FetchLike;
  resolve: Resolver;
  now: () => Date;
  placesLimiter: TokenBucket;
}

const limiters = new Map<number, TokenBucket>();
/** One bucket per process/isolate, shared by every request and job. */
export function placesLimiter(ratePerSecond: number): TokenBucket {
  let b = limiters.get(ratePerSecond);
  if (!b) {
    b = new TokenBucket(ratePerSecond);
    limiters.set(ratePerSecond, b);
  }
  return b;
}

/** Collects job ids instead of running them; tests drain it explicitly. */
export class ManualQueue implements JobQueue {
  readonly sent: { jobId: string; delaySeconds: number; urgent?: boolean }[] = [];
  async send(jobId: string, delaySeconds = 0, urgent = false) {
    this.sent.push({ jobId, delaySeconds, ...(urgent ? { urgent } : {}) });
  }
  take() {
    return this.sent.splice(0);
  }
}
