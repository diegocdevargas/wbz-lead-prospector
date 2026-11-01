/**
 * The only script on the dashboard, served from /assets/app.js (no inline
 * scripts, so the CSP stays strict). Progressive enhancement only: every page
 * works without it.
 */
export const APP_JS = `(() => {
  "use strict";
  const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  // Filters submit when a select changes.
  document.querySelectorAll("form[data-autosubmit] select").forEach((s) =>
    s.addEventListener("change", () => s.form && s.form.requestSubmit()),
  );

  // Dangerous actions: <form data-confirm="Are you sure?">.
  document.querySelectorAll("form[data-confirm]").forEach((f) =>
    f.addEventListener("submit", (e) => {
      if (!window.confirm(f.dataset.confirm)) e.preventDefault();
    }),
  );

  // A form submits once: its buttons are disabled after the first submit (double-click guard).
  document.querySelectorAll('form[method="post"]').forEach((f) =>
    f.addEventListener("submit", (e) => {
      if (e.defaultPrevented) return;
      if (f.dataset.sent) { e.preventDefault(); return; }
      f.dataset.sent = "1";
      setTimeout(() => f.querySelectorAll("button").forEach((b) => (b.disabled = true)), 0);
    }),
  );

  // Shortcuts: "/" focuses search; "g" then c/l/i/d/j/o/s goes to a section. Never while typing.
  const GO = { c: "/campaigns", l: "/leads", i: "/imports", d: "/dedupe", j: "/jobs", o: "/suppressions", s: "/settings" };
  let pendingG = 0;
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(document.activeElement)) return;
    if (e.key === "/") {
      const q = document.querySelector('input[type="search"]');
      if (q) { e.preventDefault(); q.focus(); }
      return;
    }
    if (e.key === "g") { pendingG = Date.now(); return; }
    if (pendingG && Date.now() - pendingG < 1500 && GO[e.key]) { window.location.href = GO[e.key]; }
    pendingG = 0;
  });
})();
`;
