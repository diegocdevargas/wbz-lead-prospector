import type { Child } from "hono/jsx";

/** Grouped navigation (docs/dashboard.md). A section appears only when its milestone ships. */
const NAV: { group: string; items: [href: string, label: string][] }[] = [
  {
    group: "Prospecting",
    items: [
      ["/campaigns", "Campaigns"],
      ["/leads", "Leads"],
      ["/imports", "Import"],
      ["/dedupe", "Duplicates"],
    ],
  },
  {
    group: "System",
    items: [
      ["/jobs", "Jobs"],
      ["/suppressions", "Opt-outs"],
      ["/settings", "Settings"],
    ],
  },
];

export type FlashMessage = { kind: "ok" | "error"; text: string } | null | undefined;

export function Layout(props: { title: string; active?: string; flash?: FlashMessage; children: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>{props.title} · Prospector</title>
        <link rel="stylesheet" href="/assets/app.css" />
        <script src="/assets/app.js" defer />
      </head>
      <body>
        <a class="skip" href="#main">
          Skip to content
        </a>
        <aside class="sidebar">
          <a class="brand" href="/">
            Prospector
          </a>
          <nav aria-label="Main">
            {NAV.map((g) => (
              <div class="nav-group">
                <div class="nav-title">{g.group}</div>
                {g.items.map(([href, label]) => (
                  <a href={href} aria-current={props.active === href ? "page" : undefined}>
                    {label}
                  </a>
                ))}
              </div>
            ))}
          </nav>
        </aside>
        <main id="main">
          {props.flash && <Flash kind={props.flash.kind}>{props.flash.text}</Flash>}
          {props.children}
        </main>
      </body>
    </html>
  );
}

export function Flash(props: { kind: "ok" | "error"; children: Child }) {
  return (
    <p class={`flash ${props.kind}`} role={props.kind === "error" ? "alert" : "status"}>
      {props.children}
    </p>
  );
}

export const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "";

export const fmtNumber = (n: number | null | undefined, digits = 0) =>
  n == null ? "" : n.toLocaleString("pt-BR", { maximumFractionDigits: digits, minimumFractionDigits: digits });
