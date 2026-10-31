import { JOB_KINDS, JOB_STATUSES, type JobStatus } from "@wbz/core";
import type { jobs } from "@wbz/db";
import { type FlashMessage, fmtDate, Layout } from "./layout.tsx";
import { Badge, EmptyState, FilterBar, KeysetPager, PageHeader } from "./ui.tsx";

export function JobsPage(p: {
  rows: (typeof jobs.$inferSelect)[];
  counts: Partial<Record<JobStatus, number>>;
  filters: Record<string, string>;
  next: string | null;
  isFirst: boolean;
  flash?: FlashMessage;
}) {
  return (
    <Layout title="Jobs" active="/jobs" flash={p.flash}>
      <PageHeader title="Jobs" />
      <p class="small">
        {JOB_STATUSES.map((s) => (
          <>
            <a href={`/jobs?status=${s}`}>
              <Badge kind={s}>
                {s}: {p.counts[s] ?? 0}
              </Badge>
            </a>{" "}
          </>
        ))}
      </p>
      <FilterBar
        action="/jobs"
        filters={p.filters}
        selects={[
          { name: "status", label: "Status", values: JOB_STATUSES },
          { name: "kind", label: "Kind", values: JOB_KINDS },
        ]}
      />
      {p.rows.length === 0 ? (
        <EmptyState>No jobs{Object.keys(p.filters).length ? " match these filters" : " yet"}.</EmptyState>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Kind</th>
              <th scope="col">Status</th>
              <th scope="col">Attempts</th>
              <th scope="col">Target</th>
              <th scope="col">Next run / finished</th>
              <th scope="col">Last error</th>
              <th scope="col">
                <span class="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((j) => (
              <tr>
                <td>{j.kind}</td>
                <td>
                  <Badge kind={j.status}>{j.status}</Badge>
                </td>
                <td>
                  {j.attempts} / {j.maxAttempts}
                </td>
                <td class="small">
                  <Target payload={j.payload} />
                </td>
                <td class="small muted">
                  {j.status === "pending" || j.status === "failed" ? fmtDate(j.runAfter) : fmtDate(j.finishedAt)}
                </td>
                <td class="small">{j.lastError}</td>
                <td>
                  {(j.status === "failed" || j.status === "dead") && (
                    <form method="post" action={`/jobs/${j.id}/retry`} class="inline">
                      <button type="submit" class="secondary">
                        Retry now
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <KeysetPager action="/jobs" filters={p.filters} next={p.next} isFirst={p.isFirst} />
    </Layout>
  );
}

function Target(p: { payload: Record<string, unknown> }) {
  if (typeof p.payload.companyId === "string") return <a href={`/leads/${p.payload.companyId}?tab=audit`}>lead</a>;
  if (typeof p.payload.queryId === "string") return <span>discovery page</span>;
  return <span class="muted">—</span>;
}
