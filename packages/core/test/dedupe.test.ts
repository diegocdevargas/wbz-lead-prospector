import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.ts";
import { decideMatch, type ExistingCompany } from "../src/dedupe.ts";
import { matchName } from "../src/normalize.ts";
import { similarity } from "../src/similarity.ts";

const stop = defaultConfig.dedupe.nicheStopwords;
const co = (id: string, name: string, city: string | null): ExistingCompany => ({
  id,
  matchName: matchName(name, stop),
  cityNormalized: city,
});
const lead = (name: string, city: string | null) => ({ matchName: matchName(name, stop), cityNormalized: city });
const none = { byDomain: null, byPhone: null, byCnpj: null, fuzzy: [] };

describe("similarity (pg_trgm compatible)", () => {
  it("matches known pg_trgm values", () => {
    // Expected values come from Postgres 16: select similarity('sorriso', 'sorriso feliz'), ...
    expect(similarity("sorriso", "sorriso")).toBe(1);
    expect(similarity("sorriso", "sorriso feliz")).toBeCloseTo(0.5714286, 6);
    expect(similarity("imobiliaria pampa", "pizzaria bella napoli")).toBeCloseTo(0.1111111, 6);
    expect(similarity("silva souza", "silva e souza")).toBeCloseTo(0.8461538, 6);
    expect(similarity("ab", "abc")).toBeCloseTo(0.4, 6);
    expect(similarity("abc", "xyz")).toBe(0);
    expect(similarity("", "abc")).toBe(0);
  });
});

describe("decideMatch", () => {
  it("creates when nothing matches", () => {
    expect(decideMatch(lead("Sorriso", "passo fundo"), none, defaultConfig)).toEqual({ kind: "create" });
  });

  it("merges on domain in the same city, or when a city is unknown", () => {
    const a = co("a", "Clínica Sorriso", "passo fundo");
    expect(decideMatch(lead("Sorriso", "passo fundo"), { ...none, byDomain: a }, defaultConfig)).toEqual({
      kind: "merge",
      companyId: "a",
      rule: "domain",
    });
    expect(decideMatch(lead("Sorriso", null), { ...none, byDomain: a }, defaultConfig).kind).toBe("merge");
  });

  it("sends a domain match in a different city to review", () => {
    const a = co("a", "Clínica Sorriso", "passo fundo");
    expect(decideMatch(lead("Clínica Sorriso", "erechim"), { ...none, byDomain: a }, defaultConfig)).toEqual({
      kind: "review",
      candidates: [{ companyId: "a", rule: "domain_city_mismatch", similarity: null }],
    });
  });

  it("merges on phone when names are similar enough", () => {
    const a = co("a", "Clínica Odontológica Sorriso", "passo fundo");
    const d = decideMatch(lead("Sorriso Odontologia", "passo fundo"), { ...none, byPhone: a }, defaultConfig);
    expect(d).toEqual({ kind: "merge", companyId: "a", rule: "phone" });
  });

  it("sends a phone match with dissimilar names (< 0.5) to review", () => {
    const a = co("a", "Imobiliária Pampa", "passo fundo");
    const d = decideMatch(lead("Pizzaria Bella Napoli", "passo fundo"), { ...none, byPhone: a }, defaultConfig);
    expect(d.kind).toBe("review");
    if (d.kind === "review") {
      expect(d.candidates[0]?.rule).toBe("phone_name_mismatch");
      expect(d.candidates[0]?.similarity).toBeLessThan(0.5);
    }
  });

  it("merges on CNPJ", () => {
    const a = co("a", "Anything", null);
    expect(decideMatch(lead("Other", null), { ...none, byCnpj: a }, defaultConfig)).toEqual({
      kind: "merge",
      companyId: "a",
      rule: "cnpj",
    });
  });

  it("follows the spec's order: domain beats phone", () => {
    const a = co("a", "Sorriso", "passo fundo");
    const b = co("b", "Sorriso", "passo fundo");
    const d = decideMatch(lead("Sorriso", "passo fundo"), { ...none, byDomain: a, byPhone: b }, defaultConfig);
    expect(d).toMatchObject({ kind: "merge", companyId: "a" });
  });

  it("flags fuzzy name matches in the same city, ignoring niche words, and never merges them", () => {
    const a = co("a", "Clínica Odontológica Sorriso", "passo fundo");
    const d = decideMatch(lead("Sorriso Odontologia", "passo fundo"), { ...none, fuzzy: [a] }, defaultConfig);
    expect(d).toEqual({
      kind: "review",
      candidates: [{ companyId: "a", rule: "fuzzy_name_city", similarity: 1 }],
    });
  });

  it("ignores fuzzy candidates from another city or below the configured threshold", () => {
    const other = co("a", "Sorriso", "erechim");
    expect(decideMatch(lead("Sorriso", "passo fundo"), { ...none, fuzzy: [other] }, defaultConfig).kind).toBe("create");

    const weak = co("b", "Sorriso Feliz Kids", "passo fundo");
    const strict = { ...defaultConfig, dedupe: { ...defaultConfig.dedupe, fuzzyThreshold: 0.95 } };
    expect(decideMatch(lead("Sorriso", "passo fundo"), { ...none, fuzzy: [weak] }, strict).kind).toBe("create");
  });
});
