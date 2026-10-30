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
