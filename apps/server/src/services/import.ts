import {
  type AppConfig,
  decideMatch,
  hashSuppressionKey,
  type MatchCandidates,
  type NormalizedLead,
  prepareLead,
  suppressionKeysFor,
} from "@wbz/core";
import type { Db } from "@wbz/db";
import {
  companies,
  contacts,
  dedupeCandidates,
  fieldSources,
  importRows,
  imports,
  stageEvents,
  suppressions,
  type Tx,
} from "@wbz/db";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { sha256Hex } from "../lib/hash.ts";

export type ImportSource = "manual_csv" | "manual_paste" | "manual_form";
export type RowOutcome = "created" | "merged" | "review" | "suppressed" | "invalid";

export interface ImportInput {
  source: ImportSource;
  filename?: string | null;
  /** The original text (CSV, paste, or form JSON), used to detect a repeated file. */
  content: string;
  /** Rows after column mapping. */
  rows: Record<string, string>[];
}

export interface RowReport {
  rowNumber: number;
  outcome: RowOutcome;
  companyName: string | null;
  companyId: string | null;
  messages: string[];
}

export interface ImportReport {
  importId: string | null;
  dryRun: boolean;
  /** An earlier import with the identical content, if any. Re-running it is safe. */
  previousImportId: string | null;
  counts: Record<RowOutcome, number>;
  rows: RowReport[];
}

export interface ImportDeps {
  config: AppConfig;
  suppressionSecret: string;
}

class DryRunRollback extends Error {
  constructor(readonly report: ImportReport) {
    super("dry run rollback");
  }
}

/**
 * Import rows in ONE transaction: either every row's effect lands or none
 * does. A dry run executes the exact same path and rolls back, so the preview
 * is what a real run would do. An advisory lock serializes imports so two
 * concurrent runs cannot both create the same company.
 */
export async function runImport(
  db: Db,
  deps: ImportDeps,
  input: ImportInput,
  opts: { dryRun: boolean },
): Promise<ImportReport> {
  if (input.rows.length > deps.config.import.maxRows) {
    throw new ImportTooLargeError(input.rows.length, deps.config.import.maxRows);
  }
  const fileHash = await sha256Hex(input.content);

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('wbz:import'))`);

      const [previous] = await tx
        .select({ id: imports.id })
        .from(imports)
        .where(eq(imports.fileHash, fileHash))
        .orderBy(desc(imports.createdAt))
        .limit(1);

      const [imp] = await tx
        .insert(imports)
        .values({
          source: input.source,
          filename: input.filename ?? null,
          fileHash,
          rowCount: input.rows.length,
        })
        .returning({ id: imports.id });
      if (!imp) throw new Error("insert into imports returned nothing");

      const report: ImportReport = {
        importId: imp.id,
        dryRun: opts.dryRun,
        previousImportId: previous?.id ?? null,
        counts: { created: 0, merged: 0, review: 0, suppressed: 0, invalid: 0 },
        rows: [],
      };

      for (const [index, raw] of input.rows.entries()) {
        const row = await importRow(tx, deps, input.source, imp.id, index + 1, raw);
        report.counts[row.outcome]++;
        report.rows.push(row);
      }

      await tx.update(imports).set(report.counts).where(eq(imports.id, imp.id));

      if (opts.dryRun) throw new DryRunRollback({ ...report, importId: null });
      return report;
    });
  } catch (err) {
    if (err instanceof DryRunRollback) return err.report;
    throw err;
  }
}

export class ImportTooLargeError extends Error {
  constructor(
    readonly rows: number,
    readonly max: number,
  ) {
    super(`import has ${rows} rows; the limit is ${max}`);
  }
}

async function importRow(
  tx: Tx,
  deps: ImportDeps,
  source: ImportSource,
  importId: string,
  rowNumber: number,
  raw: Record<string, string>,
): Promise<RowReport> {
  const record = async (
    outcome: RowOutcome,
    companyId: string | null,
    messages: string[],
    keepRaw = true,
  ): Promise<RowReport> => {
    await tx.insert(importRows).values({
      importId,
      rowNumber,
      raw: keepRaw ? raw : null,
      outcome,
      companyId,
      messages,
    });
    return { rowNumber, outcome, companyId, companyName: raw.company ?? null, messages };
  };

  const prepared = prepareLead(raw, deps.config);
  if (!prepared.ok) return record("invalid", null, prepared.errors);
  const { lead, warnings } = prepared;

  // Suppression first: an opted-out business is never stored again.
  const hashes = await Promise.all(suppressionKeysFor(lead).map((k) => hashSuppressionKey(k, deps.suppressionSecret)));
  if (hashes.length > 0) {
    const [hit] = await tx
      .select({ id: suppressions.id })
      .from(suppressions)
      .where(inArray(suppressions.valueHash, hashes))
      .limit(1);
    if (hit) return record("suppressed", null, ["matches the suppression list; row discarded"], false);
  }

  const decision = decideMatch(lead, await findCandidates(tx, deps.config, lead), deps.config);
  const sourceRef = `import:${importId}`;

  if (decision.kind === "merge") {
    await mergeInto(tx, decision.companyId, lead, source, sourceRef);
    return record("merged", decision.companyId, [`matched on ${decision.rule}`, ...warnings]);
  }

  const companyId = await createCompany(tx, lead, source, sourceRef);
  if (decision.kind === "create") return record("created", companyId, warnings);

  for (const c of decision.candidates) {
    await tx
      .insert(dedupeCandidates)
      .values({ companyA: c.companyId, companyB: companyId, rule: c.rule, similarity: c.similarity })
      .onConflictDoNothing();
  }
  const rules = [...new Set(decision.candidates.map((c) => c.rule))].join(", ");
  return record("review", companyId, [`possible duplicate (${rules}); queued for review`, ...warnings]);
}

async function findCandidates(tx: Tx, config: AppConfig, lead: NormalizedLead): Promise<MatchCandidates> {
  const cols = { id: companies.id, matchName: companies.matchName, cityNormalized: companies.cityNormalized };
  const first = async (where: ReturnType<typeof eq>) =>
    (await tx.select(cols).from(companies).where(where).orderBy(companies.createdAt).limit(1))[0] ?? null;

  const byDomain = lead.domain ? await first(eq(companies.domain, lead.domain)) : null;
  const byPhone = lead.phoneE164 ? await first(eq(companies.phoneE164, lead.phoneE164)) : null;
  const byCnpj = lead.cnpj ? await first(eq(companies.cnpj, lead.cnpj)) : null;

  const fuzzy = lead.cityNormalized
    ? await tx
        .select(cols)
        .from(companies)
        .where(
          and(
            eq(companies.cityNormalized, lead.cityNormalized),
            sql`similarity(${companies.matchName}, ${lead.matchName}) >= ${config.dedupe.fuzzyThreshold}`,
          ),
        )
        .orderBy(sql`similarity(${companies.matchName}, ${lead.matchName}) desc`)
        .limit(5)
    : [];

  return { byDomain, byPhone, byCnpj, fuzzy };
}

/** Company columns a lead can fill, keyed by the field name recorded in field_sources. */
function companyValues(lead: NormalizedLead) {
  return {
    city: lead.city,
    cityNormalized: lead.cityNormalized,
    state: lead.state,
    cnpj: lead.cnpj,
    domain: lead.domain,
    websiteUrl: lead.websiteUrl,
    phoneE164: lead.phoneE164,
    email: lead.email,
    instagramHandle: lead.instagramHandle,
    niche: lead.niche,
    notes: lead.notes,
  };
}

/** Fields worth recording provenance for (derived columns like cityNormalized are skipped). */
const SOURCED_COMPANY_FIELDS = [
  "name",
  "city",
  "state",
  "cnpj",
  "websiteUrl",
  "phoneE164",
  "email",
  "instagramHandle",
  "niche",
  "notes",
] as const;

async function createCompany(tx: Tx, lead: NormalizedLead, source: ImportSource, sourceRef: string) {
  const [company] = await tx
    .insert(companies)
    .values({
      name: lead.companyName,
      normalizedName: lead.normalizedName,
      matchName: lead.matchName,
      source,
      ...companyValues(lead),
      // A lead queued for review may carry a CNPJ another company already holds; keep it as provenance only.
      cnpj: (await cnpjTaken(tx, lead.cnpj, null)) ? null : lead.cnpj,
    })
    .returning({ id: companies.id });
  if (!company) throw new Error("insert into companies returned nothing");

  await tx.insert(stageEvents).values({
    companyId: company.id,
    fromStage: null,
    toStage: "discovered",
    actor: "system",
    note: `created by ${source}`,
  });
  await recordSources(tx, company.id, lead, source, sourceRef);
  await upsertContact(tx, company.id, lead, source, sourceRef);
  return company.id;
}

/** Fill only empty columns; never overwrite. Every value still gets a field_sources row. */
async function mergeInto(tx: Tx, companyId: string, lead: NormalizedLead, source: ImportSource, sourceRef: string) {
  const values = companyValues(lead);
  for (const [key, value] of Object.entries(values) as [keyof typeof values, string | null][]) {
    if (value == null) continue;
    // cnpj is unique: if another company holds it, keep the value as provenance only.
    if (key === "cnpj" && (await cnpjTaken(tx, value, companyId))) continue;
    await tx
      .update(companies)
      .set({ [key]: value })
      .where(and(eq(companies.id, companyId), isNull(companies[key])));
  }
  await recordSources(tx, companyId, lead, source, sourceRef);
  await upsertContact(tx, companyId, lead, source, sourceRef);
}

async function cnpjTaken(tx: Tx, cnpj: string | null, exceptId: string | null): Promise<boolean> {
  if (!cnpj) return false;
  const where = exceptId ? and(eq(companies.cnpj, cnpj), ne(companies.id, exceptId)) : eq(companies.cnpj, cnpj);
  const [hit] = await tx.select({ id: companies.id }).from(companies).where(where).limit(1);
  return Boolean(hit);
}

async function recordSources(tx: Tx, companyId: string, lead: NormalizedLead, source: ImportSource, sourceRef: string) {
  const all: Record<string, string | null> = { name: lead.companyName, ...companyValues(lead) };
  const rows = SOURCED_COMPANY_FIELDS.flatMap((field) => {
    const value = all[field];
    return value
      ? [{ companyId, entityType: "company" as const, entityId: companyId, field, value, source, sourceRef }]
      : [];
  });
  if (rows.length > 0) await tx.insert(fieldSources).values(rows);
}

async function upsertContact(tx: Tx, companyId: string, lead: NormalizedLead, source: ImportSource, sourceRef: string) {
  const c = lead.contact;
  if (!c) return;
  const [existing] = await tx
    .select({ id: contacts.id, role: contacts.role, linkedinUrl: contacts.linkedinUrl, notes: contacts.notes })
    .from(contacts)
    .where(and(eq(contacts.companyId, companyId), sql`lower(${contacts.name}) = lower(${c.name})`))
    .limit(1);

  let contactId: string;
  if (existing) {
    contactId = existing.id;
    await tx
      .update(contacts)
      .set({
        role: existing.role ?? c.role,
        linkedinUrl: existing.linkedinUrl ?? c.linkedinUrl,
        notes: existing.notes ?? c.notes,
      })
      .where(eq(contacts.id, existing.id));
  } else {
    const [created] = await tx
      .insert(contacts)
      .values({ companyId, name: c.name, role: c.role, linkedinUrl: c.linkedinUrl, notes: c.notes })
      .returning({ id: contacts.id });
    if (!created) throw new Error("insert into contacts returned nothing");
    contactId = created.id;
  }

  const fields = { name: c.name, role: c.role, linkedinUrl: c.linkedinUrl, notes: c.notes };
  const rows = Object.entries(fields).flatMap(([field, value]) =>
    value ? [{ companyId, entityType: "contact" as const, entityId: contactId, field, value, source, sourceRef }] : [],
  );
  if (rows.length > 0) await tx.insert(fieldSources).values(rows);
}
