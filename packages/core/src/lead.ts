import { z } from "zod";
import type { AppConfig } from "./config.ts";
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
  normalizeText,
  toHttpUrl,
} from "./normalize.ts";

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/** One manually imported row after column mapping, before normalization. */
export const rawLeadSchema = z.object({
  company: z.string().trim().min(1, "company is required").max(200),
  name: text(120),
  role: text(120),
  url: text(500),
  website: text(500),
  linkedin: text(500),
  instagram: text(200),
  email: text(254),
  phone: text(40),
  city: text(120),
  state: text(40),
  cnpj: text(30),
  niche: text(120),
  notes: text(2000),
});

export type RawLead = z.input<typeof rawLeadSchema>;
export const LEAD_FIELDS = Object.keys(rawLeadSchema.shape) as (keyof RawLead)[];

export interface NormalizedLead {
  companyName: string;
  normalizedName: string;
  matchName: string;
  city: string | null;
  cityNormalized: string | null;
  state: string | null;
  cnpj: string | null;
  domain: string | null;
  websiteUrl: string | null;
  phoneE164: string | null;
  email: string | null;
  instagramHandle: string | null;
  niche: string | null;
  notes: string | null;
  contact: { name: string; role: string | null; linkedinUrl: string | null; notes: string | null } | null;
}

export type PrepareResult = { ok: true; lead: NormalizedLead; warnings: string[] } | { ok: false; errors: string[] };

/** Validate and normalize one row. Unusable optional fields are dropped with a warning, not fatal. */
export function prepareLead(input: unknown, config: AppConfig): PrepareResult {
  const parsed = rawLeadSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`),
    };
  }
  const raw = parsed.data;
  const warnings: string[] = [];

  let websiteUrl: string | null = null;
  let linkedinUrl: string | null = raw.linkedin ?? null;
  let instagramHandle = normalizeInstagramHandle(raw.instagram);
  if (raw.instagram && !instagramHandle) warnings.push("instagram: not a valid handle, ignored");

  for (const url of [raw.website, raw.url]) {
    if (!url) continue;
    const kind = classifyUrl(url);
    if (kind === "website" && !websiteUrl) websiteUrl = url;
    else if (kind === "linkedin" && !linkedinUrl) linkedinUrl = url;
    else if (kind === "instagram" && !instagramHandle) instagramHandle = normalizeInstagramHandle(url);
    else if (kind === "invalid") warnings.push(`url: "${url}" is not a valid URL, ignored`);
  }
  if (linkedinUrl && classifyUrl(linkedinUrl) !== "linkedin") {
    warnings.push("linkedin: not a linkedin.com URL, ignored");
    linkedinUrl = null;
  }

  websiteUrl = toHttpUrl(websiteUrl);
  linkedinUrl = toHttpUrl(linkedinUrl);
  if (linkedinUrl && !raw.name) {
    warnings.push("linkedin: profile URL without a person name, ignored");
    linkedinUrl = null;
  }

  const phoneE164 = normalizePhone(raw.phone);
  if (raw.phone && !phoneE164) warnings.push("phone: not a valid phone number, ignored");
  const email = normalizeEmail(raw.email);
  if (raw.email && !email) warnings.push("email: not a valid address, ignored");
  const cnpj = normalizeCnpj(raw.cnpj);
  if (raw.cnpj && !cnpj) warnings.push("cnpj: invalid check digits, ignored");
  const state = normalizeState(raw.state);
  if (raw.state && !state) warnings.push("state: use the 2-letter UF, ignored");

  const normalizedName = normalizeCompanyName(raw.company);
  if (!normalizedName) return { ok: false, errors: ["company: has no letters or digits"] };

  return {
    ok: true,
    warnings,
    lead: {
      companyName: raw.company,
      normalizedName,
      matchName: matchName(raw.company, config.dedupe.nicheStopwords),
      city: raw.city ?? null,
      cityNormalized: normalizeText(raw.city) || null,
      state,
      cnpj,
      domain: normalizeDomain(websiteUrl),
      websiteUrl,
      phoneE164,
      email,
      instagramHandle,
      niche: raw.niche ?? null,
      notes: raw.name ? null : (raw.notes ?? null),
      contact: raw.name ? { name: raw.name, role: raw.role ?? null, linkedinUrl, notes: raw.notes ?? null } : null,
    },
  };
}
