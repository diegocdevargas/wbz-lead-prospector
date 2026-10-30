import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.ts";
import {
  classifyUrl,
  matchName,
  normalizeCnpj,
  normalizeCompanyName,
  normalizeDomain,
  normalizeEmail,
  normalizeInstagramHandle,
  normalizePhone,
  normalizeState,
  toHttpUrl,
} from "../src/normalize.ts";

describe("normalizeDomain", () => {
  it.each([
    ["https://www.ClinicaSorriso.com.br/contato?x=1", "clinicasorriso.com.br"],
    ["clinicasorriso.com.br", "clinicasorriso.com.br"],
    ["http://www2.example.com.br", "example.com.br"],
    ["example.com.br:8080/path", "example.com.br"],
    ["sub.example.com.br", "sub.example.com.br"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it.each([
    "https://instagram.com/clinica",
    "linktr.ee/clinica",
    "https://wa.me/5554999999999",
    "https://www.facebook.com/clinica",
    "https://br.linkedin.com/company/x",
    "not a url",
    "localhost",
    "",
    "javascript:alert(1)",
    "javascript://example.com/%0aalert(1)",
    "ftp://example.com",
  ])("rejects %s", (input) => {
    expect(normalizeDomain(input)).toBeNull();
  });
});

describe("classifyUrl / toHttpUrl", () => {
  it("classifies", () => {
    expect(classifyUrl("https://www.linkedin.com/in/fulano")).toBe("linkedin");
    expect(classifyUrl("instagram.com/clinica")).toBe("instagram");
    expect(classifyUrl("linktr.ee/x")).toBe("other");
    expect(classifyUrl("example.com.br")).toBe("website");
    expect(classifyUrl("javascript://linkedin.com/%0aalert(1)")).toBe("invalid");
  });
  it("makes absolute http(s) URLs only", () => {
    expect(toHttpUrl("linkedin.com/in/x")).toBe("https://linkedin.com/in/x");
    expect(toHttpUrl("http://example.com")).toBe("http://example.com");
    expect(toHttpUrl("data:text/html,hi")).toBeNull();
  });
});

describe("normalizePhone", () => {
  it.each([
    ["(54) 99999-1234", "+5554999991234"],
    ["54 99999 1234", "+5554999991234"],
    ["+55 54 99999-1234", "+5554999991234"],
    ["(11) 3333-4444", "+551133334444"],
    ["0800 123 4567", "+558001234567"], // toll-free numbers are valid business numbers
    ["123", null],
    ["", null],
  ])("%s -> %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });
});

describe("normalizeCnpj", () => {
  it("accepts valid CNPJs with or without punctuation", () => {
    expect(normalizeCnpj("11.222.333/0001-81")).toBe("11222333000181");
    expect(normalizeCnpj("11222333000181")).toBe("11222333000181");
  });
  it.each(["11.222.333/0001-82", "00000000000000", "1122233300018", "abc"])("rejects %s", (input) => {
    expect(normalizeCnpj(input)).toBeNull();
  });
});

describe("names", () => {
  it("strips accents, punctuation and legal suffixes", () => {
    expect(normalizeCompanyName("Clínica Sorriso LTDA.")).toBe("clinica sorriso");
    expect(normalizeCompanyName("Imobiliária Pampa S/A")).toBe("imobiliaria pampa");
    expect(normalizeCompanyName("Silva & Souza Advogados - ME")).toBe("silva souza advogados");
    expect(normalizeCompanyName("ME")).toBe("me");
  });

  it("matchName drops niche words but never empties the name", () => {
    const stop = defaultConfig.dedupe.nicheStopwords;
    expect(matchName("Clínica Odontológica Sorriso", stop)).toBe("sorriso");
    expect(matchName("Sorriso Odontologia", stop)).toBe("sorriso");
    expect(matchName("Silva & Souza Advocacia", stop)).toBe("silva souza");
    expect(matchName("Clínica Odontológica", stop)).toBe("clinica odontologica");
  });
});

describe("misc", () => {
  it("emails", () => {
    expect(normalizeEmail(" Contato@Clinica.com.BR ")).toBe("contato@clinica.com.br");
    expect(normalizeEmail("nope@")).toBeNull();
  });
  it("instagram handles", () => {
    expect(normalizeInstagramHandle("@Clinica.Sorriso")).toBe("clinica.sorriso");
    expect(normalizeInstagramHandle("https://www.instagram.com/clinica_sorriso/?hl=pt")).toBe("clinica_sorriso");
    expect(normalizeInstagramHandle("has spaces")).toBeNull();
  });
  it("states", () => {
    expect(normalizeState("rs")).toBe("RS");
    expect(normalizeState("Rio Grande do Sul")).toBeNull();
  });
});
