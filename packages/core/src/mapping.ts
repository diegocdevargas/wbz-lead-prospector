import { LEAD_FIELDS, type RawLead } from "./lead.ts";
import { normalizeText } from "./normalize.ts";

type Field = keyof RawLead;

/** Header aliases (normalized: lowercase, no accents) in Portuguese and English. */
const ALIASES: Record<Field, string[]> = {
  company: ["company", "empresa", "company name", "razao social", "nome fantasia", "negocio", "business"],
  name: ["name", "nome", "contato", "contact", "full name", "nome completo", "pessoa"],
  role: ["role", "cargo", "title", "job title", "funcao", "position"],
  url: ["url", "link", "profile", "perfil"],
  website: ["website", "site", "web", "homepage", "pagina"],
  linkedin: ["linkedin", "linkedin url", "perfil linkedin"],
  instagram: ["instagram", "ig", "insta", "instagram handle"],
  email: ["email", "e mail", "mail", "correio"],
  phone: ["phone", "telefone", "fone", "celular", "whatsapp", "tel", "mobile", "phone number"],
  city: ["city", "cidade", "municipio"],
  state: ["state", "estado", "uf"],
  cnpj: ["cnpj"],
  niche: ["niche", "nicho", "segmento", "ramo", "setor", "industry", "category", "categoria"],
  notes: ["notes", "notas", "observacoes", "obs", "comentarios", "comments", "note"],
};

export type ColumnMapping = Record<number, Field | null>;

/** Guess which lead field each header is. Unknown or repeated headers map to null. */
export function autoMapHeaders(headers: string[]): ColumnMapping {
  const used = new Set<Field>();
  const mapping: ColumnMapping = {};
  headers.forEach((header, index) => {
    const h = normalizeText(header);
    const field = LEAD_FIELDS.find((f) => !used.has(f) && ALIASES[f].includes(h)) ?? null;
    if (field) used.add(field);
    mapping[index] = field;
  });
  return mapping;
}

export function applyMapping(row: string[], mapping: ColumnMapping): Partial<Record<Field, string>> {
  const out: Partial<Record<Field, string>> = {};
  row.forEach((cell, index) => {
    const field = mapping[index];
    if (!field) return;
    out[field] = out[field] ? `${out[field]} ${cell}` : cell;
  });
  return out;
}
