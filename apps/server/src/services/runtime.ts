import type { Db } from "@wbz/db";
import type { Settings } from "../lib/env.ts";
import { TokenBucket } from "../lib/rate-limit.ts";
import type { FetchLike, Resolver } from "../lib/safe-fetch.ts";

/** Carries job ids only; the jobs table holds the state. */
export interface JobQueue {
  send(jobId: string, delaySeconds?: number): Promise<void>;
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
  readonly sent: { jobId: string; delaySeconds: number }[] = [];
  async send(jobId: string, delaySeconds = 0) {
    this.sent.push({ jobId, delaySeconds });
  }
  take() {
    return this.sent.splice(0);
  }
}
