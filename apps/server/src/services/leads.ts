import {
  hashSuppressionKey,
  normalizeCnpj,
  normalizeEmail,
  normalizePhone,
  type Platform,
  type Stage,
} from "@wbz/core";
import {
  apiCache,
  audits,
  campaignCompanies,
  campaigns,
  companies,
  contacts,
  type Db,
  type DbOrTx,
  dedupeCandidates,
  fieldSources,
  findings,
  importRows,
  stageEvents,
  suppressions,
} from "@wbz/db";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, or, type SQL, sql } from "drizzle-orm";
import { sha256Hex } from "../lib/hash.ts";

export interface LeadFilters {
  q?: string | undefined;
  stage?: Stage | undefined;
  niche?: string | undefined;
  city?: string | undefined;
  source?: (typeof companies.source.enumValues)[number] | undefined;
  platform?: Platform | "none" | undefined;
  website?: "yes" | "no" | undefined;
  campaign?: string | undefined;
  /** Keyset cursor: the last row of the previous page. */
  cursor?: { t: Date; id: string } | undefined;
}

export const PAGE_SIZE = 50;

const msCreated = sql`date_trunc('milliseconds', ${companies.createdAt})`;

/** Escape LIKE wildcards so user search text is matched literally. */
function likeEscape(text: string): string {
  return text.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function listLeads(db: DbOrTx, f: LeadFilters) {
  const where: SQL[] = [];
  if (f.q) {
    const q = `%${likeEscape(f.q)}%`;
    const match = or(ilike(companies.name, q), ilike(companies.domain, q), ilike(companies.email, q));
    if (match) where.push(match);
  }
  if (f.stage) where.push(eq(companies.stage, f.stage));
  if (f.niche) where.push(ilike(companies.niche, likeEscape(f.niche)));
  if (f.city) where.push(ilike(companies.city, likeEscape(f.city)));
  if (f.source) where.push(eq(companies.source, f.source));
  if (f.platform === "none") where.push(isNull(companies.platform));
  else if (f.platform) where.push(eq(companies.platform, f.platform));
  if (f.website === "yes") where.push(isNotNull(companies.websiteUrl));
  if (f.website === "no") where.push(isNull(companies.websiteUrl));
  if (f.campaign) {
    where.push(
      sql`exists (select 1 from ${campaignCompanies} cc where cc.company_id = ${companies.id} and cc.campaign_id = ${f.campaign})`,
    );
  }
  const cond = where.length ? and(...where) : undefined;
  const page: SQL[] = [...where];
  if (f.cursor) {
    // Compare at millisecond precision, the same precision the cursor (a JS Date) carries.
    page.push(
      sql`(${msCreated} < ${f.cursor.t.toISOString()}::timestamptz or (${msCreated} = ${f.cursor.t.toISOString()}::timestamptz and ${companies.id} > ${f.cursor.id}))`,
    );
  }

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: companies.id,
        name: companies.name,
        city: companies.city,
        state: companies.state,
        niche: companies.niche,
        domain: companies.domain,
        stage: companies.stage,
        source: companies.source,
        platform: companies.platform,
        createdAt: companies.createdAt,
      })
      .from(companies)
      .where(page.length ? and(...page) : undefined)
      .orderBy(sql`${msCreated} desc`, asc(companies.id))
      .limit(PAGE_SIZE + 1),
    db.select({ n: count() }).from(companies).where(cond),
  ]);
  return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE, total: total?.n ?? 0 };
}

export async function filterOptions(db: DbOrTx) {
  const [niches, cities] = await Promise.all([
    db.selectDistinct({ v: companies.niche }).from(companies).orderBy(companies.niche).limit(200),
    db.selectDistinct({ v: companies.city }).from(companies).orderBy(companies.city).limit(200),
  ]);
  return {
    niches: niches.map((r) => r.v).filter((v): v is string => Boolean(v)),
    cities: cities.map((r) => r.v).filter((v): v is string => Boolean(v)),
  };
}

export async function getLead(db: DbOrTx, id: string) {
  const [company] = await db.select().from(companies).where(eq(companies.id, id));
  if (!company) return null;
  const [people, sources, events, rows] = await Promise.all([
    db.select().from(contacts).where(eq(contacts.companyId, id)).orderBy(asc(contacts.createdAt)),
    db.select().from(fieldSources).where(eq(fieldSources.companyId, id)).orderBy(desc(fieldSources.collectedAt)),
    db.select().from(stageEvents).where(eq(stageEvents.companyId, id)).orderBy(desc(stageEvents.createdAt)),
    db.select().from(importRows).where(eq(importRows.companyId, id)).orderBy(desc(importRows.id)),
  ]);
  const leadCampaigns = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaignCompanies)
    .innerJoin(campaigns, eq(campaigns.id, campaignCompanies.campaignId))
    .where(eq(campaignCompanies.companyId, id));
  return { company, contacts: people, sources, events, importRows: rows, campaigns: leadCampaigns };
}

export async function changeStage(db: Db, id: string, to: Stage, note: string | null) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ stage: companies.stage })
      .from(companies)
      .where(eq(companies.id, id))
      .for("update");
    if (!current) return false;
    if (current.stage === to) return true;
    await tx.update(companies).set({ stage: to }).where(eq(companies.id, id));
    await tx.insert(stageEvents).values({ companyId: id, fromStage: current.stage, toStage: to, actor: "diego", note });
    return true;
  });
}

/** Everything stored about one lead, for an LGPD access request. */
export async function exportLead(db: DbOrTx, id: string) {
  const lead = await getLead(db, id);
  if (!lead) return null;
  const [auditRows, findingRows] = await Promise.all([
    db.select().from(audits).where(eq(audits.companyId, id)).orderBy(desc(audits.finishedAt)),
    db.select().from(findings).where(eq(findings.companyId, id)),
  ]);
  return { exportedAt: new Date().toISOString(), ...lead, audits: auditRows, findings: findingRows };
}

/**
 * LGPD deletion: removes the company, its contacts, provenance, timeline and
 * the raw import rows that carried its data. With `suppress`, its email,
 * phone, domain and CNPJ are added to the suppression list (as keyed hashes)
 * so it is never imported again.
 */
export async function deleteLead(db: Db, id: string, opts: { suppress: boolean; secret: string }) {
  return db.transaction(async (tx) => {
    const [company] = await tx.select().from(companies).where(eq(companies.id, id)).for("update");
    if (!company) return false;
    if (opts.suppress) {
      const people = await tx.select().from(contacts).where(eq(contacts.companyId, id));
      const keys = [
        { kind: "email" as const, value: company.email },
        { kind: "phone" as const, value: company.phoneE164 },
        { kind: "domain" as const, value: company.domain },
        { kind: "cnpj" as const, value: company.cnpj },
        ...people.flatMap((p) => [
          { kind: "email" as const, value: p.email },
          { kind: "phone" as const, value: p.phoneE164 },
        ]),
      ].filter((k): k is { kind: typeof k.kind; value: string } => Boolean(k.value));
      for (const key of keys) {
        await tx
          .insert(suppressions)
          .values({
            kind: key.kind,
            valueHash: await hashSuppressionKey(key, opts.secret),
            reason: "lead deleted (LGPD)",
          })
          .onConflictDoNothing();
      }
    }
    await tx.delete(importRows).where(eq(importRows.companyId, id));
    // Cached Places data for this business (audits, findings, sources and campaign links cascade).
    if (company.placeId) {
      await tx
        .delete(apiCache)
        .where(and(eq(apiCache.provider, "places_details"), eq(apiCache.keyHash, await sha256Hex(company.placeId))));
    }
    await tx.delete(companies).where(eq(companies.id, id));
    return true;
  });
}

export async function listSuppressions(db: DbOrTx) {
  return db.select().from(suppressions).orderBy(desc(suppressions.createdAt)).limit(500);
}

export type AddSuppressionResult = { ok: true; optedOut: number } | { ok: false; error: string };

/**
 * Add an opt-out by hand. Existing leads holding that value move to
 * `opted_out` immediately, so nothing downstream can contact them.
 */
export async function addSuppression(
  db: Db,
  input: { kind: "email" | "phone" | "domain" | "cnpj"; value: string; reason: string },
  secret: string,
): Promise<AddSuppressionResult> {
  const value =
    input.kind === "email"
      ? normalizeEmail(input.value)
      : input.kind === "phone"
        ? normalizePhone(input.value)
        : input.kind === "cnpj"
          ? normalizeCnpj(input.value)
          : input.value
              .trim()
              .toLowerCase()
              .replace(/^www\./, "") || null;
  if (!value) return { ok: false, error: `not a valid ${input.kind}` };

  const valueHash = await hashSuppressionKey({ kind: input.kind, value }, secret);
  return db.transaction(async (tx) => {
    await tx.insert(suppressions).values({ kind: input.kind, valueHash, reason: input.reason }).onConflictDoNothing();
    const column = {
      email: companies.email,
      phone: companies.phoneE164,
      domain: companies.domain,
      cnpj: companies.cnpj,
    }[input.kind];
    const contactColumn = input.kind === "email" ? contacts.email : input.kind === "phone" ? contacts.phoneE164 : null;
    const viaContacts = contactColumn
      ? (await tx.select({ id: contacts.companyId }).from(contacts).where(eq(contactColumn, value))).map((r) => r.id)
      : [];
    const hits = await tx
      .select({ id: companies.id, stage: companies.stage })
      .from(companies)
      .where(
        and(
          sql`${companies.stage} <> 'opted_out'`,
          viaContacts.length ? or(eq(column, value), inArray(companies.id, viaContacts)) : eq(column, value),
        ),
      )
      .for("update");
    for (const hit of hits) {
      await tx.update(companies).set({ stage: "opted_out" }).where(eq(companies.id, hit.id));
      await tx.insert(stageEvents).values({
        companyId: hit.id,
        fromStage: hit.stage,
        toStage: "opted_out",
        actor: "diego",
        note: `suppression added: ${input.reason}`,
      });
    }
    return { ok: true as const, optedOut: hits.length };
  });
}

export async function listDedupeQueue(db: DbOrTx) {
  const pending = await db
    .select()
    .from(dedupeCandidates)
    .where(eq(dedupeCandidates.status, "pending"))
    .orderBy(asc(dedupeCandidates.createdAt))
    .limit(100);
  const ids = [...new Set(pending.flatMap((p) => [p.companyA, p.companyB]))];
  const rows = ids.length ? await db.select().from(companies).where(inArray(companies.id, ids)) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return pending.flatMap((p) => {
    const a = byId.get(p.companyA);
    const b = byId.get(p.companyB);
    return a && b ? [{ ...p, a, b }] : [];
  });
}

export async function dismissCandidate(db: DbOrTx, id: string) {
  const res = await db
    .update(dedupeCandidates)
    .set({ status: "dismissed", resolvedAt: new Date() })
    .where(and(eq(dedupeCandidates.id, id), eq(dedupeCandidates.status, "pending")))
    .returning({ id: dedupeCandidates.id });
  return res.length > 0;
}

const FILLABLE = [
  "city",
  "cityNormalized",
  "state",
  "cnpj",
  "domain",
  "websiteUrl",
  "phoneE164",
  "email",
  "instagramHandle",
  "niche",
  "notes",
] as const;

/**
 * Merge B (the newer lead) into A (the existing one): A keeps its values,
 * empty ones are filled from B, and B's contacts, provenance, timeline and
 * import rows move to A. B is then deleted.
 */
export async function mergeCandidate(db: Db, candidateId: string) {
  return db.transaction(async (tx) => {
    const [cand] = await tx
      .select()
      .from(dedupeCandidates)
      .where(and(eq(dedupeCandidates.id, candidateId), eq(dedupeCandidates.status, "pending")))
      .for("update");
    if (!cand) return null;
    const keepId = cand.companyA;
    const dropId = cand.companyB;
    const rows = await tx
      .select()
      .from(companies)
      .where(inArray(companies.id, [keepId, dropId]))
      .for("update");
    const keep = rows.find((r) => r.id === keepId);
    const drop = rows.find((r) => r.id === dropId);
    if (!keep || !drop) return null;

    const fill: Partial<Record<(typeof FILLABLE)[number], string>> = {};
    for (const key of FILLABLE) {
      if (keep[key] == null && drop[key] != null) fill[key] = drop[key] as string;
    }

    // Repoint B's other pending pairs to A before B (and its pairs) cascade away.
    const others = await tx
      .select()
      .from(dedupeCandidates)
      .where(
        and(
          eq(dedupeCandidates.status, "pending"),
          or(eq(dedupeCandidates.companyA, dropId), eq(dedupeCandidates.companyB, dropId)),
        ),
      );

    await tx.update(contacts).set({ companyId: keepId }).where(eq(contacts.companyId, dropId));
    await tx
      .update(fieldSources)
      .set({ companyId: keepId, entityId: keepId })
      .where(and(eq(fieldSources.companyId, dropId), eq(fieldSources.entityType, "company")));
    await tx.update(fieldSources).set({ companyId: keepId }).where(eq(fieldSources.companyId, dropId));
    await tx.update(stageEvents).set({ companyId: keepId }).where(eq(stageEvents.companyId, dropId));
    await tx.update(importRows).set({ companyId: keepId }).where(eq(importRows.companyId, dropId));
    await tx.delete(companies).where(eq(companies.id, dropId));
    if (Object.keys(fill).length) await tx.update(companies).set(fill).where(eq(companies.id, keepId));

    for (const o of others) {
      if (o.id === cand.id) continue;
      const a = o.companyA === dropId ? keepId : o.companyA;
      const b = o.companyB === dropId ? keepId : o.companyB;
      if (a === b) continue;
      await tx
        .insert(dedupeCandidates)
        .values({ companyA: a, companyB: b, rule: o.rule, similarity: o.similarity })
        .onConflictDoNothing();
    }

    await tx.insert(stageEvents).values({
      companyId: keepId,
      fromStage: keep.stage,
      toStage: keep.stage,
      actor: "diego",
      note: `merged duplicate "${drop.name}" (${cand.rule})`,
    });
    return keepId;
  });
}
