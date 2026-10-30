import { LEAD_FIELDS } from "@wbz/core";
import type { importRows, imports } from "@wbz/db";
import type { ImportReport } from "../services/import.ts";
import { Flash, fmtDate, Layout } from "./layout.tsx";

export function ImportsPage(p: { imports: (typeof imports.$inferSelect)[]; error?: string | null }) {
  return (
    <Layout title="Imports" active="/imports">
      <h1>Import leads</h1>
      {p.error && <Flash kind="error">{p.error}</Flash>}
      <div class="grid">
        <form class="card" method="post" action="/imports/preview" enctype="multipart/form-data">
          <h2>Upload a CSV</h2>
          <p class="small muted">Comma, semicolon or tab separated, first row is the header. Max 5 MB.</p>
          <input type="file" name="file" accept=".csv,.tsv,.txt,text/csv" required />
          <p>
            <button type="submit">Preview</button>
          </p>
        </form>
        <form class="card" method="post" action="/imports/preview">
          <h2>Paste rows</h2>
          <p class="small muted">Copy from a spreadsheet, including the header row.</p>
          <textarea name="paste" required />
          <p>
            <button type="submit">Preview</button>
          </p>
        </form>
      </div>
      <h2>History</h2>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Source</th>
            <th>File</th>
            <th>Rows</th>
            <th>Created</th>
            <th>Merged</th>
            <th>Review</th>
            <th>Opt-out</th>
            <th>Invalid</th>
          </tr>
        </thead>
        <tbody>
          {p.imports.map((i) => (
            <tr>
              <td>
                <a href={`/imports/${i.id}`}>{fmtDate(i.createdAt)}</a>
              </td>
              <td class="small">{i.source}</td>
              <td class="small">{i.filename}</td>
              <td>{i.rowCount}</td>
              <td>{i.created}</td>
              <td>{i.merged}</td>
              <td>{i.review}</td>
              <td>{i.suppressed}</td>
              <td>{i.invalid}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
}

function Counts(p: { counts: ImportReport["counts"] }) {
  return (
    <p>
      {Object.entries(p.counts).map(([k, v]) => (
        <span class={`badge ${k}`}>
          {k}: {v}{" "}
        </span>
      ))}
    </p>
  );
}

export function PreviewPage(p: {
  source: "manual_csv" | "manual_paste";
  filename: string | null;
  content: string;
  headers: string[];
  mapping: Record<number, string | null>;
  report: ImportReport;
}) {
  return (
    <Layout title="Import preview" active="/imports">
      <h1>Preview{p.filename ? `: ${p.filename}` : ""}</h1>
      <p class="muted">
        Nothing has been saved yet. This is exactly what the import will do with the column mapping below.
      </p>
      {p.report.previousImportId && (
        <Flash kind="error">
          This exact file was imported before (<a href={`/imports/${p.report.previousImportId}`}>see it</a>). Importing
          again only merges into the same leads.
        </Flash>
      )}
      <Counts counts={p.report.counts} />
      <form method="post" action="/imports/preview" class="card" enctype="multipart/form-data">
        <input type="hidden" name="source" value={p.source} />
        <input type="hidden" name="filename" value={p.filename ?? ""} />
        <textarea name="content" hidden>
          {p.content}
        </textarea>
        <h2>Column mapping</h2>
        <div class="grid">
          {p.headers.map((h, i) => (
            <label>
              {h || `(column ${i + 1})`}
              <select name={`map_${i}`}>
                <option value="">ignore</option>
                {LEAD_FIELDS.map((f) => (
                  <option value={f} selected={p.mapping[i] === f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <p>
          <button class="secondary" type="submit">
            Update preview
          </button>{" "}
          <button type="submit" formaction="/imports/commit">
            Import {p.report.rows.length} rows
          </button>
        </p>
      </form>
      <h2>Rows</h2>
      <RowsTable rows={p.report.rows} />
    </Layout>
  );
}

function RowsTable(p: {
  rows: {
    rowNumber: number;
    outcome: string;
    companyName: string | null;
    companyId: string | null;
    messages: string[];
  }[];
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Outcome</th>
          <th>Company</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        {p.rows.map((r) => (
          <tr>
            <td>{r.rowNumber}</td>
            <td>
              <span class={`badge ${r.outcome}`}>{r.outcome}</span>
            </td>
            <td>
              {r.companyId && r.outcome !== "suppressed" ? (
                <a href={`/leads/${r.companyId}`}>{r.companyName}</a>
              ) : (
                r.companyName
              )}
            </td>
            <td class="small muted">{r.messages.join("; ")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ImportDetailPage(p: {
  imp: typeof imports.$inferSelect;
  rows: (typeof importRows.$inferSelect & { companyName: string | null })[];
}) {
  const { imp } = p;
  return (
    <Layout title="Import" active="/imports">
      <h1>Import of {fmtDate(imp.createdAt)}</h1>
      <p class="muted">
        {imp.source}
        {imp.filename ? ` · ${imp.filename}` : ""} · {imp.rowCount} rows
      </p>
      <Counts
        counts={{
          created: imp.created,
          merged: imp.merged,
          review: imp.review,
          suppressed: imp.suppressed,
          invalid: imp.invalid,
        }}
      />
      {imp.review > 0 && (
        <p>
          <a href="/dedupe">Review possible duplicates →</a>
        </p>
      )}
      <RowsTable
        rows={p.rows.map((r) => ({
          rowNumber: r.rowNumber,
          outcome: r.outcome,
          companyId: r.companyId,
          companyName: r.companyName ?? r.raw?.company ?? null,
          messages: r.messages,
        }))}
      />
    </Layout>
  );
}
