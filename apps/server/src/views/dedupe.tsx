import type { listDedupeQueue } from "../services/leads.ts";
import { Flash, Layout } from "./layout.tsx";

type Item = Awaited<ReturnType<typeof listDedupeQueue>>[number];

const RULE_TEXT: Record<Item["rule"], string> = {
  domain_city_mismatch: "Same website domain, different city (maybe another branch)",
  phone_name_mismatch: "Same phone, different-looking name",
  fuzzy_name_city: "Similar name in the same city",
};

const SHOWN = [
  "name",
  "city",
  "state",
  "niche",
  "domain",
  "phoneE164",
  "email",
  "cnpj",
  "instagramHandle",
  "source",
] as const;

export function DedupePage(p: { items: Item[]; flash?: string | null }) {
  return (
    <Layout title="Duplicates" active="/dedupe">
      <h1>Possible duplicates ({p.items.length})</h1>
      {p.flash && <Flash kind="ok">{p.flash}</Flash>}
      {p.items.length === 0 && <p class="muted">Nothing to review.</p>}
      {p.items.length > 0 && (
        <p class="muted small">
          Merge: the same business, keep one lead. Same group: another unit of the same business (a branch); both stay,
          linked, and outreach goes to the main lead only. Not a duplicate: unrelated businesses.
        </p>
      )}
      {p.items.map((it) => (
        <section class="card">
          <p>
            <strong>{RULE_TEXT[it.rule]}</strong>
            {it.similarity != null && <span class="muted"> · similarity {it.similarity.toFixed(2)}</span>}
          </p>
          <table>
            <thead>
              <tr>
                <th />
                <th>
                  Existing: <a href={`/leads/${it.a.id}`}>{it.a.name}</a>
                </th>
                <th>
                  New: <a href={`/leads/${it.b.id}`}>{it.b.name}</a>
                </th>
              </tr>
            </thead>
            <tbody>
              {SHOWN.map((k) => (
                <tr>
                  <td class="muted small">{k}</td>
                  <td>{it.a[k] ?? ""}</td>
                  <td>{it.b[k] ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            <form class="inline" method="post" action={`/dedupe/${it.id}/merge`}>
              <button type="submit">Merge new into existing</button>
            </form>{" "}
            <form class="inline" method="post" action={`/dedupe/${it.id}/group`}>
              <button class="secondary" type="submit">
                Same group (branch)
              </button>
            </form>{" "}
            <form class="inline" method="post" action={`/dedupe/${it.id}/dismiss`}>
              <button class="secondary" type="submit">
                Not a duplicate
              </button>
            </form>
          </p>
        </section>
      ))}
    </Layout>
  );
}
