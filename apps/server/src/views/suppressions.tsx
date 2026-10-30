import { SUPPRESSION_KINDS } from "@wbz/core";
import type { suppressions } from "@wbz/db";
import { Flash, fmtDate, Layout } from "./layout.tsx";

export function SuppressionsPage(p: {
  rows: (typeof suppressions.$inferSelect)[];
  flash?: { kind: "ok" | "error"; text: string } | null;
}) {
  return (
    <Layout title="Opt-outs" active="/suppressions">
      <h1>Opt-outs</h1>
      <p class="muted">
        Checked before every import (and, from M3, before every draft). Values are stored only as keyed hashes, so this
        list cannot be read back, only matched against.
      </p>
      {p.flash && <Flash kind={p.flash.kind}>{p.flash.text}</Flash>}
      <form method="post" action="/suppressions" class="card filters">
        <label>
          Type
          <select name="kind">
            {SUPPRESSION_KINDS.map((k) => (
              <option value={k}>{k}</option>
            ))}
          </select>
        </label>
        <label>
          Value
          <input name="value" required maxlength={254} />
        </label>
        <label>
          Reason
          <input name="reason" required maxlength={200} placeholder="replied 'remover'" />
        </label>
        <button type="submit">Add opt-out</button>
      </form>
      <h2>{p.rows.length} entries</h2>
      <table>
        <thead>
          <tr>
            <th>Added</th>
            <th>Type</th>
            <th>Reason</th>
            <th>Hash</th>
          </tr>
        </thead>
        <tbody>
          {p.rows.map((r) => (
            <tr>
              <td class="small">{fmtDate(r.createdAt)}</td>
              <td>{r.kind}</td>
              <td>{r.reason}</td>
              <td class="small muted">{r.valueHash.slice(0, 12)}…</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
}
