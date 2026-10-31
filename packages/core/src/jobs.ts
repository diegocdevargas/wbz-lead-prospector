import type { AppConfig } from "./config.ts";

const MAX_DELAY_SECONDS = 6 * 60 * 60;

/** Exponential backoff for job retries: base × 4^(attempt-1), capped at 6h. */
export function retryDelaySeconds(attempt: number, config: AppConfig): number {
  const delay = config.jobs.backoffBaseSeconds * 4 ** Math.max(0, attempt - 1);
  return Math.min(delay, MAX_DELAY_SECONDS);
}
