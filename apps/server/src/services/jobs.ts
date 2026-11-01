import { type JobKind, type JobStatus, retryDelaySeconds } from "@wbz/core";
import { type Db, type DbOrTx, jobs } from "@wbz/db";
import { and, desc, eq, inArray, lt, lte, type SQL, sql } from "drizzle-orm";
import { logError } from "../lib/log.ts";
import type { JobQueue, Runtime } from "./runtime.ts";

export type JobHandler = (
  rt: Runtime,
  payload: Record<string, unknown>,
  job: typeof jobs.$inferSelect,
) => Promise<void>;

export interface EnqueueInput {
  kind: JobKind;
  /** Same key = same work: a second enqueue is a no-op. */
  key: string;
  payload?: Record<string, unknown>;
  delaySeconds?: number;
  maxAttempts: number;
}

/**
 * Insert the job (idempotent on key) and hand its id to the queue. Inside a
 * transaction, pass `queue: null` and call `dispatch` after commit, so a
 * worker never picks up a job whose row is not visible yet.
 */
export async function enqueue(db: DbOrTx, queue: JobQueue | null, input: EnqueueInput) {
  const runAfter = new Date(Date.now() + (input.delaySeconds ?? 0) * 1000);
  const [row] = await db
    .insert(jobs)
    .values({
      kind: input.kind,
      idempotencyKey: input.key,
      payload: input.payload ?? {},
      maxAttempts: input.maxAttempts,
      runAfter,
    })
    .onConflictDoNothing({ target: jobs.idempotencyKey })
    .returning({ id: jobs.id });
  if (row && queue) await queue.send(row.id, input.delaySeconds ?? 0, isUrgent(input.kind));
  return row ? { id: row.id, created: true } : { id: null, created: false };
}

export async function dispatch(queue: JobQueue, ids: (string | null)[], opts: { urgent?: boolean } = {}) {
  for (const id of ids) if (id) await queue.send(id, 0, opts.urgent ?? false);
}

/** Discovery pages run before audits: they are few, and each one feeds many audits. */
export const isUrgent = (kind: JobKind) => kind === "discover_query";

/**
 * Run one job if it is due. Safe to call twice for the same id (a queue may
 * deliver twice): only one caller can move it to `running`. Failures retry
 * with backoff until max_attempts, then the job is `dead`.
 */
export async function runJob(
  rt: Runtime,
  jobId: string,
  handlers: Record<JobKind, JobHandler>,
): Promise<JobStatus | null> {
  const now = rt.now();
  const [job] = await rt.db
    .update(jobs)
    .set({ status: "running", attempts: sql`${jobs.attempts} + 1`, startedAt: now, finishedAt: null })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, ["pending", "failed"]), lte(jobs.runAfter, now)))
    .returning();
  if (!job) return null;

  try {
    await handlers[job.kind](rt, job.payload, job);
    await rt.db
      .update(jobs)
      .set({ status: "succeeded", finishedAt: rt.now(), lastError: null })
      .where(eq(jobs.id, job.id));
    return "succeeded";
  } catch (err) {
    const message = errorSummary(err);
    logError(err, { job: job.id, kind: job.kind, attempt: job.attempts });
    if (job.attempts >= job.maxAttempts) {
      await rt.db
        .update(jobs)
        .set({ status: "dead", finishedAt: rt.now(), lastError: message })
        .where(eq(jobs.id, job.id));
      return "dead";
    }
    const delay = retryDelaySeconds(job.attempts, rt.settings.config);
    await rt.db
      .update(jobs)
      .set({
        status: "failed",
        finishedAt: rt.now(),
        lastError: message,
        runAfter: new Date(rt.now().getTime() + delay * 1000),
      })
      .where(eq(jobs.id, job.id));
    await rt.queue.send(job.id, delay, isUrgent(job.kind));
    return "failed";
  }
}

/** Error class and message only, trimmed. Never payloads or response bodies. */
function errorSummary(err: unknown): string {
  const e = err instanceof Error ? err : new Error(String(err));
  return `${e.name}: ${e.message}`.slice(0, 500);
}

/**
 * Cron safety net: re-send due jobs whose queue message was lost, and recover
 * jobs stuck in `running` (a crashed worker). Returns how many were sent.
 */
export async function sweepJobs(rt: Runtime, limit = 50): Promise<number> {
  const now = rt.now();
  const staleBefore = new Date(now.getTime() - rt.settings.config.jobs.staleRunningMinutes * 60_000);
  await rt.db
    .update(jobs)
    .set({ status: "failed", lastError: "Stale: worker stopped while running", runAfter: now })
    .where(and(eq(jobs.status, "running"), lt(jobs.startedAt, staleBefore)));
  const due = await rt.db
    .select({ id: jobs.id, kind: jobs.kind })
    .from(jobs)
    .where(and(inArray(jobs.status, ["pending", "failed"]), lte(jobs.runAfter, now)))
    .orderBy(sql`${jobs.kind} = 'discover_query' desc`, jobs.runAfter)
    .limit(limit);
  for (const j of due) await rt.queue.send(j.id, 0, isUrgent(j.kind));
  return due.length;
}

/** Operator retry from the Jobs screen: gives a failed or dead job one more attempt now. */
export async function retryJob(db: Db, queue: JobQueue, id: string): Promise<boolean> {
  const [row] = await db
    .update(jobs)
    .set({
      status: "pending",
      runAfter: new Date(),
      maxAttempts: sql`greatest(${jobs.maxAttempts}, ${jobs.attempts} + 1)`,
    })
    .where(and(eq(jobs.id, id), inArray(jobs.status, ["failed", "dead"])))
    .returning({ id: jobs.id, kind: jobs.kind });
  if (!row) return false;
  await queue.send(row.id, 0, isUrgent(row.kind));
  return true;
}

export const JOBS_PAGE_SIZE = 50;

/** Keyset pagination on (created_at desc, id desc). */
export async function listJobs(
  db: DbOrTx,
  f: { status?: JobStatus; kind?: JobKind; cursor?: { t: Date; id: string } },
) {
  const where: SQL[] = [];
  if (f.status) where.push(eq(jobs.status, f.status));
  if (f.kind) where.push(eq(jobs.kind, f.kind));
  const ms = sql`date_trunc('milliseconds', ${jobs.createdAt})`;
  if (f.cursor) {
    const t = f.cursor.t.toISOString();
    where.push(sql`(${ms} < ${t}::timestamptz or (${ms} = ${t}::timestamptz and ${jobs.id} < ${f.cursor.id}))`);
  }
  const rows = await db
    .select()
    .from(jobs)
    .where(where.length ? and(...where) : undefined)
    .orderBy(sql`${ms} desc`, desc(jobs.id))
    .limit(JOBS_PAGE_SIZE + 1);
  const counts = await db
    .select({ status: jobs.status, n: sql<number>`count(*)::int` })
    .from(jobs)
    .groupBy(jobs.status);
  return {
    rows: rows.slice(0, JOBS_PAGE_SIZE),
    hasMore: rows.length > JOBS_PAGE_SIZE,
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Partial<Record<JobStatus, number>>,
  };
}
