import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.ts";
import { prepareLead } from "../src/lead.ts";
import { applyMapping, autoMapHeaders } from "../src/mapping.ts";
import { hashSuppressionKey, suppressionKeysFor } from "../src/suppression.ts";

describe("prepareLead", () => {
  it("normalizes a full row and routes URLs by kind", () => {
    const r = prepareLead(
      {
        company: "Clínica Sorriso LTDA",
        name: "Ana Souza",
        role: "Sócia",
        url: "https://www.linkedin.com/in/ana",
        website: "www.clinicasorriso.com.br",
        instagram: "@clinicasorriso",
        email: "Contato@ClinicaSorriso.com.br",
        phone: "(54) 99999-1234",
        city: "Passo Fundo",
        state: "rs",
        cnpj: "11.222.333/0001-81",
        niche: "odontologia",
        notes: "met at event",
      },
      defaultConfig,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    expect(r.lead).toMatchObject({
      normalizedName: "clinica sorriso",
      matchName: "sorriso",
      cityNormalized: "passo fundo",
      state: "RS",
      domain: "clinicasorriso.com.br",
      websiteUrl: "https://www.clinicasorriso.com.br",
      phoneE164: "+5554999991234",
      email: "contato@clinicasorriso.com.br",
      cnpj: "11222333000181",
      instagramHandle: "clinicasorriso",
      notes: null,
      contact: {
        name: "Ana Souza",
        role: "Sócia",
        linkedinUrl: "https://www.linkedin.com/in/ana",
        notes: "met at event",
      },
    });
  });

  it("requires a company and reports why", () => {
    const r = prepareLead({ company: "  ", email: "a@b.com" }, defaultConfig);
    expect(r).toEqual({ ok: false, errors: ["company: company is required"] });
  });

  it("drops bad optional fields with warnings instead of failing the row", () => {
    const r = prepareLead(
      { company: "X", phone: "123", email: "nope", cnpj: "1", url: "javascript:alert(1)" },
      defaultConfig,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lead.phoneE164).toBeNull();
    expect(r.lead.email).toBeNull();
    expect(r.lead.cnpj).toBeNull();
    expect(r.lead.websiteUrl).toBeNull();
    expect(r.warnings).toHaveLength(4);
  });

  it("rejects over-long fields", () => {
    expect(prepareLead({ company: "x".repeat(201) }, defaultConfig).ok).toBe(false);
  });
});

describe("column mapping", () => {
  it("maps Portuguese and English headers, ignoring unknown and repeated ones", () => {
    const m = autoMapHeaders([
      "Empresa",
      "Nome",
      "Cargo",
      "Telefone",
      "E-mail",
      "Cidade",
      "UF",
      "Site",
      "Foo",
      "Empresa",
    ]);
    expect(m).toEqual({
      0: "company",
      1: "name",
      2: "role",
      3: "phone",
      4: "email",
      5: "city",
      6: "state",
      7: "website",
      8: null,
      9: null,
    });
    expect(applyMapping(["Acme", "Ana"], { 0: "company", 1: "name" })).toEqual({ company: "Acme", name: "Ana" });
  });
});

describe("suppression hashing", () => {
  const secret = "s".repeat(32);
  it("is keyed, deterministic and kind-scoped", async () => {
    const a = await hashSuppressionKey({ kind: "email", value: "a@b.com" }, secret);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashSuppressionKey({ kind: "email", value: "a@b.com" }, secret)).toBe(a);
    expect(await hashSuppressionKey({ kind: "email", value: "a@b.com" }, "t".repeat(32))).not.toBe(a);
    expect(await hashSuppressionKey({ kind: "domain", value: "a@b.com" }, secret)).not.toBe(a);
  });
  it("refuses short secrets", async () => {
    await expect(hashSuppressionKey({ kind: "email", value: "a@b.com" }, "short")).rejects.toThrow();
  });
  it("collects every contact key a lead has", () => {
    expect(suppressionKeysFor({ email: "a@b.com", phoneE164: null, domain: "b.com", cnpj: null })).toEqual([
      { kind: "email", value: "a@b.com" },
      { kind: "domain", value: "b.com" },
    ]);
  });
});
