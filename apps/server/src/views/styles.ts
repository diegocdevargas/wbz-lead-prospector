export const CSS = `
:root { --fg:#1d1d1f; --muted:#6b6b70; --line:#e3e3e6; --bg:#fafafa; --accent:#0b5cad; --ok:#0f7a3a; --err:#b42318; }
* { box-sizing: border-box; }
body { margin:0; font:14px/1.45 system-ui, -apple-system, Segoe UI, sans-serif; color:var(--fg); background:var(--bg); }
header { display:flex; gap:24px; align-items:center; padding:12px 24px; background:#fff; border-bottom:1px solid var(--line); flex-wrap:wrap; }
nav { display:flex; gap:16px; flex-wrap:wrap; }
nav a { color:var(--muted); text-decoration:none; }
nav a[aria-current=page] { color:var(--fg); font-weight:600; }
main { padding:24px; max-width:1200px; }
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
