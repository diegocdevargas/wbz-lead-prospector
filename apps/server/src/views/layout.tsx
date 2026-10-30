import type { Child } from "hono/jsx";

const NAV = [
  ["/leads", "Leads"],
  ["/leads/new", "Add lead"],
  ["/imports", "Imports"],
  ["/dedupe", "Duplicates"],
  ["/suppressions", "Opt-outs"],
] as const;

export function Layout(props: { title: string; active?: string; children: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>{props.title} · Webcraftz Prospector</title>
        <link rel="stylesheet" href="/assets/app.css" />
      </head>
      <body>
        <header>
          <strong>Webcraftz Prospector</strong>
          <nav>
            {NAV.map(([href, label]) => (
              <a href={href} aria-current={props.active === href ? "page" : undefined}>
                {label}
              </a>
            ))}
          </nav>
        </header>
        <main>{props.children}</main>
      </body>
    </html>
  );
}

export function Flash(props: { kind: "ok" | "error"; children: Child }) {
  return <p class={`flash ${props.kind}`}>{props.children}</p>;
}

export const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "";
