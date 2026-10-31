export const CSS = `
:root { --fg:#1d1d1f; --muted:#6b6b70; --line:#e3e3e6; --bg:#fafafa; --accent:#0b5cad; --ok:#0f7a3a; --err:#b42318; }
* { box-sizing: border-box; }
body { margin:0; font:14px/1.45 system-ui, -apple-system, Segoe UI, sans-serif; color:var(--fg); background:var(--bg); }
body { display:grid; grid-template-columns:200px 1fr; min-height:100vh; }
.sidebar { background:#fff; border-right:1px solid var(--line); padding:16px 12px; }
.brand { display:block; font-weight:700; color:var(--fg); text-decoration:none; margin:0 8px 16px; }
.nav-group { margin-bottom:16px; display:flex; flex-direction:column; }
.nav-title { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:0 8px 4px; }
.nav-group a { color:var(--fg); text-decoration:none; padding:4px 8px; border-radius:6px; }
.nav-group a:hover { background:var(--bg); }
.nav-group a[aria-current=page] { background:#eef2f7; font-weight:600; }
main { padding:24px; max-width:1200px; min-width:0; }
@media (max-width: 760px) { body { grid-template-columns:1fr; } .sidebar { border-right:0; border-bottom:1px solid var(--line); } .nav-group { flex-direction:row; flex-wrap:wrap; gap:4px; } }
.skip { position:absolute; left:-9999px; } .skip:focus { left:8px; top:8px; background:#fff; padding:8px; z-index:10; }
.sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.page-header { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
.page-header h1 { margin:0; } .actions { display:flex; gap:8px; }
a.button { display:inline-block; padding:6px 12px; border-radius:6px; background:var(--accent); color:#fff; text-decoration:none; border:1px solid var(--accent); }
a.button.secondary { background:#fff; color:var(--fg); border-color:var(--line); }
button:disabled { opacity:.5; cursor:not-allowed; }
.empty { background:#fff; border:1px dashed var(--line); border-radius:8px; padding:24px; text-align:center; color:var(--muted); }
.tabs { display:flex; gap:4px; border-bottom:1px solid var(--line); margin-bottom:16px; }
.tabs a { padding:8px 12px; color:var(--muted); text-decoration:none; border-bottom:2px solid transparent; }
.tabs a[aria-current=page] { color:var(--fg); border-bottom-color:var(--accent); font-weight:600; }
ul.findings { list-style:none; padding:0; margin:0 0 16px; background:#fff; border:1px solid var(--line); border-radius:8px; }
ul.findings li { padding:8px 12px; border-bottom:1px solid var(--line); } ul.findings li:last-child { border-bottom:0; }
.badge.sev-high, .badge.dead, .badge.failed, .badge.stopped_budget, .badge.skipped_budget { background:#fdecea; color:var(--err); }
.badge.sev-medium, .badge.running, .badge.pending { background:#fff4e5; }
.badge.sev-low { background:#eef2f7; }
.badge.succeeded, .badge.done, .badge.ok { background:#e8f5ec; color:var(--ok); }
details.raw { margin-top:16px; } pre { background:#fff; border:1px solid var(--line); border-radius:8px; padding:12px; overflow:auto; font-size:12px; max-height:480px; }
.meter meter { width:90px; vertical-align:middle; }
code { font-family:ui-monospace, monospace; font-size:12px; }
h1 { font-size:20px; margin:0 0 16px; } h2 { font-size:16px; margin:24px 0 8px; }
table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--line); }
th, td { text-align:left; padding:6px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
th { font-weight:600; color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.03em; }
a { color:var(--accent); }
form.inline { display:inline; }
.filters { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; align-items:end; }
label { display:flex; flex-direction:column; gap:2px; font-size:12px; color:var(--muted); }
input, select, textarea, button { font:inherit; padding:6px 8px; border:1px solid var(--line); border-radius:6px; background:#fff; color:var(--fg); }
textarea { width:100%; min-height:160px; font-family:ui-monospace, monospace; }
button { background:var(--accent); color:#fff; border-color:var(--accent); cursor:pointer; }
button.secondary { background:#fff; color:var(--fg); border-color:var(--line); }
button.danger { background:var(--err); border-color:var(--err); }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:12px; }
.card { background:#fff; border:1px solid var(--line); border-radius:8px; padding:12px 16px; }
.card h2 { margin-top:0; }
.muted { color:var(--muted); } .small { font-size:12px; }
.flash { padding:8px 12px; border-radius:6px; } .flash.ok { background:#e8f5ec; color:var(--ok); } .flash.error { background:#fdecea; color:var(--err); }
.badge { display:inline-block; padding:1px 8px; border-radius:999px; background:#eef2f7; font-size:12px; }
.badge.created { background:#e8f5ec; } .badge.merged { background:#eef2f7; } .badge.review { background:#fff4e5; } .badge.suppressed, .badge.invalid { background:#fdecea; }
label.check { flex-direction:row; gap:6px; align-items:center; color:var(--fg); font-size:14px; margin:6px 0; }
textarea.short { min-height:80px; font-family:inherit; }
dl { display:grid; grid-template-columns:max-content 1fr; gap:4px 16px; margin:0; } dt { color:var(--muted); }
.pager { display:flex; gap:12px; margin-top:12px; align-items:center; }
`;
