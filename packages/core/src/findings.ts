import type { AppConfig } from "./config.ts";
import type { HtmlChecks } from "./html-audit.ts";
import { normalizeText } from "./normalize.ts";
import type { PainCounts, PainKind } from "./reviews.ts";
import { type AuditStatus, ECOMMERCE_PLATFORMS } from "./stages.ts";

/**
 * Turn raw audit results into short, human-readable findings in Portuguese,
 * each with its evidence. Deterministic rules; thresholds come from config.
 * These feed scoring (M3) and outreach drafts, so every text must be true and
 * specific: it cites the number it is based on.
 */

export type Severity = "high" | "medium" | "low";
export type Offer = "website" | "ecommerce" | "automation";

export interface Finding {
  code: string;
  severity: Severity;
  offer: Offer;
  text: string;
  evidence: Record<string, unknown>;
}

export interface PageSpeedResult {
  score: number | null;
  lcpMs: number | null;
  cls: number | null;
  inpMs: number | null;
}

export interface AuditFacts {
  status: AuditStatus;
  url: string | null;
  niche: string | null;
  error?: string | null;
  html: HtmlChecks | null;
  pagespeed: PageSpeedResult | null;
  brokenLinks: { checked: number; broken: string[] } | null;
  reviews: { reviewed: number; counts: PainCounts } | null;
  place: { rating: number | null; reviewCount: number | null } | null;
}

const n1 = (v: number, digits = 1) =>
  v.toLocaleString("pt-BR", { maximumFractionDigits: digits, minimumFractionDigits: digits });

const PAIN_TEXT: Record<PainKind, string> = {
  slow_reply: "demora para responder",
  whatsapp: "falta de resposta no WhatsApp",
  phone: "dificuldade de falar por telefone",
  booking: "dificuldade para agendar",
};

const PLATFORM_LABEL: Record<string, string> = {
  woocommerce: "WooCommerce",
  shopify: "Shopify",
  nuvemshop: "Nuvemshop",
  vtex: "VTEX",
  linx: "Linx",
  tray: "Tray",
  loja_integrada: "Loja Integrada",
  wix: "Wix",
  squarespace: "Squarespace",
};

export function buildFindings(f: AuditFacts, config: AppConfig, now = new Date()): Finding[] {
  const t = config.findings;
  const out: Finding[] = [];
  const add = (code: string, severity: Severity, offer: Offer, text: string, evidence: Record<string, unknown> = {}) =>
    out.push({ code, severity, offer, text, evidence });

  if (f.reviews) {
    for (const [kind, count] of Object.entries(f.reviews.counts) as [PainKind, number][]) {
      if (count >= t.reviewPainMin) {
        add(
          `reviews_${kind}`,
          "high",
          "automation",
          `${count} de ${f.reviews.reviewed} avaliações recentes no Google reclamam de ${PAIN_TEXT[kind]}.`,
          { reviewed: f.reviews.reviewed, count },
        );
      }
    }
  }

  if (f.status === "no_website") {
    const rating =
      f.place?.rating != null && f.place.reviewCount
        ? ` (nota ${n1(f.place.rating)} com ${f.place.reviewCount} avaliações)`
        : "";
    add("no_website", "high", "website", `Não tem site próprio: no Google aparece sem site${rating}.`, { ...f.place });
    return out;
  }
  if (f.status === "unreachable" || f.status === "blocked") {
    add(
      "site_unreachable",
      "high",
      "website",
      `O site ${f.url ?? ""} não abriu quando testamos (${f.error ?? "sem resposta"}).`,
      {
        url: f.url,
        error: f.error,
      },
    );
    return out;
  }

  const h = f.html;
  const ps = f.pagespeed;
  if (ps?.score != null && ps.score < t.poorPerformanceScore) {
    const time = ps.lcpMs != null ? `leva ${n1(ps.lcpMs / 1000)}s para carregar` : "carrega devagar";
    add(
      "slow_mobile",
      ps.score < 30 ? "high" : "medium",
      "website",
      `Site ${time} no celular (PageSpeed ${ps.score}/100).`,
      { ...ps },
    );
  } else if (ps?.lcpMs != null && ps.lcpMs >= t.slowLcpMs) {
    add(
      "slow_lcp",
      "medium",
      "website",
      `O conteúdo principal leva ${n1(ps.lcpMs / 1000)}s para aparecer no celular.`,
      { ...ps },
    );
  }
  if (ps?.cls != null && ps.cls >= t.poorCls) {
    add("layout_shift", "medium", "website", `O layout "pula" enquanto carrega no celular (CLS ${n1(ps.cls, 2)}).`, {
      cls: ps.cls,
    });
  }
  if (ps?.inpMs != null && ps.inpMs >= t.slowInpMs) {
    add(
      "slow_interaction",
      "medium",
      "website",
      `O site demora para reagir a toques no celular (INP ${Math.round(ps.inpMs)} ms).`,
      {
        inpMs: ps.inpMs,
      },
    );
  }
  if (!h) return out;

  if (!h.https)
    add("no_https", "high", "website", 'O site não usa HTTPS: o navegador mostra "Não seguro" para quem visita.', {
      url: h.finalUrl,
    });
  if (!h.viewport)
    add("no_viewport", "high", "website", "O site não é adaptado para celular (falta a meta tag viewport).");
  if (!h.title)
    add(
      "no_title",
      "low",
      "website",
      "A página inicial não tem título (tag <title>), que o Google usa nos resultados.",
    );
  if (!h.metaDescription) {
    add(
      "no_meta_description",
      "low",
      "website",
      "A página inicial não tem meta description, o texto que o Google mostra abaixo do link.",
    );
  }
  if (h.h1Count === 0)
    add("no_h1", "low", "website", "A página inicial não tem um título principal (H1), o que prejudica o SEO.");

  if (f.brokenLinks && f.brokenLinks.broken.length >= t.brokenLinksMin) {
    const example = f.brokenLinks.broken[0] ? ` (ex.: ${pathOf(f.brokenLinks.broken[0])})` : "";
    add(
      "broken_links",
      "medium",
      "website",
      `${f.brokenLinks.broken.length} de ${f.brokenLinks.checked} links internos testados estão quebrados${example}.`,
      { ...f.brokenLinks },
    );
  }

  if (h.copyrightYear != null && now.getUTCFullYear() - h.copyrightYear >= t.staleCopyrightYears) {
    add(
      "stale_copyright",
      "low",
      "website",
      `O rodapé ainda mostra © ${h.copyrightYear}, sinal de site sem manutenção.`,
      {
        year: h.copyrightYear,
      },
    );
  }

  const isStore = ECOMMERCE_PLATFORMS.includes(h.platform);
  if (isStore) {
    add(
      "ecommerce_platform",
      h.platform === "woocommerce" ? "medium" : "low",
      "ecommerce",
      `Loja virtual em ${PLATFORM_LABEL[h.platform]}.`,
      {
        platform: h.platform,
        evidence: h.platformEvidence,
      },
    );
  } else if (h.platform === "wix" || h.platform === "squarespace") {
    add(
      "site_builder",
      "low",
      "website",
      `Site feito no ${PLATFORM_LABEL[h.platform]}, com pouco controle sobre velocidade e SEO.`,
      {
        platform: h.platform,
      },
    );
  }

  if (!h.whatsapp) add("no_whatsapp", "medium", "automation", "Não há botão ou link de WhatsApp no site.");
  const niche = normalizeText(f.niche);
  const bookingNiche = niche !== "" && t.bookingNicheKeywords.some((k) => niche.includes(k));
  if (bookingNiche && h.booking.length === 0) {
    add(
      "no_online_booking",
      "medium",
      "automation",
      "Não há agendamento online no site: marcar horário depende de ligação ou mensagem.",
    );
  }
  if (!h.contactForm && !h.whatsapp && !isStore) {
    add(
      "no_contact_channel",
      "medium",
      "automation",
      "Não há formulário de contato nem WhatsApp no site: o visitante precisa ligar.",
    );
  }
  return out;
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}
