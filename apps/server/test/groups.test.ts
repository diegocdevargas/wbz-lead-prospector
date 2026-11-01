import { companies, dedupeCandidates, stageEvents } from "@wbz/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getGroup, groupCandidate, mergeCandidate, ungroupLead } from "../src/services/leads.ts";
import { useTestDb } from "./helpers.ts";

const db = useTestDb();

async function lead(name: string, city = "Chapecó") {
  const [row] = await db
    .insert(companies)
    .values({ name, normalizedName: name.toLowerCase(), matchName: name.toLowerCase(), city, source: "google_places" })
    .returning();
  return row as typeof companies.$inferSelect;
}

async function pair(a: string, b: string) {
  const [row] = await db
    .insert(dedupeCandidates)
    .values({ companyA: a, companyB: b, rule: "domain_city_mismatch" })
    .returning();
  return row?.id as string;
}

const groupOf = async (id: string) => (await db.select().from(companies).where(eq(companies.id, id)))[0]?.groupId;

describe("lead groups (branches)", () => {
  it("links B as a branch of A, resolves the pair and logs it on B's timeline", async () => {
    const a = await lead("Clínica Sorriso Centro");
    const b = await lead("Clínica Sorriso Efapi");
    const cand = await pair(a.id, b.id);
    expect(await groupCandidate(db, cand)).toBe(a.id);
    expect(await groupOf(b.id)).toBe(a.id);
    expect(await groupOf(a.id)).toBeNull();
    const [c] = await db.select().from(dedupeCandidates).where(eq(dedupeCandidates.id, cand));
    expect(c?.status).toBe("grouped");
    const events = await db.select().from(stageEvents).where(eq(stageEvents.companyId, b.id));
    expect(events.some((e) => e.note?.includes("Clínica Sorriso Centro"))).toBe(true);
    expect((await getGroup(db, { id: b.id, groupId: a.id })).map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
    // A resolved pair cannot be grouped again.
    expect(await groupCandidate(db, cand)).toBeNull();
  });

  it("stays one level deep: grouping into a branch points at the main lead, and B's branches follow", async () => {
    const head = await lead("Rede Head");
    const branch = await lead("Rede Filial 1");
    const other = await lead("Rede Filial 2");
    const otherBranch = await lead("Rede Filial 3");
    await groupCandidate(db, await pair(head.id, branch.id));
    await groupCandidate(db, await pair(other.id, otherBranch.id));
    // Pair (branch, other): other and its own branch join head's group.
    expect(await groupCandidate(db, await pair(branch.id, other.id))).toBe(head.id);
    for (const id of [branch.id, other.id, otherBranch.id]) expect(await groupOf(id)).toBe(head.id);
    expect(await getGroup(db, head)).toHaveLength(4);
  });

  it("is a no-op link when B already is A's main lead", async () => {
    const head = await lead("Head");
    const branch = await lead("Branch");
    await groupCandidate(db, await pair(head.id, branch.id));
    expect(await groupCandidate(db, await pair(branch.id, head.id))).toBe(head.id);
    expect(await groupOf(head.id)).toBeNull();
  });

  it("ungroups a branch, or dissolves the group from the main lead", async () => {
    const head = await lead("H");
    const b1 = await lead("B1");
    const b2 = await lead("B2");
    await groupCandidate(db, await pair(head.id, b1.id));
    await groupCandidate(db, await pair(head.id, b2.id));
    expect(await ungroupLead(db, b1.id)).toBe(true);
    expect(await groupOf(b1.id)).toBeNull();
    expect(await groupOf(b2.id)).toBe(head.id);
    expect(await ungroupLead(db, head.id)).toBe(true);
    expect(await groupOf(b2.id)).toBeNull();
    expect(await getGroup(db, head)).toEqual([]);
  });

  it("merging a main lead moves its branches to the kept lead (and never points the kept lead at itself)", async () => {
    const keep = await lead("Keep");
    const drop = await lead("Drop");
    const branch = await lead("Branch of drop");
    await groupCandidate(db, await pair(drop.id, keep.id));
    await groupCandidate(db, await pair(drop.id, branch.id));
    expect(await groupOf(keep.id)).toBe(drop.id);
    expect(await mergeCandidate(db, await pair(keep.id, drop.id))).toBe(keep.id);
    expect(await groupOf(keep.id)).toBeNull();
    expect(await groupOf(branch.id)).toBe(keep.id);
  });
});
