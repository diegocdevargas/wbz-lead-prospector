import { parsePhoneNumberFromString } from "libphonenumber-js/max";

/** Lowercase, strip accents, collapse anything non-alphanumeric to single spaces. */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const LEGAL_SUFFIXES = new Set(["ltda", "me", "mei", "epp", "eireli", "sa", "s a", "ss", "slu", "cia"]);

/** Company name for display-independent comparison: no accents, punctuation or legal suffixes. */
export function normalizeCompanyName(input: string | null | undefined): string {
  // Join "S/A" and "S.A." into "sa" before tokenizing so they are caught as a suffix.
  const text = normalizeText((input ?? "").replace(/\bs\s*[./]\s*a\b\.?/gi, "sa"));
  const words = text.split(" ").filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1] as string)) words.pop();
  return words.join(" ");
}

/**
 * Name used for fuzzy matching: the normalized name minus niche words, so
 * "Clínica Odontológica Sorriso" and "Sorriso Odontologia" compare on "sorriso".
 * Falls back to the full normalized name when stripping would leave nothing.
 */
export function matchName(input: string | null | undefined, stopwords: readonly string[]): string {
  const normalized = normalizeCompanyName(input);
  const stop = new Set(stopwords);
  const kept = normalized.split(" ").filter((w) => w && !stop.has(w));
  return kept.length > 0 ? kept.join(" ") : normalized;
}

/** Hosts that are link-in-bio or social profiles, never a company's own domain. */
const NON_COMPANY_HOSTS = [
  "instagram.com",
  "facebook.com",
  "fb.com",
  "linkedin.com",
  "linktr.ee",
  "wa.me",
  "whatsapp.com",
  "api.whatsapp.com",
  "google.com",
  "goo.gl",
  "g.page",
  "maps.app.goo.gl",
  "bit.ly",
  "youtube.com",
  "tiktok.com",
  "x.com",
  "twitter.com",
  "beacons.ai",
  "linkbio.co",
  "taplink.cc",
];

function hostOf(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^[^:/]+:\d/.test(trimmed);
  // Only web URLs: rejects javascript:, data:, mailto: and friends before they can reach an href.
  if (hasScheme && !/^https?:\/\//i.test(trimmed)) return null;
  const withScheme = hasScheme ? trimmed : `https://${trimmed}`;
  try {
    const host = new URL(withScheme).hostname.toLowerCase().replace(/\.$/, "");
    if (!host.includes(".")) return null;
    return host.replace(/^www\d*\./, "");
  } catch {
    return null;
  }
}

/** Absolute http(s) URL for storage and links, or null when not a web URL. */
export function toHttpUrl(url: string | null | undefined): string | null {
  if (!url || !hostOf(url)) return null;
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function isNonCompanyHost(host: string): boolean {
  return NON_COMPANY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Company domain from a website URL, or null when it is missing, invalid or a social/link host. */
export function normalizeDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  const host = hostOf(url);
  if (!host || isNonCompanyHost(host)) return null;
  return host;
}

export type UrlKind = "website" | "linkedin" | "instagram" | "other" | "invalid";

export function classifyUrl(url: string): UrlKind {
  const host = hostOf(url);
  if (!host) return "invalid";
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return "linkedin";
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
  if (isNonCompanyHost(host)) return "other";
  return "website";
}

/** Instagram handle from "@handle", "handle" or an instagram.com URL. */
export function normalizeInstagramHandle(input: string | null | undefined): string | null {
  if (!input) return null;
  let value = input.trim();
  if (/instagram\.com/i.test(value)) {
    const host = hostOf(value);
    if (!host) return null;
    const path = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).pathname;
    value = path.split("/").filter(Boolean)[0] ?? "";
  }
  value = value.replace(/^@/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(value) ? value : null;
}

/** Phone in E.164, Brazil as the default region. Null when it is not a valid number. */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const phone = parsePhoneNumberFromString(input.trim(), "BR");
  return phone?.isValid() ? phone.number : null;
}

export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const email = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** CNPJ as 14 digits when the check digits are valid, else null. */
export function normalizeCnpj(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, "");
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return null;
  const calc = (base: string, weights: number[]) => {
    const sum = weights.reduce((acc, w, i) => acc + Number(base[i]) * w, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = calc(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(digits.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digits.endsWith(`${d1}${d2}`) ? digits : null;
}

export function normalizeState(input: string | null | undefined): string | null {
  const value = normalizeText(input).replace(/ /g, "").toUpperCase();
  return /^[A-Z]{2}$/.test(value) ? value : null;
}

/** Mask a phone or email for logs: keep just enough to tell records apart. */
export function maskPii(value: string | null | undefined): string {
  if (!value) return "";
  const at = value.indexOf("@");
  if (at > 0) return `${value[0]}***${value.slice(at)}`;
  return value.length > 4 ? `***${value.slice(-4)}` : "***";
}
