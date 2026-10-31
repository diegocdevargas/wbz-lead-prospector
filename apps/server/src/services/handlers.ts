import type { JobKind } from "@wbz/core";
import { runAudit } from "./audit.ts";
import { runDiscoveryQuery } from "./discovery.ts";
import type { JobHandler } from "./jobs.ts";
import { runPrune } from "./prune.ts";

export const JOB_HANDLERS: Record<JobKind, JobHandler> = {
  discover_query: runDiscoveryQuery,
  audit_lead: runAudit,
  prune_expired: (rt) => runPrune(rt),
};
