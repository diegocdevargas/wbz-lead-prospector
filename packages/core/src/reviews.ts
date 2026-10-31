import { normalizeText } from "./normalize.ts";

/**
 * Deterministic pain-phrase detection in Google review text. Only the counts
 * are stored; review text and reviewer names are not (Places terms + LGPD).
 * The Haiku summary comes in M3.
 */
export const PAIN_PATTERNS = {
  slow_reply: [
    "demora para responder",
    "demoram para responder",
    "demora pra responder",
    "demoram pra responder",
    "demora no atendimento",
    "demorou para responder",
    "nao respondem",
    "nao responde",
    "nunca respondem",
    "sem resposta",
    "ninguem responde",
  ],
  whatsapp: [
    "nao atendem o whatsapp",
    "nao responde o whatsapp",
    "nao respondem o whatsapp",
    "nao atende o whatsapp",
    "nao atende no whatsapp",
    "mensagem no whatsapp e nada",
    "nao respondem no whats",
    "nao responde no whats",
  ],
  phone: [
    "nao atendem o telefone",
    "nao atende o telefone",
    "telefone so chama",
    "ninguem atende",
    "nao atendem as ligacoes",
    "dificil falar com",
  ],
  booking: [
    "dificil agendar",
    "dificil marcar",
    "dificuldade para agendar",
    "dificuldade de agendar",
    "nao consegui agendar",
    "nao consegui marcar",
    "agendamento complicado",
    "demora para marcar",
  ],
} as const;

export type PainKind = keyof typeof PAIN_PATTERNS;
export type PainCounts = Record<PainKind, number>;

/** How many reviews mention each pain at least once. */
export function countPainPhrases(texts: string[]): { reviewed: number; counts: PainCounts } {
  const counts: PainCounts = { slow_reply: 0, whatsapp: 0, phone: 0, booking: 0 };
  for (const t of texts) {
    const norm = normalizeText(t);
    for (const [kind, phrases] of Object.entries(PAIN_PATTERNS) as [PainKind, readonly string[]][]) {
      if (phrases.some((p) => norm.includes(p))) counts[kind]++;
    }
  }
  return { reviewed: texts.length, counts };
}
