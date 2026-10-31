# ADR-0005: Postgres jobs table as source of truth, queue as transport

**Status:** Accepted (part of the M2 plan Diego approved, 2026-10-31)
**Date:** 2026-10-31
**Deciders:** Diego

## Context
M2 adds background work (discovery pages, audits, retention). The spec asks for Cloudflare Queues in production, an in-memory adapter in dev, idempotent and retry-safe jobs, and a Jobs screen with pending, failed, retried and dead-lettered runs plus a retry button.

## Options considered

### A: Queue only (Cloudflare Queues retries and dead-letter queue)
**Pros:** no table. **Cons:** queue state is not queryable for the Jobs screen; the dev adapter would need to fake retries and DLQ; no history.

### B: `jobs` table holds the state; the queue carries only job ids
**Pros:** one code path for dev and prod; the Jobs screen is a query; idempotency is a unique key; a lost message is recovered by a cron sweep. **Cons:** a few more writes per job.

## Decision
Option B. `enqueue` inserts on a unique `idempotency_key` and sends the id. `runJob` claims a job with one conditional `UPDATE` (so a double delivery runs it once), records success or the error message, and schedules retries with exponential backoff until `max_attempts`, then `dead`. The Cloudflare consumer always acks (no queue-level retries). A cron sweep every minute re-sends due jobs and recovers jobs stuck in `running`.

## Consequences
- Without a queue binding, jobs still run (the sweep picks them up within a minute).
- The table needs pruning of old succeeded jobs later (not urgent at this volume).
