import { PLATFORMS, STAGES } from "@wbz/core";
import type { audits, companies, contacts, fieldSources, findings, importRows, stageEvents } from "@wbz/db";
import { Flash, fmtDate, fmtNumber, Layout } from "./layout.tsx";
import { Badge, EmptyState, FilterBar, KeysetPager, PageHeader } from "./ui.tsx";

type Company = typeof companies.$inferSelect;

export interface LeadListProps {
  rows: Pick<
    Company,
    "id" | "name" | "city" | "state" | "niche" | "domain" | "stage" | "source" | "platform" | "groupId" | "createdAt"
  >[];
  total: number;
  next: string | null;
  isFirst: boolean;
  filters: Record<string, string>;
  options: {
    niches: string[];
    cities: string[];
    sources: readonly string[];
    campaigns: { id: string; name: string }[];
  };
}

export function LeadList(p: LeadListProps) {
  const hasFilters = Object.keys(p.filters).length > 0;
  return (
    <Layout title="Leads" active="/leads">
      <PageHeader
        title="Leads"
        count={p.total}
        actions={
          <>
            <a class="button" href="/leads/new">
              Add lead
            </a>
            <a class="button secondary" href="/imports">
              Import CSV
            </a>
          </>
        }
      />
      <FilterBar
        action="/leads"
        filters={p.filters}
        search={{ placeholder: "name, domain, email" }}
        selects={[
          { name: "stage", label: "Stage", values: STAGES },
          { name: "niche", label: "Niche", values: p.options.niches },
          { name: "city", label: "City", values: p.options.cities },
          { name: "platform", label: "Platform", values: [...PLATFORMS, ["none", "not audited / no site"]] },
          {
            name: "website",
            label: "Website",
            values: [
              ["yes", "has website"],
              ["no", "no website"],
            ],
          },
          {
            name: "campaign",
            label: "Campaign",
            values: p.options.campaigns.map((c) => [c.id, c.name] as [string, string]),
          },
          { name: "source", label: "Source", values: p.options.sources },
        ]}
      />
      {p.rows.length === 0 ? (
        <EmptyState>
          {hasFilters ? (
            <>
              No leads match these filters. <a href="/leads">Clear filters</a>
            </>
          ) : (
            <>
              No leads yet. <a href="/campaigns">Run a campaign</a>, <a href="/imports">import a CSV</a> or{" "}
              <a href="/leads/new">add one</a>.
            </>
          )}
        </EmptyState>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Company</th>
              <th scope="col">City</th>
              <th scope="col">Niche</th>
              <th scope="col">Domain</th>
              <th scope="col">Platform</th>
              <th scope="col">Stage</th>
              <th scope="col">Source</th>
              <th scope="col">Added</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr>
                <td>
                  <a href={`/leads/${r.id}`}>{r.name}</a>
                  {r.groupId && <span class="small muted"> · branch</span>}
                </td>
                <td>{[r.city, r.state].filter(Boolean).join(" / ")}</td>
                <td>{r.niche}</td>
                <td>{r.domain ?? <span class="muted">no site</span>}</td>
                <td class="small">{r.platform}</td>
                <td>
                  <Badge>{r.stage}</Badge>
                </td>
                <td class="small muted">{r.source}</td>
                <td class="small muted">{fmtDate(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <KeysetPager action="/leads" filters={p.filters} next={p.next} isFirst={p.isFirst} />
    </Layout>
  );
}

export interface LeadPageProps {
  company: Company;
  contacts: (typeof contacts.$inferSelect)[];
  sources: (typeof fieldSources.$inferSelect)[];
  events: (typeof stageEvents.$inferSelect)[];
  importRows: (typeof importRows.$inferSelect)[];
  campaigns: { id: string; name: string }[];
  flash?: { kind: "ok" | "error"; text: string } | null;
  tab: "overview" | "audit";
  group: { id: string; name: string; city: string | null; groupId: string | null; stage: string }[];
  audit: { audit: typeof audits.$inferSelect; findings: (typeof findings.$inferSelect)[] } | null;
  auditPending: boolean;
}

const FIELD_LABELS: [keyof Company, string][] = [
  ["city", "City"],
  ["state", "State"],
  ["niche", "Niche"],
  ["websiteUrl", "Website"],
  ["domain", "Domain"],
  ["phoneE164", "Phone"],
  ["email", "Email"],
  ["instagramHandle", "Instagram"],
  ["cnpj", "CNPJ"],
  ["address", "Address"],
  ["googleRating", "Google rating"],
  ["googleReviewCount", "Google reviews"],
  ["notes", "Notes"],
];

export function LeadPage(p: LeadPageProps) {
  const c = p.company;
  return (
    <Layout title={c.name} active="/leads">
      <h1>{c.name}</h1>
      {p.flash && <Flash kind={p.flash.kind}>{p.flash.text}</Flash>}
      <nav class="tabs" aria-label="Lead sections">
        <a href={`/leads/${c.id}`} aria-current={p.tab === "overview" ? "page" : undefined}>
          Overview
        </a>
        <a href={`/leads/${c.id}?tab=audit`} aria-current={p.tab === "audit" ? "page" : undefined}>
          Audit{p.audit ? ` (${p.audit.findings.length})` : ""}
        </a>
      </nav>
      {p.tab === "audit" ? <AuditTab {...p} /> : <Overview {...p} />}
    </Layout>
  );
}

function Overview(p: LeadPageProps) {
  const c = p.company;
  const latestSource = (field: string) => p.sources.find((s) => s.entityType === "company" && s.field === field);
  return (
    <>
      <div class="grid">
        <section class="card">
          <h2>Company</h2>
          <dl>
            {FIELD_LABELS.map(([key, label]) => {
              const value = c[key];
              if (value == null || value === "") return null;
              const src = latestSource(key);
              return (
                <>
                  <dt>{label}</dt>
                  <dd>
                    {String(value)}
                    {src && (
                      <div class="small muted">
                        {src.source} · {fmtDate(src.collectedAt)}
                      </div>
                    )}
                  </dd>
                </>
              );
            })}
          </dl>
        </section>
        <section class="card">
          <h2>Stage</h2>
          <p>
            <span class="badge">{c.stage}</span>
          </p>
          <form method="post" action={`/leads/${c.id}/stage`}>
            <label>
              Move to
              <select name="stage">
                {STAGES.map((s) => (
                  <option value={s} selected={s === c.stage}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Note
              <input name="note" maxlength={500} />
            </label>
            <p>
              <button type="submit">Save stage</button>
            </p>
          </form>
        </section>
        <section class="card">
          <h2>Contacts</h2>
          {p.contacts.length === 0 && <p class="muted">None.</p>}
          {p.contacts.map((ct) => (
            <p>
              <strong>{ct.name}</strong>
              {ct.role && <span class="muted"> · {ct.role}</span>}
              {ct.linkedinUrl && (
                <>
                  <br />
                  <a href={ct.linkedinUrl} rel="noopener noreferrer nofollow" target="_blank">
                    LinkedIn
                  </a>
                </>
              )}
              {ct.notes && <div class="small muted">{ct.notes}</div>}
            </p>
          ))}
        </section>
      </div>

      {p.campaigns.length > 0 && (
        <p class="small muted">
          Found by campaign:{" "}
          {p.campaigns.map((cp, i) => (
            <>
              {i > 0 && ", "}
              <a href={`/campaigns/${cp.id}`}>{cp.name}</a>
            </>
          ))}
        </p>
      )}
      {p.group.length > 0 && (
        <section class="card">
          <h2>Group ({p.group.length} units)</h2>
          <p class="small muted">
            {c.groupId
              ? "This lead is a branch. Outreach goes to the main lead."
              : "This is the group's main lead. Outreach goes here and can mention every unit."}
          </p>
          <ul>
            {p.group.map((m) => (
              <li>
                {m.id === c.id ? <strong>{m.name}</strong> : <a href={`/leads/${m.id}`}>{m.name}</a>}
                {m.city && <span class="muted"> · {m.city}</span>}
                {!m.groupId && <Badge>main</Badge>}
              </li>
            ))}
          </ul>
          <form
            method="post"
            action={`/leads/${c.id}/ungroup`}
            data-confirm={c.groupId ? "Remove this lead from the group?" : "Dissolve the whole group?"}
          >
            <button type="submit" class="secondary">
              {c.groupId ? "Remove from group" : "Dissolve group"}
            </button>
          </form>
        </section>
      )}
      <h2>Timeline</h2>
      <table>
        <tbody>
          {p.events.map((e) => (
            <tr>
              <td class="small muted">{fmtDate(e.createdAt)}</td>
              <td>
                {e.fromStage ? `${e.fromStage} → ` : ""}
                {e.toStage}
              </td>
              <td class="small">{e.actor}</td>
              <td class="small muted">{e.note}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Data sources</h2>
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Value</th>
            <th>Source</th>
            <th>Collected</th>
          </tr>
        </thead>
        <tbody>
          {p.sources.map((s) => (
            <tr>
              <td>
                {s.entityType === "contact" ? "contact." : ""}
                {s.field}
              </td>
              <td>{s.value}</td>
              <td class="small">{s.source}</td>
              <td class="small muted">{fmtDate(s.collectedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Privacy (LGPD)</h2>
      <div class="card">
        <p>
          <a href={`/leads/${c.id}/export`}>Download everything stored about this lead (JSON)</a>
        </p>
        <form method="post" action={`/leads/${c.id}/delete`}>
          <label class="check">
            <input type="checkbox" name="suppress" value="1" checked />
            Also add its email, phone, domain and CNPJ to opt-outs so it is never imported again
          </label>
          <label class="check">
            <input type="checkbox" name="confirm" value="1" required />I understand this permanently deletes the lead
          </label>
          <p>
            <button class="danger" type="submit">
              Delete lead
            </button>
          </p>
        </form>
      </div>
    </>
  );
}

const SEVERITY_LABEL = { high: "high", medium: "medium", low: "low" } as const;

function AuditTab(p: LeadPageProps) {
  const c = p.company;
  const rerun = (
    <form method="post" action={`/leads/${c.id}/audit`} class="inline">
      <button type="submit" class="secondary" disabled={p.auditPending}>
        {p.auditPending ? "Audit queued…" : p.audit ? "Re-run audit" : "Run audit"}
      </button>
    </form>
  );
  if (!p.audit) {
    return (
      <EmptyState>
        <p>Not audited yet.{p.auditPending ? " An audit is queued; refresh in a minute." : ""}</p>
        {rerun}
      </EmptyState>
    );
  }
  const a = p.audit.audit;
  const ps = a.pagespeed as {
    score: number | null;
    lcpMs: number | null;
    cls: number | null;
    inpMs: number | null;
  } | null;
  const html = a.htmlChecks as Record<string, unknown> | null;
  const reviews = a.reviewSignals as { reviewed: number; counts: Record<string, number> } | null;
  return (
    <>
      <p class="muted small">
        Audited {fmtDate(a.finishedAt)} · status <Badge>{a.status}</Badge>
        {a.finalUrl && (
          <>
            {" "}
            · <span>{a.finalUrl}</span>
          </>
        )}{" "}
        {rerun}
      </p>
      <h2>Findings</h2>
      {p.audit.findings.length === 0 ? (
        <p class="muted">No findings: nothing obvious to fix.</p>
      ) : (
        <ul class="findings">
          {p.audit.findings.map((f) => (
            <li>
              <Badge kind={`sev-${f.severity}`}>{SEVERITY_LABEL[f.severity]}</Badge> <Badge>{f.offer}</Badge> {f.text}
            </li>
          ))}
        </ul>
      )}
      <div class="grid">
        <section class="card">
          <h2>PageSpeed (mobile)</h2>
          {ps ? (
            <dl>
              <dt>Performance</dt>
              <dd>{ps.score ?? "?"}/100</dd>
              <dt>LCP</dt>
              <dd>{ps.lcpMs != null ? `${fmtNumber(ps.lcpMs / 1000, 1)} s` : "n/a"}</dd>
              <dt>CLS</dt>
              <dd>{ps.cls != null ? fmtNumber(ps.cls, 2) : "n/a"}</dd>
              <dt>INP (real users)</dt>
              <dd>{ps.inpMs != null ? `${Math.round(ps.inpMs)} ms` : "not enough Chrome data"}</dd>
            </dl>
          ) : (
            <p class="muted">Not run{a.status === "ok" ? " (no API key, or it failed)" : ""}.</p>
          )}
        </section>
        <section class="card">
          <h2>Site</h2>
          {html ? (
            <dl>
              <dt>Platform</dt>
              <dd>{a.platform}</dd>
              <dt>HTTPS</dt>
              <dd>{html.https ? "yes" : "no"}</dd>
              <dt>Mobile viewport</dt>
              <dd>{html.viewport ? "yes" : "no"}</dd>
              <dt>Title</dt>
              <dd>{String(html.title ?? "missing")}</dd>
              <dt>H1 count</dt>
              <dd>{String(html.h1Count)}</dd>
              <dt>WhatsApp link</dt>
              <dd>{html.whatsapp ? "yes" : "no"}</dd>
              <dt>Online booking</dt>
              <dd>{(html.booking as string[]).join(", ") || "none"}</dd>
              <dt>Contact form</dt>
              <dd>{html.contactForm ? "yes" : "no"}</dd>
              <dt>Chat widget</dt>
              <dd>{(html.chatWidgets as string[]).join(", ") || "none"}</dd>
              <dt>Copyright year</dt>
              <dd>{String(html.copyrightYear ?? "not found")}</dd>
              <dt>Broken links</dt>
              <dd>{a.brokenLinks ? `${a.brokenLinks.broken.length} of ${a.brokenLinks.checked} checked` : "n/a"}</dd>
            </dl>
          ) : (
            <p class="muted">
              {a.status === "no_website" ? "No website on record." : `Could not load the site: ${a.error ?? a.status}.`}
            </p>
          )}
        </section>
        <section class="card">
          <h2>Google reviews</h2>
          {reviews ? (
            <dl>
              <dt>Reviews read</dt>
              <dd>{reviews.reviewed}</dd>
              {Object.entries(reviews.counts).map(([k, v]) => (
                <>
                  <dt>{k.replace("_", " ")}</dt>
                  <dd>{v}</dd>
                </>
              ))}
            </dl>
          ) : (
            <p class="muted">Not checked.</p>
          )}
          <p class="small muted">Only counts are kept; review text and names are not stored.</p>
        </section>
      </div>
      <details class="raw">
        <summary>Raw audit data</summary>
        <pre>
          {JSON.stringify(
            {
              htmlChecks: html,
              pagespeed: ps,
              brokenLinks: a.brokenLinks,
              reviews,
              notes: (a.raw as { notes?: string[] } | null)?.notes,
            },
            null,
            2,
          )}
        </pre>
        {a.rawPrunedAt && <p class="small muted">HTML excerpt deleted on {fmtDate(a.rawPrunedAt)} (retention).</p>}
      </details>
    </>
  );
}

export function NewLeadPage(p: { error?: string | null; values?: Record<string, string> }) {
  const v = p.values ?? {};
  const field = (name: string, label: string, attrs: Record<string, unknown> = {}) => (
    <label>
      {label}
      <input name={name} value={v[name] ?? ""} {...attrs} />
    </label>
  );
  return (
    <Layout title="Add lead" active="/leads/new">
      <h1>Add a lead</h1>
      <p class="muted">For businesses you found on LinkedIn, Workana, events or referrals. Company is required.</p>
      {p.error && <Flash kind="error">{p.error}</Flash>}
      <form method="post" action="/leads/new" class="card">
        <div class="grid">
          {field("company", "Company *", { required: true, maxlength: 200 })}
          {field("niche", "Niche", { maxlength: 120 })}
          {field("city", "City", { maxlength: 120 })}
          {field("state", "State (UF)", { maxlength: 2 })}
          {field("website", "Website", { maxlength: 500 })}
          {field("email", "Business email", { type: "email", maxlength: 254 })}
          {field("phone", "Business phone", { maxlength: 40 })}
          {field("instagram", "Instagram", { maxlength: 200 })}
          {field("cnpj", "CNPJ", { maxlength: 30 })}
          {field("name", "Contact name", { maxlength: 120 })}
          {field("role", "Contact role", { maxlength: 120 })}
          {field("linkedin", "Contact LinkedIn URL", { maxlength: 500 })}
        </div>
        <label>
          Notes
          <textarea name="notes" maxlength={2000} class="short">
            {v.notes ?? ""}
          </textarea>
        </label>
        <p>
          <button type="submit">Add lead</button>
        </p>
      </form>
    </Layout>
  );
}
