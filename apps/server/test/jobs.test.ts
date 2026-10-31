import { jobs } from "@wbz/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { enqueue, type JobHandler, retryJob, runJob, sweepJobs } from "../src/services/jobs.ts";
import { fakeHttp, makeRuntime } from "./fakes.ts";
import { useTestDb } from "./helpers.ts";

const db = useTestDb();

function setup(handler: JobHandler) {
  const { rt, queue } = makeRuntime(db, fakeHttp([]).http);
  const handlers = { discover_query: handler, audit_lead: handler, prune_expired: handler };
  return { rt, queue, handlers };
}

const job = async (id: string) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0];

describe("jobs", () => {
  it("enqueue is idempotent on its key", async () => {
    const { rt, queue } = setup(async () => {});
    const a = await enqueue(db, rt.queue, { kind: "audit_lead", key: "k1", maxAttempts: 3 });
    const b = await enqueue(db, rt.queue, { kind: "audit_lead", key: "k1", maxAttempts: 3 });
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: null, created: false });
    expect(queue.take()).toHaveLength(1);
  });

  it("runs a job once even if delivered twice", async () => {
    let runs = 0;
    const { rt, handlers } = setup(async () => {
      runs++;
    });
    const { id } = await enqueue(db, null, { kind: "audit_lead", key: "k", maxAttempts: 3 });
    expect(await runJob(rt, id as string, handlers)).toBe("succeeded");
    expect(await runJob(rt, id as string, handlers)).toBeNull();
    expect(runs).toBe(1);
  });

  it("retries with backoff, then dead-letters, keeping only the error message", async () => {
    const { rt, queue, handlers } = setup(async () => {
      throw new Error("boom");
    });
    const { id } = await enqueue(db, null, { kind: "audit_lead", key: "k", maxAttempts: 2 });
    expect(await runJob(rt, id as string, handlers)).toBe("failed");
    expect(queue.take()).toEqual([{ jobId: id, delaySeconds: 30 }]);
    const failed = await job(id as string);
    expect(failed).toMatchObject({ status: "failed", attempts: 1, lastError: "Error: boom" });
    // Not due yet:
    expect(await runJob(rt, id as string, handlers)).toBeNull();

    const later = { ...rt, now: () => new Date(Date.now() + 60_000) };
    expect(await runJob(later, id as string, handlers)).toBe("dead");
    expect(await job(id as string)).toMatchObject({ status: "dead", attempts: 2 });

    // Operator retry gives it one more attempt.
    expect(await retryJob(db, rt.queue, id as string)).toBe(true);
    expect(await job(id as string)).toMatchObject({ status: "pending", maxAttempts: 3 });
    expect(await retryJob(db, rt.queue, id as string)).toBe(false); // already pending
  });

  it("sweep re-sends due jobs and recovers stuck ones", async () => {
    const { rt, queue } = setup(async () => {});
    const { id } = await enqueue(db, null, { kind: "audit_lead", key: "k", maxAttempts: 3 });
    const { id: stuck } = await enqueue(db, null, { kind: "audit_lead", key: "k2", maxAttempts: 3 });
    await db
      .update(jobs)
      .set({ status: "running", startedAt: new Date(Date.now() - 60 * 60_000) })
      .where(eq(jobs.id, stuck as string));
    expect(await sweepJobs(rt)).toBe(2);
    expect(
      queue
        .take()
        .map((s) => s.jobId)
        .sort(),
    ).toEqual([id, stuck].sort());
    expect(await job(stuck as string)).toMatchObject({ status: "failed" });
  });
});
