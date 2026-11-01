import type { JobKind } from "@wbz/core";
import { logError } from "../lib/log.ts";
import { type JobHandler, runJob } from "./jobs.ts";
import type { JobQueue, Runtime } from "./runtime.ts";

/**
 * Local dev queue: runs jobs in this process, at most `concurrency` at a
 * time. Delays use timers; anything lost on restart is picked up by the
 * sweep, because the jobs table is the source of truth.
 */
export class MemoryQueue implements JobQueue {
  private running = 0;
  private readonly waiting: string[] = [];
  private rt: Runtime | null = null;

  constructor(
    private readonly handlers: Record<JobKind, JobHandler>,
    private readonly concurrency = 2,
  ) {}

  bind(rt: Runtime) {
    this.rt = rt;
  }

  async send(jobId: string, delaySeconds = 0, urgent = false) {
    if (delaySeconds > 0) {
      setTimeout(() => this.push(jobId, urgent), delaySeconds * 1000).unref?.();
    } else {
      this.push(jobId, urgent);
    }
  }

  private push(jobId: string, urgent: boolean) {
    const at = this.waiting.indexOf(jobId);
    if (at >= 0) this.waiting.splice(at, 1);
    if (urgent) this.waiting.unshift(jobId);
    else this.waiting.push(jobId);
    this.pump();
  }

  /** Ids waiting to run, in order (for tests). */
  get pending(): readonly string[] {
    return this.waiting;
  }

  private pump() {
    while (this.rt && this.running < this.concurrency && this.waiting.length) {
      const id = this.waiting.shift() as string;
      this.running++;
      runJob(this.rt, id, this.handlers)
        .catch((err) => logError(err, { job: id }))
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }
}
