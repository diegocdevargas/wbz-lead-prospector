import type { campaigns, discoveryQueries } from "@wbz/db";
import { type FlashMessage, fmtDate, fmtNumber, Layout } from "./layout.tsx";
import { Badge, EmptyState, PageHeader } from "./ui.tsx";

type Campaign = typeof campaigns.$inferSelect;

export function CampaignsPage(p: {
  rows: { campaign: Campaign; leads: number; audited: number }[];
  discoveryEnabled: boolean;
  flash?: FlashMessage;
}) {
  return (
    <Layout title="Campaigns" active="/campaigns" flash={p.flash}>
      <PageHeader
        title="Campaigns"
        count={p.rows.length}
        actions={
          <a class="button" href="/campaigns/new">
            New campaign
          </a>
        }
      />
      {!p.discoveryEnabled && <DiscoveryOff />}
      {p.rows.length === 0 ? (
        <EmptyState>
          No campaigns yet. A campaign is one niche searched in a list of cities on Google Maps.{" "}
          <a href="/campaigns/new">Create the first one</a>.
        </EmptyState>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Campaign</th>
              <th scope="col">Niche</th>
              <th scope="col">Cities</th>
              <th scope="col">Status</th>
              <th scope="col">Leads</th>
              <th scope="col">Audited</th>
              <th scope="col">Places requests</th>
              <th scope="col">Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map(({ campaign: c, leads, audited }) => (
              <tr>
                <td>
                  <a href={`/campaigns/${c.id}`}>{c.name}</a>
                </td>
                <td>{c.niche}</td>
                <td class="small">{c.cities.join(", ")}</td>
                <td>
                  <Badge kind={c.status}>{c.status}</Badge>
                </td>
                <td>{leads}</td>
                <td>{audited}</td>
                <td>
                  <Meter used={c.placesRequestsUsed} cap={c.placesRequestCap} />
                </td>
                <td>US$ {fmtNumber(c.estCostUsd, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  );
}

function DiscoveryOff() {
  return (
    <p class="flash error" role="alert">
      GOOGLE_API_KEY is not set, so discovery and PageSpeed are off. Campaigns can be created but not run. See README.
    </p>
  );
}

/** Used vs cap as a bar (inline SVG would need a style attr; a <meter> is native and accessible). */
function Meter(p: { used: number; cap: number }) {
  return (
    <span class="meter">
      <meter min={0} max={p.cap} value={p.used} high={p.cap * 0.8} optimum={0} aria-label="Places requests used" />{" "}
      {p.used} / {p.cap}
    </span>
  );
}

export interface CampaignFormValues {
  name?: string;
  niche?: string;
  queryTemplate?: string;
  cities?: string;
  placesRequestCap?: string;
}

export function NewCampaignPage(p: {
  values: CampaignFormValues;
  error?: string | null;
  defaultCap: number;
  maxPages: number;
}) {
  const v = p.values;
  return (
    <Layout title="New campaign" active="/campaigns" flash={p.error ? { kind: "error", text: p.error } : null}>
      <h1>New campaign</h1>
      <form method="post" action="/campaigns" class="card">
        <div class="grid">
          <label>
            Name *
            <input
              name="name"
              required
              maxlength={120}
              value={v.name ?? ""}
              placeholder="Dentistas Serra/Oeste 2026-11"
            />
          </label>
          <label>
            Niche (as people search it) *
            <input name="niche" required maxlength={120} value={v.niche ?? ""} placeholder="clínica odontológica" />
          </label>
          <label>
            Query template
            <input name="queryTemplate" maxlength={200} value={v.queryTemplate ?? "{niche} em {city}"} />
          </label>
          <label>
            Places request cap *
            <input
              name="placesRequestCap"
              type="number"
              min={1}
              max={5000}
              required
              value={v.placesRequestCap ?? String(p.defaultCap)}
            />
          </label>
        </div>
        <label>
          Cities, one per line (add the UF to avoid homonyms) *
          <textarea name="cities" class="short" required maxlength={4000}>
            {v.cities ?? ""}
          </textarea>
        </label>
        <p class="small muted">
          Each city costs up to {p.maxPages} Text Search requests (20 results each), plus one Place Details request per
          lead for review signals. Requests stop at the cap. Google gives a free monthly allowance per SKU; the cost
          shown is list price.
        </p>
        <p>
          <button type="submit">Create campaign</button> <a href="/campaigns">Cancel</a>
        </p>
      </form>
    </Layout>
  );
}

export function CampaignPage(p: {
  campaign: Campaign;
  queries: (typeof discoveryQueries.$inferSelect)[];
  stats: { leads: number; audited: number; withSite: number };
  platforms: { platform: string | null; n: number }[];
  discoveryEnabled: boolean;
  maxPages: number;
  flash?: FlashMessage;
}) {
  const c = p.campaign;
  const pending = p.queries.filter((q) => q.status === "pending").length;
  return (
    <Layout title={c.name} active="/campaigns" flash={p.flash}>
      <PageHeader
        title={c.name}
        actions={
          <form method="post" action={`/campaigns/${c.id}/run`} class="inline">
            <button
              type="submit"
              disabled={!p.discoveryEnabled || pending > 0 || c.placesRequestsUsed >= c.placesRequestCap}
              title={pending > 0 ? "Discovery is still running" : undefined}
            >
              {pending > 0 ? "Running…" : p.queries.some((q) => q.page === 1) ? "Run new cities" : "Run discovery"}
            </button>
          </form>
        }
      />
      {!p.discoveryEnabled && <DiscoveryOff />}
      {c.status === "stopped_budget" && (
        <p class="flash error" role="alert">
          Stopped: the Places request cap was reached. Raise it below to continue.
        </p>
      )}
      {pending > 0 && (
        <p class="muted">
          {pending} page(s) of results still queued. Each city is searched in pages of 20 results (up to {p.maxPages});
          pages run before the site audits. Refresh to update.
        </p>
      )}
      <div class="grid">
        <section class="card">
          <h2>Setup</h2>
          <dl>
            <dt>Niche</dt>
            <dd>{c.niche}</dd>
            <dt>Query</dt>
            <dd>
              <code>{c.queryTemplate}</code>
            </dd>
            <dt>Cities</dt>
            <dd>{c.cities.join(", ")}</dd>
            <dt>Status</dt>
            <dd>
              <Badge kind={c.status}>{c.status}</Badge>
            </dd>
            <dt>Created</dt>
            <dd>{fmtDate(c.createdAt)}</dd>
          </dl>
        </section>
        <section class="card">
          <h2>Results</h2>
          <dl>
            <dt>Leads</dt>
            <dd>
              <a href={`/leads?campaign=${c.id}`}>{p.stats.leads}</a>
            </dd>
            <dt>With website</dt>
            <dd>{p.stats.withSite}</dd>
            <dt>Without website</dt>
            <dd>
              <a href={`/leads?campaign=${c.id}&website=no`}>{p.stats.leads - p.stats.withSite}</a>
            </dd>
            <dt>Audited</dt>
            <dd>{p.stats.audited}</dd>
            {p.platforms
              .filter((x) => x.platform)
              .map((x) => (
                <>
                  <dt>{x.platform}</dt>
                  <dd>
                    <a href={`/leads?campaign=${c.id}&platform=${x.platform}`}>{x.n}</a>
                  </dd>
                </>
              ))}
          </dl>
        </section>
        <section class="card">
          <h2>Budget</h2>
          <dl>
            <dt>Places requests</dt>
            <dd>
              <Meter used={c.placesRequestsUsed} cap={c.placesRequestCap} />
            </dd>
            <dt>Est. cost</dt>
            <dd>US$ {fmtNumber(c.estCostUsd, 2)} (list price)</dd>
          </dl>
          <form method="post" action={`/campaigns/${c.id}/cap`}>
            <label>
              New cap
              <input
                type="number"
                name="placesRequestCap"
                min={Math.max(1, c.placesRequestsUsed)}
                max={5000}
                value={String(c.placesRequestCap)}
              />
            </label>
            <p>
              <button type="submit" class="secondary">
                Save cap
              </button>
            </p>
          </form>
        </section>
      </div>
      <h2>Queries</h2>
      {p.queries.length === 0 ? (
        <EmptyState>Not run yet.</EmptyState>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">City</th>
              <th scope="col">Page (20 results each)</th>
              <th scope="col">Query</th>
              <th scope="col">Status</th>
              <th scope="col">Results</th>
              <th scope="col">New</th>
              <th scope="col">Already known</th>
              <th scope="col">Import</th>
            </tr>
          </thead>
          <tbody>
            {p.queries.map((q) => (
              <tr>
                <td>{q.city}</td>
                <td>{q.page}</td>
                <td class="small">{q.query}</td>
                <td>
                  <Badge kind={q.status}>{q.status}</Badge>
                </td>
                <td>{q.resultCount ?? ""}</td>
                <td>{q.status === "done" ? q.created : ""}</td>
                <td>{q.status === "done" ? q.merged : ""}</td>
                <td>{q.importId && <a href={`/imports/${q.importId}`}>rows</a>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  );
}
