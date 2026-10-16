import { companies, contacts, dedupeCandidates, fieldSources, importRows, stageEvents } from "@wbz/db";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { runImport } from "../src/services/import.ts";
import { addSuppression, deleteLead, mergeCandidate } from "../src/services/leads.ts";
import { countRows, deps, SECRET, useTestDb } from "./helpers.ts";

const db = useTestDb();

const TABLES = [
  "companies",
  "contacts",
  "field_sources",
  "imports",
  "import_rows",
  "dedupe_candidates",
  "stage_events",
];

function csvImport(rows: Record<string, string>[], content = JSON.stringify(rows)) {
  return runImport(db, deps, { source: "manual_csv", filename: "t.csv", content, rows }, { dryRun: false });
}

const sorriso = {
  company: "Clínica Sorriso LTDA",
  website: "https://www.clinicasorriso.com.br",
  phone: "(54) 99999-1234",
  city: "Passo Fundo",
  state: "RS",
  niche: "odontologia",
  name: "Ana Souza",
  role: "Sócia",
};

describe("runImport", () => {
  it("creates leads with provenance and a timeline entry", async () => {
    const report = await csvImport([sorriso]);
    expect(report.counts).toMatchObject({ created: 1, merged: 0 });
    const [company] = await db.select().from(companies);
    expect(company).toMatchObject({
      domain: "clinicasorriso.com.br",
      phoneE164: "+5554999991234",
      stage: "discovered",
    });
    expect(await countRows(db, "contacts")).toBe(1);
    const fields = (await db.select().from(fieldSources)).map((f) => `${f.entityType}.${f.field}`).sort();
    expect(fields).toContain("company.phoneE164");
    expect(fields).toContain("contact.role");
    expect((await db.select().from(fieldSources))[0]?.sourceRef).toBe(`import:${report.importId}`);
    expect(await countRows(db, "stage_events")).toBe(1);
  });

  it("is idempotent: the same file again creates nothing new", async () => {
    const first = await csvImport([sorriso, { company: "Pizzaria Bella", city: "Erechim" }], "same-content");
    const second = await csvImport([sorriso, { company: "Pizzaria Bella", city: "Erechim" }], "same-content");
    expect(first.counts.created).toBe(2);
    expect(second.counts).toMatchObject({ created: 0, merged: 1, review: 1 });
    expect(second.previousImportId).toBe(first.importId);
    expect(await countRows(db, "contacts")).toBe(1);
  });

  it("dry run reports the outcome and writes nothing", async () => {
    const report = await runImport(
      db,
      deps,
      { source: "manual_paste", content: "x", rows: [sorriso, { company: "" }] },
      { dryRun: true },
    );
    expect(report.importId).toBeNull();
    expect(report.counts).toMatchObject({ created: 1, invalid: 1 });
    for (const t of TABLES) expect(await countRows(db, t)).toBe(0);
  });

  it("a failure mid-import leaves no partial rows", async () => {
    // A real database error on the third row, not a mocked one.
    await db.execute(sql`
      create or replace function fail_on_boom() returns trigger language plpgsql as $$
      begin
        if new.name = 'BOOM' then raise exception 'simulated failure'; end if;
        return new;
      end $$`);
    await db.execute(
      sql`create trigger fail_on_boom before insert on companies for each row execute function fail_on_boom()`,
    );
    try {
      await expect(
        csvImport([sorriso, { company: "Pizzaria Bella", city: "Erechim" }, { company: "BOOM" }]),
      ).rejects.toThrow();
      for (const t of TABLES) expect(await countRows(db, t), t).toBe(0);
    } finally {
      await db.execute(sql`drop trigger if exists fail_on_boom on companies`);
      await db.execute(sql`drop function if exists fail_on_boom()`);
    }
  });

  it("dedupes rows within one import", async () => {
    const report = await csvImport([sorriso, { ...sorriso, email: "contato@clinicasorriso.com.br" }]);
    expect(report.counts).toMatchObject({ created: 1, merged: 1 });
    const [company] = await db.select().from(companies);
    expect(company?.email).toBe("contato@clinicasorriso.com.br");
  });

  it("merges on domain without overwriting existing values", async () => {
    await csvImport([sorriso]);
    const report = await csvImport([
      { company: "Sorriso", website: "clinicasorriso.com.br", city: "Passo Fundo", phone: "(54) 3333-4444" },
    ]);
    expect(report.rows[0]?.outcome).toBe("merged");
    const [company] = await db.select().from(companies);
    expect(company?.phoneE164).toBe("+5554999991234");
    const phones = await db.select().from(fieldSources).where(eq(fieldSources.field, "phoneE164"));
    expect(phones.map((p) => p.value).sort()).toEqual(["+555433334444", "+5554999991234"]);
  });

  it("sends a domain match in another city to review instead of merging", async () => {
    await csvImport([sorriso]);
    const report = await csvImport([{ company: "Clínica Sorriso", website: "clinicasorriso.com.br", city: "Erechim" }]);
    expect(report.rows[0]?.outcome).toBe("review");
    expect(await countRows(db, "companies")).toBe(2);
    const [cand] = await db.select().from(dedupeCandidates);
    expect(cand?.rule).toBe("domain_city_mismatch");
  });

  it("sends a phone match with a dissimilar name to review", async () => {
    await csvImport([sorriso]);
    const report = await csvImport([{ company: "Imobiliária Pampa", phone: "54 99999 1234", city: "Passo Fundo" }]);
    expect(report.rows[0]?.outcome).toBe("review");
    const [cand] = await db.select().from(dedupeCandidates);
    expect(cand?.rule).toBe("phone_name_mismatch");
    expect(cand?.similarity).toBeLessThan(0.5);
  });

  it("merges a phone match when the names agree once niche words are stripped", async () => {
    await csvImport([sorriso]);
    const report = await csvImport([{ company: "Sorriso Odontologia", phone: "+55 54 99999-1234" }]);
    expect(report.rows[0]?.outcome).toBe("merged");
  });

  it("flags fuzzy name matches in the same city using pg_trgm and the configured threshold", async () => {
    await csvImport([{ company: "Clínica Odontológica Sorriso", city: "Passo Fundo" }]);
    const report = await csvImport([{ company: "Sorriso Odontologia", city: "passo fundo" }]);
    expect(report.rows[0]?.outcome).toBe("review");
    const [cand] = await db.select().from(dedupeCandidates);
    expect(cand).toMatchObject({ rule: "fuzzy_name_city", similarity: 1 });

    const strict = { ...deps, config: { ...deps.config, dedupe: { ...deps.config.dedupe, fuzzyThreshold: 1.01 } } };
    const r2 = await runImport(
      db,
      strict,
      { source: "manual_csv", content: "z", rows: [{ company: "Sorriso Clínica", city: "Passo Fundo" }] },
      { dryRun: true },
    );
    expect(r2.rows[0]?.outcome).toBe("created");
  });

  it("drops suppressed rows without keeping their data, and opts out existing leads", async () => {
    await csvImport([sorriso]);
    const added = await addSuppression(
      db,
      { kind: "phone", value: "(54) 99999-1234", reason: "asked to stop" },
      SECRET,
    );
    expect(added).toEqual({ ok: true, optedOut: 1 });
    const [company] = await db.select().from(companies);
    expect(company?.stage).toBe("opted_out");

    const report = await csvImport([{ company: "Outra Empresa", phone: "54999991234" }]);
    expect(report.rows[0]?.outcome).toBe("suppressed");
    const [row] = await db
      .select()
      .from(importRows)
      .where(eq(importRows.importId, report.importId as string));
    expect(row?.raw).toBeNull();
    expect(await countRows(db, "companies")).toBe(1);
  });

  it("records invalid rows with reasons", async () => {
    const report = await csvImport([{ company: "" }, sorriso]);
    expect(report.rows[0]).toMatchObject({ outcome: "invalid", messages: ["company: company is required"] });
    expect(report.counts.created).toBe(1);
  });
});

describe("dedupe review", () => {
  it("merging moves contacts, provenance and timeline, fills gaps, and deletes the duplicate", async () => {
    await csvImport([{ ...sorriso, website: "" }]);
    await csvImport([
      { company: "Sorriso Odontologia", city: "Passo Fundo", email: "oi@sorriso.com.br", name: "Bruno Lima" },
    ]);
    const [cand] = await db.select().from(dedupeCandidates);
    const keptId = await mergeCandidate(db, cand?.id as string);
    expect(keptId).toBe(cand?.companyA);
    const all = await db.select().from(companies);
    expect(all).toHaveLength(1);
    expect(all[0]?.email).toBe("oi@sorriso.com.br");
    expect((await db.select().from(contacts)).map((c) => c.name).sort()).toEqual(["Ana Souza", "Bruno Lima"]);
    const events = await db
      .select()
      .from(stageEvents)
      .where(eq(stageEvents.companyId, keptId as string));
    expect(events.some((e) => e.note?.startsWith("merged duplicate"))).toBe(true);
    expect(await countRows(db, "dedupe_candidates")).toBe(0);
    expect(await mergeCandidate(db, cand?.id as string)).toBeNull();
  });
});

describe("LGPD delete", () => {
  it("removes the lead and its raw import rows, and suppresses it for future imports", async () => {
    await csvImport([{ ...sorriso, email: "contato@clinicasorriso.com.br" }]);
    const [company] = await db.select().from(companies);
    expect(await deleteLead(db, company?.id as string, { suppress: true, secret: SECRET })).toBe(true);
    for (const t of ["companies", "contacts", "field_sources", "import_rows", "stage_events"]) {
      expect(await countRows(db, t), t).toBe(0);
    }
    expect(await countRows(db, "suppressions")).toBe(3); // email, phone, domain
    const report = await csvImport([{ company: "Whatever", website: "clinicasorriso.com.br" }]);
    expect(report.rows[0]?.outcome).toBe("suppressed");
  });
});
