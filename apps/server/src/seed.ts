/**
 * Seeds 20 obviously fake leads (".test" domains, no phone numbers, so no real
 * business is ever touched) for local development. Refuses to run in production.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createNodeDb } from "@wbz/db/node";
import { loadSettings } from "./lib/env.ts";
import { runImport } from "./services/import.ts";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const settings = loadSettings(process.env);
if (settings.env.ENVIRONMENT === "production") {
  console.error("Refusing to seed a production database.");
  process.exit(1);
}

const niches = ["odontologia", "advocacia", "imobiliária", "estética", "academia"];
const cities: [string, string][] = [
  ["Passo Fundo", "RS"],
  ["Erechim", "RS"],
  ["Caxias do Sul", "RS"],
  ["Chapecó", "SC"],
];
const names = ["Sorriso", "Horizonte", "Pampa", "Aurora", "Vale Verde"];

const rows = Array.from({ length: 20 }, (_, i) => {
  const niche = niches[i % niches.length] as string;
  const [city, state] = cities[i % cities.length] as [string, string];
  const base = names[Math.floor(i / 4) % names.length] as string;
  return {
    company: `${base} ${niche[0]?.toUpperCase()}${niche.slice(1)} ${i + 1}`,
    niche,
    city,
    state,
    website: i % 3 === 0 ? "" : `https://exemplo-${i + 1}.test`,
    email: i % 2 === 0 ? `contato@exemplo-${i + 1}.test` : "",
    name: i % 4 === 0 ? `Pessoa Exemplo ${i + 1}` : "",
    role: i % 4 === 0 ? "Sócio(a)" : "",
    notes: "seed data",
  };
});

const { db, close } = createNodeDb(settings.env.DATABASE_URL, 1);
try {
  const report = await runImport(
    db,
    { config: settings.config, suppressionSecret: settings.env.SUPPRESSION_SECRET },
    { source: "manual_csv", filename: "seed.csv", content: JSON.stringify(rows), rows },
    { dryRun: false },
  );
  console.log("seeded:", report.counts);
} finally {
  await close();
}
