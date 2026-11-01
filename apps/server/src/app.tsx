import {
  applyMapping,
  autoMapHeaders,
  CREATING_SOURCES,
  JOB_KINDS,
  JOB_STATUSES,
  LEAD_FIELDS,
  PLATFORMS,
  STAGES,
  SUPPRESSION_KINDS,
} from "@wbz/core";
import { campaigns, companies, type Db, importRows, imports, jobs } from "@wbz/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { authMiddleware } from "./lib/auth.ts";
import { parseTable } from "./lib/csv.ts";
import type { Settings } from "./lib/env.ts";
import { logError, requestLog } from "./lib/log.ts";
import type { FetchLike, Resolver } from "./lib/safe-fetch.ts";
import { latestAudit } from "./services/audit.ts";
import { createCampaign, getCampaign, listCampaigns, startCampaign, updateCampaignCap } from "./services/discovery.ts";
import { ImportTooLargeError, runImport } from "./services/import.ts";
import { enqueue, listJobs, retryJob } from "./services/jobs.ts";
import {
  addSuppression,
  changeStage,
  deleteLead,
  dismissCandidate,
  exportLead,
  filterOptions,
  getGroup,
  getLead,
  groupCandidate,
  listDedupeQueue,
  listLeads,
  listSuppressions,
  mergeCandidate,
  ungroupLead,
} from "./services/leads.ts";
import { type JobQueue, placesLimiter, type Runtime } from "./services/runtime.ts";
import { CampaignPage, CampaignsPage, NewCampaignPage } from "./views/campaigns.tsx";
import { DedupePage } from "./views/dedupe.tsx";
import { ImportDetailPage, ImportsPage, PreviewPage } from "./views/imports.tsx";
import { JobsPage } from "./views/jobs.tsx";
import { Layout } from "./views/layout.tsx";
import { LeadList, LeadPage, NewLeadPage } from "./views/leads.tsx";
import { APP_JS } from "./views/script.ts";
import { SettingsPage } from "./views/settings.tsx";
import { CSS } from "./views/styles.ts";
import { SuppressionsPage } from "./views/suppressions.tsx";
import { decodeCursor, encodeCursor } from "./views/ui.tsx";

export type AppEnv = { Variables: { db: Db; settings: Settings; rt: Runtime } };

/**
 * Per-request dependencies. Node reuses one pool; Workers open a Neon pool
 * per request and close it after the response.
 */
export type ResolveDeps = (c: { executionCtx?: unknown; env?: unknown }) => Promise<{
  db: Db;
  settings: Settings;
  release?: () => Promise<void>;
  queue?: JobQueue;
}>;

/** Network access for jobs started from the dashboard; tests pass fixtures. */
export interface AppIo {
  http: FetchLike;
  resolve: Resolver;
}

const NO_QUEUE: JobQueue = {
  async send() {
    // Without a queue the cron sweep picks the job up from the table.
  },
};

const uuid = z.uuid();
const KB = 1024;

function idParam(value: string): string {
  if (!uuid.safeParse(value).success) throw new HTTPException(404, { message: "Not found" });
  return value;
}

export function createApp(
  settings: Settings,
  resolve: ResolveDeps,
  io: AppIo = { http: fetch, resolve: async () => [] },
) {
  const app = new Hono<AppEnv>();
  const { env, config } = settings;

  app.use(requestLog);
  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'none'"],
        styleSrc: ["'self'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'none'"],
        imgSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
      },
      referrerPolicy: "same-origin",
      strictTransportSecurity: env.ENVIRONMENT === "production" ? "max-age=63072000; includeSubDomains" : false,
    }),
  );
  app.use(async (c, next) => {
    await next();
    // Lead data must never land in a shared or browser cache.
    if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
  });

  app.get("/favicon.ico", (c) => c.body(null, 204));

  app.get("/healthz", async (c) => {
    const deps = await resolve(c);
    try {
      await deps.db.execute(sql`select 1`);
      return c.json({ ok: true });
    } catch (err) {
      logError(err, { route: "healthz" });
      return c.json({ ok: false }, 503);
    } finally {
      await deps.release?.();
    }
  });

  app.use(authMiddleware(env));
  app.use(csrf());
  const importLimit = bodyLimit({ maxSize: config.import.maxBytes + 64 * KB, onError: tooLarge });
  const defaultLimit = bodyLimit({ maxSize: 64 * KB, onError: tooLarge });
  app.use((c, next) => (c.req.path.startsWith("/imports/") ? importLimit : defaultLimit)(c, next));
  app.use(async (c, next) => {
    const deps = await resolve(c);
    c.set("db", deps.db);
    c.set("settings", settings);
    c.set("rt", {
      db: deps.db,
      settings,
      queue: deps.queue ?? NO_QUEUE,
      http: io.http,
      resolve: io.resolve,
      now: () => new Date(),
      placesLimiter: placesLimiter(config.places.ratePerSecond),
    });
    try {
      await next();
    } finally {
      await deps.release?.();
    }
  });

  app.get("/assets/app.css", (c) => {
    c.header("Cache-Control", "public, max-age=3600");
    return c.body(CSS, 200, { "Content-Type": "text/css; charset=utf-8" });
  });

  app.get("/assets/app.js", (c) => {
    c.header("Cache-Control", "public, max-age=3600");
    return c.body(APP_JS, 200, { "Content-Type": "text/javascript; charset=utf-8" });
  });

  app.get("/", (c) => c.redirect("/leads"));

  // ---- Leads ---------------------------------------------------------------

  const listQuery = z.object({
    q: z.string().trim().max(200).optional().catch(undefined),
    stage: z.enum(STAGES).optional().catch(undefined),
    niche: z.string().max(120).optional().catch(undefined),
    city: z.string().max(120).optional().catch(undefined),
    source: z.enum(CREATING_SOURCES).optional().catch(undefined),
    platform: z
      .enum([...PLATFORMS, "none"])
      .optional()
      .catch(undefined),
    website: z.enum(["yes", "no"]).optional().catch(undefined),
    campaign: z.uuid().optional().catch(undefined),
    after: z.string().max(80).optional().catch(undefined),
  });

  app.get("/leads", async (c) => {
    const f = listQuery.parse(nonEmpty(c.req.query()));
    const db = c.var.db;
    const cursor = decodeCursor(f.after);
    const [result, options, campaignOptions] = await Promise.all([
      listLeads(db, { ...f, cursor }),
      filterOptions(db),
      db
        .select({ id: campaigns.id, name: campaigns.name })
        .from(campaigns)
        .orderBy(desc(campaigns.createdAt))
        .limit(100),
    ]);
    const { after: _after, ...rest } = f;
    const last = result.rows.at(-1);
    return c.html(
      <LeadList
        rows={result.rows}
        total={result.total}
        next={result.hasMore && last ? encodeCursor(last.createdAt, last.id) : null}
        isFirst={!cursor}
        filters={definedOnly(rest)}
        options={{ ...options, sources: CREATING_SOURCES, campaigns: campaignOptions }}
      />,
    );
  });

  app.get("/leads/new", (c) => c.html(<NewLeadPage />));

  app.post("/leads/new", async (c) => {
    const form = await c.req.parseBody();
    const values = Object.fromEntries(
      LEAD_FIELDS.flatMap((f) => (typeof form[f] === "string" ? [[f, form[f] as string]] : [])),
    );
    const report = await runImport(
      c.var.db,
      { config, suppressionSecret: env.SUPPRESSION_SECRET },
      { source: "manual_form", content: JSON.stringify(values), rows: [values] },
      { dryRun: false },
    );
    const row = report.rows[0];
    if (!row || row.outcome === "invalid") {
      return c.html(<NewLeadPage error={row?.messages.join("; ") ?? "Invalid input"} values={values} />, 422);
    }
    if (row.outcome === "suppressed" || !row.companyId) {
      return c.html(
        <NewLeadPage error="This business is on the opt-out list, so it was not added." values={values} />,
        409,
      );
    }
    return c.redirect(`/leads/${row.companyId}?added=${row.outcome}`, 303);
  });

  app.get("/leads/:id", async (c) => {
    const id = idParam(c.req.param("id"));
    const lead = await getLead(c.var.db, id);
    if (!lead) return c.notFound();
    const tab = c.req.query("tab") === "audit" ? "audit" : "overview";
    const [audit, pendingAudit, group] = await Promise.all([
      latestAudit(c.var.db, id),
      auditPending(c.var.db, id),
      getGroup(c.var.db, lead.company),
    ]);
    const added = c.req.query("added");
    const flash =
      added === "merged"
        ? { kind: "ok" as const, text: "This business already existed; the new details were merged in." }
        : added === "review"
          ? { kind: "ok" as const, text: "Added, and flagged as a possible duplicate for review." }
          : added === "created"
            ? { kind: "ok" as const, text: "Lead added." }
            : added === "audit"
              ? { kind: "ok" as const, text: "Audit queued. Refresh in a minute to see the findings." }
              : null;
    return c.html(
      <LeadPage {...lead} flash={flash} tab={tab} audit={audit} auditPending={pendingAudit} group={group} />,
    );
  });

  app.post("/leads/:id/audit", async (c) => {
    const id = idParam(c.req.param("id"));
    const [company] = await c.var.db
      .select({ id: companies.id, stage: companies.stage })
      .from(companies)
      .where(eq(companies.id, id));
    if (!company) return c.notFound();
    if (company.stage === "opted_out")
      throw new HTTPException(409, { message: "This lead opted out; it is not audited." });
    if (!(await auditPending(c.var.db, id))) {
      await enqueue(c.var.db, c.var.rt.queue, {
        kind: "audit_lead",
        key: `audit:${id}:${Date.now()}`,
        payload: { companyId: id },
        maxAttempts: config.jobs.maxAttempts,
      });
    }
    return c.redirect(`/leads/${id}?tab=audit&added=audit`, 303);
  });

  const stageForm = z.object({
    stage: z.enum(STAGES),
    note: z.string().trim().max(500).optional(),
  });

  app.post("/leads/:id/stage", async (c) => {
    const id = idParam(c.req.param("id"));
    const parsed = stageForm.safeParse(await c.req.parseBody());
    if (!parsed.success) throw new HTTPException(400, { message: "Invalid stage" });
    const ok = await changeStage(c.var.db, id, parsed.data.stage, parsed.data.note || null);
    if (!ok) return c.notFound();
    return c.redirect(`/leads/${id}`, 303);
  });

  app.get("/leads/:id/export", async (c) => {
    const id = idParam(c.req.param("id"));
    const data = await exportLead(c.var.db, id);
    if (!data) return c.notFound();
    c.header("Content-Disposition", `attachment; filename="lead-${id}.json"`);
    return c.json(data);
  });

  app.post("/leads/:id/delete", async (c) => {
    const id = idParam(c.req.param("id"));
    const form = await c.req.parseBody();
    if (form.confirm !== "1") throw new HTTPException(400, { message: "Confirmation required" });
    const ok = await deleteLead(c.var.db, id, { suppress: form.suppress === "1", secret: env.SUPPRESSION_SECRET });
    if (!ok) return c.notFound();
    return c.redirect("/leads", 303);
  });

  // ---- Imports -------------------------------------------------------------

  app.get("/imports", async (c) => {
    const rows = await c.var.db.select().from(imports).orderBy(desc(imports.createdAt)).limit(100);
    return c.html(<ImportsPage imports={rows} />);
  });

  /** Read upload/paste/round-tripped content and the (possibly edited) column mapping. */
  async function readImportForm(form: Record<string, string | File | (string | File)[]>) {
    let content: string;
    let source: "manual_csv" | "manual_paste";
    let filename: string | null = null;
    const file = form.file;
    if (file instanceof File && file.size > 0) {
      if (file.size > config.import.maxBytes) throw new UserError("File is larger than 5 MB.");
      content = await file.text();
      source = "manual_csv";
      filename = file.name.slice(0, 200);
    } else if (typeof form.paste === "string" && form.paste.trim()) {
      content = form.paste;
      source = "manual_paste";
    } else if (typeof form.content === "string" && form.content.trim()) {
      content = form.content;
      source = form.source === "manual_csv" ? "manual_csv" : "manual_paste";
      filename = typeof form.filename === "string" && form.filename ? form.filename.slice(0, 200) : null;
    } else {
      throw new UserError("Upload a file or paste some rows.");
    }

    let table: ReturnType<typeof parseTable>;
    try {
      table = parseTable(content);
    } catch {
      throw new UserError("Could not read that as CSV. Check the delimiter and quotes.");
    }
    if (table.headers.length === 0 || table.rows.length === 0) {
      throw new UserError("Need a header row and at least one data row.");
    }
    if (table.rows.length > config.import.maxRows) {
      throw new UserError(`Too many rows (${table.rows.length}); the limit is ${config.import.maxRows}.`);
    }

    const hasManualMapping = Object.keys(form).some((k) => k.startsWith("map_"));
    const mapping = hasManualMapping
      ? Object.fromEntries(
          table.headers.map((_, i) => {
            const v = form[`map_${i}`];
            return [
              i,
              typeof v === "string" && (LEAD_FIELDS as string[]).includes(v)
                ? (v as (typeof LEAD_FIELDS)[number])
                : null,
            ];
          }),
        )
      : autoMapHeaders(table.headers);
    const rows = table.rows.map((r) => applyMapping(r, mapping) as Record<string, string>);
    return { content, source, filename, headers: table.headers, mapping, rows };
  }

  app.post("/imports/preview", async (c) => {
    const db = c.var.db;
    try {
      const input = await readImportForm(await c.req.parseBody());
      const report = await runImport(
        db,
        { config, suppressionSecret: env.SUPPRESSION_SECRET },
        { source: input.source, filename: input.filename, content: input.content, rows: input.rows },
        { dryRun: true },
      );
      return c.html(<PreviewPage {...input} report={report} />);
    } catch (err) {
      if (err instanceof UserError || err instanceof ImportTooLargeError) {
        const rows = await db.select().from(imports).orderBy(desc(imports.createdAt)).limit(100);
        return c.html(<ImportsPage imports={rows} error={err.message} />, 422);
      }
      throw err;
    }
  });

  app.post("/imports/commit", async (c) => {
    const db = c.var.db;
    try {
      const input = await readImportForm(await c.req.parseBody());
      const report = await runImport(
        db,
        { config, suppressionSecret: env.SUPPRESSION_SECRET },
        { source: input.source, filename: input.filename, content: input.content, rows: input.rows },
        { dryRun: false },
      );
      return c.redirect(`/imports/${report.importId}`, 303);
    } catch (err) {
      if (err instanceof UserError || err instanceof ImportTooLargeError) {
        const rows = await db.select().from(imports).orderBy(desc(imports.createdAt)).limit(100);
        return c.html(<ImportsPage imports={rows} error={err.message} />, 422);
      }
      throw err;
    }
  });

  app.get("/imports/:id", async (c) => {
    const id = idParam(c.req.param("id"));
    const db = c.var.db;
    const [imp] = await db.select().from(imports).where(eq(imports.id, id));
    if (!imp) return c.notFound();
    const rows = await db
      .select({ row: importRows, companyName: companies.name })
      .from(importRows)
      .leftJoin(companies, eq(companies.id, importRows.companyId))
      .where(eq(importRows.importId, id))
      .orderBy(asc(importRows.rowNumber));
    return c.html(<ImportDetailPage imp={imp} rows={rows.map((r) => ({ ...r.row, companyName: r.companyName }))} />);
  });

  // ---- Dedupe review -------------------------------------------------------

  app.get("/dedupe", async (c) => {
    const items = await listDedupeQueue(c.var.db);
    const done = c.req.query("done");
    const flash =
      done === "merged"
        ? "Merged."
        : done === "dismissed"
          ? "Marked as not a duplicate."
          : done === "grouped"
            ? "Linked as a branch of the same group."
            : null;
    return c.html(<DedupePage items={items} flash={flash} />);
  });

  app.post("/dedupe/:id/merge", async (c) => {
    const keptId = await mergeCandidate(c.var.db, idParam(c.req.param("id")));
    if (!keptId) return c.notFound();
    return c.redirect("/dedupe?done=merged", 303);
  });

  app.post("/dedupe/:id/group", async (c) => {
    const headId = await groupCandidate(c.var.db, idParam(c.req.param("id")));
    if (!headId) return c.notFound();
    return c.redirect("/dedupe?done=grouped", 303);
  });

  app.post("/leads/:id/ungroup", async (c) => {
    const id = idParam(c.req.param("id"));
    if (!(await ungroupLead(c.var.db, id))) return c.notFound();
    return c.redirect(`/leads/${id}`, 303);
  });

  app.post("/dedupe/:id/dismiss", async (c) => {
    const ok = await dismissCandidate(c.var.db, idParam(c.req.param("id")));
    if (!ok) return c.notFound();
    return c.redirect("/dedupe?done=dismissed", 303);
  });

  // ---- Suppressions --------------------------------------------------------

  app.get("/suppressions", async (c) => {
    return c.html(<SuppressionsPage rows={await listSuppressions(c.var.db)} />);
  });

  const suppressionForm = z.object({
    kind: z.enum(SUPPRESSION_KINDS),
    value: z.string().trim().min(1).max(254),
    reason: z.string().trim().min(1).max(200),
  });

  app.post("/suppressions", async (c) => {
    const db = c.var.db;
    const parsed = suppressionForm.safeParse(await c.req.parseBody());
    const result = parsed.success
      ? await addSuppression(db, parsed.data, env.SUPPRESSION_SECRET)
      : { ok: false as const, error: "Fill in type, value and reason." };
    const flash = result.ok
      ? {
          kind: "ok" as const,
          text: `Opt-out added.${result.optedOut ? ` ${result.optedOut} existing lead(s) moved to opted_out.` : ""}`,
        }
      : { kind: "error" as const, text: result.error };
    return c.html(<SuppressionsPage rows={await listSuppressions(db)} flash={flash} />, result.ok ? 200 : 422);
  });

  // ---- Campaigns -----------------------------------------------------------

  const discoveryEnabled = Boolean(env.GOOGLE_API_KEY);

  app.get("/campaigns", async (c) => {
    const done = c.req.query("done");
    const flash = done === "created" ? { kind: "ok" as const, text: "Campaign created." } : null;
    return c.html(
      <CampaignsPage rows={await listCampaigns(c.var.db)} discoveryEnabled={discoveryEnabled} flash={flash} />,
    );
  });

  const campaignPage = (values: Record<string, string> = {}, error: string | null = null) => (
    <NewCampaignPage
      values={values}
      error={error}
      defaultCap={config.places.defaultRequestCap}
      maxPages={config.places.maxPagesPerQuery}
    />
  );

  app.get("/campaigns/new", (c) => c.html(campaignPage()));

  const campaignForm = z.object({
    name: z.string().trim().min(1).max(120),
    niche: z.string().trim().min(2).max(120),
    queryTemplate: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((v) => v || "{niche} em {city}")
      .refine((v) => v.includes("{city}"), "the query template must contain {city}"),
    cities: z
      .string()
      .max(4000)
      .transform((v) => [
        ...new Set(
          v
            .split(/\r?\n|;/)
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      ])
      .pipe(z.array(z.string().max(120)).min(1, "add at least one city").max(100)),
    placesRequestCap: z.coerce.number().int().min(1).max(5000),
  });

  app.post("/campaigns", async (c) => {
    const form = await c.req.parseBody();
    const values = Object.fromEntries(
      Object.entries(form).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
    const parsed = campaignForm.safeParse(values);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return c.html(campaignPage(values, msg), 422);
    }
    const id = await createCampaign(c.var.db, parsed.data);
    return c.redirect(`/campaigns/${id}?done=created`, 303);
  });

  app.get("/campaigns/:id", async (c) => {
    const data = await getCampaign(c.var.db, idParam(c.req.param("id")));
    if (!data) return c.notFound();
    const done = c.req.query("done");
    const flash =
      done === "started"
        ? { kind: "ok" as const, text: "Discovery queued. Results appear as each city finishes; refresh to update." }
        : done === "created"
          ? { kind: "ok" as const, text: "Campaign created. Check the setup, then run discovery." }
          : done === "cap"
            ? { kind: "ok" as const, text: "Cap updated." }
            : null;
    return c.html(
      <CampaignPage
        {...data}
        discoveryEnabled={discoveryEnabled}
        maxPages={config.places.maxPagesPerQuery}
        flash={flash}
      />,
    );
  });

  app.post("/campaigns/:id/run", async (c) => {
    const id = idParam(c.req.param("id"));
    if (!discoveryEnabled) throw new HTTPException(409, { message: "Set GOOGLE_API_KEY to run discovery." });
    if (!(await startCampaign(c.var.rt, id))) return c.notFound();
    return c.redirect(`/campaigns/${id}?done=started`, 303);
  });

  app.post("/campaigns/:id/cap", async (c) => {
    const id = idParam(c.req.param("id"));
    const parsed = z
      .object({ placesRequestCap: z.coerce.number().int().min(1).max(5000) })
      .safeParse(await c.req.parseBody());
    if (!parsed.success) throw new HTTPException(400, { message: "Invalid cap" });
    if (!(await updateCampaignCap(c.var.rt, id, parsed.data.placesRequestCap))) {
      throw new HTTPException(400, { message: "The cap cannot be lower than the requests already used." });
    }
    return c.redirect(`/campaigns/${id}?done=cap`, 303);
  });

  // ---- Jobs ----------------------------------------------------------------

  const jobsQuery = z.object({
    status: z.enum(JOB_STATUSES).optional().catch(undefined),
    kind: z.enum(JOB_KINDS).optional().catch(undefined),
    after: z.string().max(80).optional().catch(undefined),
  });

  app.get("/jobs", async (c) => {
    const f = jobsQuery.parse(nonEmpty(c.req.query()));
    const cursor = decodeCursor(f.after);
    const result = await listJobs(c.var.db, { status: f.status, kind: f.kind, cursor });
    const last = result.rows.at(-1);
    const flash =
      c.req.query("done") === "retried" ? { kind: "ok" as const, text: "Job queued for another attempt." } : null;
    return c.html(
      <JobsPage
        rows={result.rows}
        counts={result.counts}
        filters={definedOnly({ status: f.status, kind: f.kind })}
        next={result.hasMore && last ? encodeCursor(last.createdAt, last.id) : null}
        isFirst={!cursor}
        flash={flash}
      />,
    );
  });

  app.post("/jobs/:id/retry", async (c) => {
    const ok = await retryJob(c.var.db, c.var.rt.queue, idParam(c.req.param("id")));
    if (!ok) return c.notFound();
    return c.redirect("/jobs?done=retried", 303);
  });

  // ---- Settings (read-only) -------------------------------------------------

  app.get("/settings", (c) =>
    c.html(
      <SettingsPage
        config={config}
        environment={env.ENVIRONMENT}
        authMode={env.AUTH_MODE}
        secrets={[
          ["DATABASE_URL", Boolean(env.DATABASE_URL), "Postgres connection"],
          ["SUPPRESSION_SECRET", Boolean(env.SUPPRESSION_SECRET), "Keys opt-out hashes. Never rotate."],
          ["GOOGLE_API_KEY", Boolean(env.GOOGLE_API_KEY), "Places API (New) + PageSpeed Insights"],
          ["CF_ACCESS_AUD", Boolean(env.CF_ACCESS_AUD), "Cloudflare Access audience (production auth)"],
          ["BASIC_AUTH_PASSWORD", Boolean(env.BASIC_AUTH_PASSWORD), "Only for AUTH_MODE=basic"],
        ]}
      />,
    ),
  );

  // ---- Errors --------------------------------------------------------------

  app.notFound((c) =>
    c.html(
      <Layout title="Not found">
        <h1>Not found</h1>
        <p>
          <a href="/leads">Back to leads</a>
        </p>
      </Layout>,
      404,
    ),
  );

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      if (err.status === 401 || err.status === 413) return err.getResponse();
      return c.text(err.message || "Bad request", err.status);
    }
    logError(err, { method: c.req.method, path: new URL(c.req.url).pathname });
    return c.text("Something went wrong. It has been logged.", 500);
  });

  return app;
}

class UserError extends Error {}

function nonEmpty(q: Record<string, string>) {
  return Object.fromEntries(Object.entries(q).filter(([, v]) => v !== ""));
}

function definedOnly(o: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(o).filter((e): e is [string, string] => Boolean(e[1])));
}

async function auditPending(db: Db, companyId: string) {
  const [row] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, "audit_lead"),
        inArray(jobs.status, ["pending", "running", "failed"]),
        sql`${jobs.payload}->>'companyId' = ${companyId}`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

function tooLarge(): never {
  throw new HTTPException(413, { message: "Request body too large" });
}
