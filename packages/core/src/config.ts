import { z } from "zod";

/**
 * Tunables that are not secrets. Everything has a sane default so the app
 * boots with no config; override via the APP_CONFIG env var (JSON).
 */
export const appConfigSchema = z.object({
  models: z
    .object({
      bulk: z.string().default("claude-haiku-5-5"),
      drafting: z.string().default("claude-sonnet-5-5"),
      agent: z.string().default("claude-sonnet-5-5"),
    })
    .prefault({}),
  dedupe: z
    .object({
      /** pg_trgm-style similarity (0..1) on niche-stripped names, same city, to flag a fuzzy duplicate. */
      fuzzyThreshold: z.number().min(0).max(1).default(0.6),
      /** A phone match whose names are less similar than this goes to review instead of merging. */
      phoneNameMinSimilarity: z.number().min(0).max(1).default(0.5),
      /** Words stripped from normalized names before fuzzy matching (accent-free, lowercase). */
      nicheStopwords: z.array(z.string()).default([
        // connectors
        "de",
        "da",
        "do",
        "das",
        "dos",
        "e",
        "em",
        "the",
        "and",
        // health / dental
        "clinica",
        "clinicas",
        "consultorio",
        "odontologia",
        "odontologica",
        "odontologico",
        "odonto",
        "dentista",
        "dentistas",
        "dental",
        "saude",
        "medica",
        "medico",
        "medicina",
        "estetica",
        "fisioterapia",
        "psicologia",
        "nutricao",
        "veterinaria",
        "veterinario",
        // legal / real estate / services
        "advocacia",
        "advogados",
        "advogado",
        "associados",
        "escritorio",
        "imobiliaria",
        "imoveis",
        "corretora",
        "contabilidade",
        "contabil",
        "consultoria",
        "servicos",
        // retail / other common niches
        "academia",
        "escola",
        "colegio",
        "studio",
        "estudio",
        "salao",
        "barbearia",
        "restaurante",
        "pet",
        "shop",
        "loja",
        "comercio",
        "centro",
        "grupo",
      ]),
    })
    .prefault({}),
  places: z
    .object({
      /** Text Search (New) pages per query; each page is one billed request with up to 20 results. */
      maxPagesPerQuery: z.number().int().min(1).max(3).default(3),
      /** Default request cap for a new campaign (Text Search + Place Details calls). */
      defaultRequestCap: z.number().int().positive().default(100),
      /** List-price estimates in USD per request, for the spend display. Free monthly usage is not subtracted. */
      textSearchCostUsd: z.number().nonnegative().default(0.035),
      placeDetailsCostUsd: z.number().nonnegative().default(0.025),
      /** Google's terms: only place_id may be kept indefinitely. Other Places values expire after this. */
      contentTtlDays: z.number().int().positive().max(30).default(30),
      /** Max Places calls per second across the app (token bucket). */
      ratePerSecond: z.number().positive().default(5),
      /** Fetch the 5 most relevant reviews (Place Details) during the audit and count pain phrases. */
      reviewSignals: z.boolean().default(true),
      languageCode: z.string().default("pt-BR"),
      regionCode: z.string().default("BR"),
    })
    .prefault({}),
  audit: z
    .object({
      timeoutMs: z.number().int().positive().max(30_000).default(10_000),
      maxBytes: z
        .number()
        .int()
        .positive()
        .default(2 * 1024 * 1024),
      maxRedirects: z.number().int().min(0).max(10).default(5),
      /** Internal links checked for 404s per audit. */
      linkSample: z.number().int().min(0).max(50).default(20),
      pagespeedTimeoutMs: z.number().int().positive().default(60_000),
      /** PageSpeed results are reused for this long. */
      pagespeedCacheDays: z.number().int().positive().default(7),
      userAgent: z.string().default("WebcraftzProspectorAudit/1.0 (+site audit; contact via site owner)"),
      /** Raw HTML excerpts and raw API responses are deleted after this many days (docs/security.md). */
      rawRetentionDays: z.number().int().positive().default(90),
    })
    .prefault({}),
  findings: z
    .object({
      /** PageSpeed mobile performance below this is a finding. */
      poorPerformanceScore: z.number().int().min(0).max(100).default(50),
      slowLcpMs: z.number().int().positive().default(4000),
      poorCls: z.number().positive().default(0.25),
      slowInpMs: z.number().int().positive().default(500),
      /** Copyright year this many years behind the current year or more is a finding. */
      staleCopyrightYears: z.number().int().positive().default(2),
      brokenLinksMin: z.number().int().positive().default(1),
      /** Reviews mentioning a pain phrase at least this many times make a finding. */
      reviewPainMin: z.number().int().positive().default(1),
      /** Niches (accent-free substrings) where missing online booking is a finding. */
      bookingNicheKeywords: z
        .array(z.string())
        .default([
          "clinica",
          "odonto",
          "dent",
          "estetica",
          "fisio",
          "psico",
          "nutri",
          "salao",
          "barbearia",
          "veterin",
          "medic",
          "pilates",
          "academia",
        ]),
    })
    .prefault({}),
  jobs: z
    .object({
      maxAttempts: z.number().int().min(1).max(20).default(5),
      /** Retry delay = base × 4^(attempt-1), capped at 6h. */
      backoffBaseSeconds: z.number().int().positive().default(30),
      /** A job stuck in `running` longer than this is considered lost and retried. */
      staleRunningMinutes: z.number().int().positive().default(15),
    })
    .prefault({}),
  import: z
    .object({
      maxRows: z.number().int().positive().default(5000),
      maxBytes: z
        .number()
        .int()
        .positive()
        .default(5 * 1024 * 1024),
    })
    .prefault({}),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export function loadAppConfig(raw?: string | null): AppConfig {
  const parsed = raw ? JSON.parse(raw) : {};
  return appConfigSchema.parse(parsed);
}

export const defaultConfig: AppConfig = appConfigSchema.parse({});
