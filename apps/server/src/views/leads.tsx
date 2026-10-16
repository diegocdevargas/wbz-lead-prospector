import { STAGES } from "@wbz/core";
import type { companies, contacts, fieldSources, importRows, stageEvents } from "@wbz/db";
import { Flash, fmtDate, Layout } from "./layout.tsx";

type Company = typeof companies.$inferSelect;

export interface LeadListProps {
  rows: Pick<Company, "id" | "name" | "city" | "state" | "niche" | "domain" | "stage" | "source" | "createdAt">[];
  total: number;
  page: number;
  pageSize: number;
  filters: Record<string, string>;
  options: { niches: string[]; cities: string[]; sources: readonly string[] };
}

function pageHref(filters: Record<string, string>, page: number) {
  const params = new URLSearchParams({ ...filters, page: String(page) });
  return `/leads?${params}`;
}

export function LeadList(p: LeadListProps) {
  const pages = Math.max(1, Math.ceil(p.total / p.pageSize));
  const select = (name: string, values: readonly string[]) => (
    <select name={name} id={`f-${name}`}>
      <option value="">all</option>
      {values.map((v) => (
        <option value={v} selected={p.filters[name] === v}>
          {v}
        </option>
      ))}
    </select>
  );
  return (
    <Layout title="Leads" active="/leads">
      <h1>Leads ({p.total})</h1>
      <form class="filters" method="get" action="/leads">
        <label>
          Search
          <input type="search" name="q" value={p.filters.q ?? ""} placeholder="name, domain, email" />
        </label>
        <label for="f-stage">
          Stage
          {select("stage", STAGES)}
        </label>
        <label for="f-niche">
          Niche
          {select("niche", p.options.niches)}
        </label>
        <label for="f-city">
          City
          {select("city", p.options.cities)}
        </label>
        <label for="f-source">
          Source
          {select("source", p.options.sources)}
        </label>
        <button type="submit">Filter</button>
        <a href="/leads">Clear</a>
      </form>
      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>City</th>
            <th>Niche</th>
            <th>Domain</th>
            <th>Stage</th>
            <th>Source</th>
            <th>Added</th>
          </tr>
        </thead>
        <tbody>
          {p.rows.length === 0 && (
            <tr>
              <td colspan={7} class="muted">
                No leads yet. <a href="/imports">Import a CSV</a> or <a href="/leads/new">add one</a>.
              </td>
            </tr>
          )}
          {p.rows.map((r) => (
            <tr>
              <td>
                <a href={`/leads/${r.id}`}>{r.name}</a>
              </td>
              <td>{[r.city, r.state].filter(Boolean).join(" / ")}</td>
              <td>{r.niche}</td>
              <td>{r.domain}</td>
              <td>
                <span class="badge">{r.stage}</span>
              </td>
              <td class="small muted">{r.source}</td>
              <td class="small muted">{fmtDate(r.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="pager">
        {p.page > 1 && <a href={pageHref(p.filters, p.page - 1)}>← Previous</a>}
        <span class="muted">
          Page {p.page} of {pages}
        </span>
        {p.page < pages && <a href={pageHref(p.filters, p.page + 1)}>Next →</a>}
      </div>
    </Layout>
  );
}

export interface LeadPageProps {
  company: Company;
  contacts: (typeof contacts.$inferSelect)[];
  sources: (typeof fieldSources.$inferSelect)[];
  events: (typeof stageEvents.$inferSelect)[];
  importRows: (typeof importRows.$inferSelect)[];
  flash?: { kind: "ok" | "error"; text: string } | null;
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
  ["notes", "Notes"],
];

export function LeadPage(p: LeadPageProps) {
  const c = p.company;
  const latestSource = (field: string) => p.sources.find((s) => s.entityType === "company" && s.field === field);
  return (
    <Layout title={c.name} active="/leads">
      <h1>{c.name}</h1>
      {p.flash && <Flash kind={p.flash.kind}>{p.flash.text}</Flash>}
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
    </Layout>
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
