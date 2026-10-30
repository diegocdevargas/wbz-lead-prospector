import type { NormalizedLead } from "./lead.ts";
import type { SuppressionKind } from "./stages.ts";

export interface SuppressionKey {
  kind: SuppressionKind;
  /** Already-normalized value (E.164 phone, lowercase email, bare domain, 14-digit CNPJ). */
  value: string;
}

export function suppressionKeysFor(
  lead: Pick<NormalizedLead, "email" | "phoneE164" | "domain" | "cnpj">,
): SuppressionKey[] {
  const keys: SuppressionKey[] = [];
  if (lead.email) keys.push({ kind: "email", value: lead.email });
  if (lead.phoneE164) keys.push({ kind: "phone", value: lead.phoneE164 });
  if (lead.domain) keys.push({ kind: "domain", value: lead.domain });
  if (lead.cnpj) keys.push({ kind: "cnpj", value: lead.cnpj });
  return keys;
}

/**
 * Keyed hash (HMAC-SHA256) of a suppression value. Opt-outs must outlive the
 * deleted lead (LGPD), but a plain SHA-256 of a phone number is trivially
 * reversible by brute force, so the hash is keyed with a server secret.
 * Uses Web Crypto, available in both Node 22 and Workers.
 */
export async function hashSuppressionKey(key: SuppressionKey, secret: string): Promise<string> {
  if (secret.length < 32) throw new Error("SUPPRESSION_SECRET must be at least 32 characters");
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(`${key.kind}:${key.value}`));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}
