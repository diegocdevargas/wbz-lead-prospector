import type { Child } from "hono/jsx";

/** Shared pieces of the app shell v2: page header, filter bar, empty state, keyset pager, badges. */

export function PageHeader(props: { title: string; count?: number | undefined; actions?: Child }) {
  return (
    <div class="page-header">
      <h1>
        {props.title}
        {props.count != null && <span class="muted"> ({props.count})</span>}
      </h1>
      {props.actions && <div class="actions">{props.actions}</div>}
    </div>
  );
}

export interface SelectFilter {
  name: string;
  label: string;
  values: readonly (string | [value: string, label: string])[];
}

/** GET form; filters live in the query string so a view can be bookmarked. `data-autosubmit` submits on change (app.js). */
export function FilterBar(props: {
  action: string;
  filters: Record<string, string>;
  selects: SelectFilter[];
  search?: { placeholder: string };
}) {
  return (
    <form class="filters" method="get" action={props.action} data-autosubmit>
      {props.search && (
        <label>
          Search
          <input type="search" name="q" value={props.filters.q ?? ""} placeholder={props.search.placeholder} />
        </label>
      )}
      {props.selects.map((s) => (
        <label>
          {s.label}
          <select name={s.name}>
            <option value="">all</option>
            {s.values.map((v) => {
              const [value, label] = Array.isArray(v) ? v : [v, v];
              return (
                <option value={value} selected={props.filters[s.name] === value}>
                  {label}
                </option>
              );
            })}
          </select>
        </label>
      ))}
      <button type="submit">Filter</button>
      <a href={props.action}>Clear</a>
    </form>
  );
}

export function EmptyState(props: { children: Child }) {
  return <div class="empty">{props.children}</div>;
}

/** Cursor = "<epoch ms>.<uuid>" of the last row: no PII, stable under inserts. */
export function encodeCursor(t: Date, id: string) {
  return `${t.getTime()}.${id}`;
}

export function decodeCursor(raw: string | undefined): { t: Date; id: string } | undefined {
  const m = raw ? /^(\d{1,15})\.([0-9a-f-]{36})$/.exec(raw) : null;
  return m ? { t: new Date(Number(m[1])), id: m[2] as string } : undefined;
}

export function KeysetPager(props: {
  action: string;
  filters: Record<string, string>;
  next: string | null;
  isFirst: boolean;
}) {
  const params = (extra: Record<string, string>) => new URLSearchParams({ ...props.filters, ...extra }).toString();
  return (
    <nav class="pager" aria-label="Pagination">
      {!props.isFirst && <a href={`${props.action}?${params({})}`}>« First page</a>}
      {props.next && <a href={`${props.action}?${params({ after: props.next })}`}>Next page »</a>}
    </nav>
  );
}

export function Badge(props: { kind?: string; children: Child }) {
  return <span class={`badge ${props.kind ?? ""}`}>{props.children}</span>;
}
