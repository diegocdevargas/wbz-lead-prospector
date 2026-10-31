import { DomUtils, parseDocument } from "htmlparser2";
import type { Platform } from "./stages.ts";

/** What a homepage tells us, extracted from its HTML. Pure: the fetch happens elsewhere. */
export interface HtmlChecks {
  finalUrl: string;
  https: boolean;
  viewport: boolean;
  title: string | null;
  metaDescription: string | null;
  h1Count: number;
  whatsapp: boolean;
  booking: string[];
  contactForm: boolean;
  copyrightYear: number | null;
  platform: Platform;
  platformEvidence: string[];
  chatWidgets: string[];
  /** Same-site links, absolute, without fragments, for the broken-link sample. */
  internalLinks: string[];
  /** Digits of tel: links, used to confirm the phone found elsewhere. */
  phoneDigits: string[];
  instagramHandles: string[];
}

const PLATFORM_SIGNS: [Platform, RegExp][] = [
  ["woocommerce", /woocommerce/i],
  ["shopify", /cdn\.shopify\.com|shopify\.theme|myshopify\.com|x-shopid|x-shopify|powered-by: shopify/i],
  ["nuvemshop", /nuvemshop|tiendanube|d26lpennugtm8s\.cloudfront\.net/i],
  ["vtex", /vteximg\.com\.br|vtexassets\.com|vtex\.com\.br|vtexcommercestable/i],
  ["linx", /linxcommerce|linximpulse|linx\.com\.br|chaordic/i],
  ["tray", /tray\.com\.br|traycdn|images\.tcdn\.com\.br/i],
  ["loja_integrada", /lojaintegrada|cdn\.awsli\.com\.br/i],
  ["wix", /wixstatic\.com|wix\.com website builder|_wixcss|parastorage\.com/i],
  ["squarespace", /squarespace\.com|static1\.squarespace/i],
  ["wordpress", /\/wp-content\/|\/wp-includes\/|wordpress/i],
];

const BOOKING_SIGNS: [string, RegExp][] = [
  ["Calendly", /calendly\.com/i],
  ["Doctoralia", /doctoralia\.com/i],
  ["Agendor", /agendor\.com/i],
  ["Google Agenda", /calendar\.app\.google|google\.com\/calendar\/(appointments|u\/\d\/appointments)/i],
  ["Cal.com", /\bcal\.com\//i],
  ["SimplyBook", /simplybook\.(me|it)/i],
  ["Trinks", /trinks\.com/i],
  ["Feegow", /feegow\.com/i],
  ["iClinic", /iclinic\.com\.br/i],
  ["Agenda online", /agendamento-online|agende-online|agendar-online|\/agendamento\b/i],
];

const CHAT_SIGNS: [string, RegExp][] = [
  ["Tawk.to", /tawk\.to/i],
  ["JivoChat", /jivosite\.com|jivochat/i],
  ["Zendesk", /zdassets\.com|zopim/i],
  ["Intercom", /intercom(cdn)?\.(io|com)/i],
  ["Crisp", /client\.crisp\.chat/i],
  ["Tidio", /tidio(chat)?\.co/i],
  ["HubSpot", /js\.hs-scripts\.com|usemessages\.com/i],
  ["Drift", /js\.driftt\.com/i],
  ["Blip", /blip\.ai|take\.net/i],
  ["Octadesk", /octadesk/i],
  ["Zenvia", /zenvia/i],
  ["ManyChat", /manychat/i],
];

const WHATSAPP =
  /(^|\/\/)(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com|chat\.whatsapp\.com|wa\.link)\b|^whatsapp:|joinchat|click-to-chat|wpp-button/i;
const FORM_PLUGINS =
  /wpcf7|wpforms|elementor-form|gform_|ninja-forms|formidable|rdstation-form|jotform|typeform\.com|forms\.gle|docs\.google\.com\/forms/i;
const COPYRIGHT = /(?:©|\(c\)|copyright|todos os direitos)[^0-9]{0,40}(?:(\d{4})\s*[-–—/]\s*)?(\d{4})/gi;

export function extractHtmlChecks(
  html: string,
  finalUrl: string,
  opts: { headers?: Record<string, string>; now?: Date } = {},
): HtmlChecks {
  const doc = parseDocument(html, { lowerCaseTags: true, lowerCaseAttributeNames: true });
  const base = new URL(finalUrl);
  const now = opts.now ?? new Date();
  const all = DomUtils.getElementsByTagName(() => true, doc, true);
  const byTag = (tag: string) => all.filter((e) => e.name === tag);
  const attr = (e: (typeof all)[number], name: string) => e.attribs[name]?.trim() ?? "";

  const meta = (name: string) =>
    byTag("meta").find((m) => attr(m, "name").toLowerCase() === name || attr(m, "property").toLowerCase() === name);
  const titleEl = byTag("title")[0];
  const title = titleEl ? clean(DomUtils.textContent(titleEl)) : null;
  const description = meta("description") ?? meta("og:description");

  // Everything that references code or links, for fingerprinting.
  const refs: string[] = [];
  for (const e of all) {
    for (const k of ["src", "href", "action", "class", "id", "data-src", "content"]) {
      const v = e.attribs[k];
      if (v) refs.push(v);
    }
    if (e.name === "script") refs.push(DomUtils.textContent(e).slice(0, 5000));
  }
  const generator = attr(meta("generator") ?? ({ attribs: {} } as never), "content");
  const headerText = Object.entries(opts.headers ?? {})
    .filter(([k]) => /^(x-powered-by|server|x-shopid|x-shopify-stage|x-wix-request-id|x-vtex-.*|powered-by)$/i.test(k))
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const haystack = [generator, headerText, ...refs].join("\n");

  const platformEvidence: string[] = [];
  let platform: Platform = "custom";
  for (const [p, re] of PLATFORM_SIGNS) {
    const m = haystack.match(re);
    if (m) {
      platform = p;
      platformEvidence.push(m[0].slice(0, 80));
      break;
    }
  }

  const links = byTag("a")
    .map((a) => attr(a, "href"))
    .filter(Boolean);
  const absolute = links.flatMap((h) => {
    try {
      return [new URL(h, base)];
    } catch {
      return [];
    }
  });
  const sameSite = (u: URL) => u.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "");
  const internalLinks = [
    ...new Set(
      absolute
        .filter((u) => (u.protocol === "http:" || u.protocol === "https:") && sameSite(u))
        .map((u) => {
          u.hash = "";
          return u.toString();
        })
        .filter((u) => u !== base.toString()),
    ),
  ];

  const forms = byTag("form");
  const contactForm =
    forms.some((f) => {
      const inner = DomUtils.getElementsByTagName(() => true, f, true);
      return inner.some(
        (i) =>
          i.name === "textarea" ||
          (i.name === "input" && ["email", "tel"].includes(attr(i, "type").toLowerCase())) ||
          /e-?mail|telefone|mensagem|whats/i.test(attr(i, "name")),
      );
    }) || FORM_PLUGINS.test(haystack);

  const text = visibleText(byTag("body")[0] ?? doc);
  let copyrightYear: number | null = null;
  for (const m of text.matchAll(COPYRIGHT)) {
    const y = Number(m[2]);
    if (y >= 1995 && y <= now.getUTCFullYear() + 1) copyrightYear = Math.max(copyrightYear ?? 0, y);
  }

  const found = (signs: [string, RegExp][]) => signs.filter(([, re]) => re.test(haystack)).map(([n]) => n);

  return {
    finalUrl,
    https: base.protocol === "https:",
    viewport: Boolean(meta("viewport")),
    title: title || null,
    metaDescription: description ? attr(description, "content") || null : null,
    h1Count: byTag("h1").length,
    whatsapp: links.some((h) => WHATSAPP.test(h)) || /joinchat|wa\.me\//i.test(haystack),
    booking: found(BOOKING_SIGNS),
    contactForm,
    copyrightYear,
    platform,
    platformEvidence,
    chatWidgets: found(CHAT_SIGNS),
    internalLinks,
    phoneDigits: [
      ...new Set(
        links
          .filter((h) => /^tel:/i.test(h))
          .map((h) => h.replace(/\D/g, ""))
          .filter((d) => d.length >= 8),
      ),
    ],
    instagramHandles: [
      ...new Set(
        absolute
          .filter((u) => /(^|\.)instagram\.com$/i.test(u.hostname))
          .map((u) => u.pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "")
          .filter((h) => /^[a-z0-9._]{1,30}$/.test(h) && !["p", "reel", "explore", "stories"].includes(h)),
      ),
    ],
  };
}

function clean(s: string | null | undefined): string | null {
  const v = s?.replace(/\s+/g, " ").trim();
  return v ? v : null;
}

interface WalkNode {
  type: string;
  name?: string;
  data?: string;
  children?: WalkNode[];
}
const HIDDEN = new Set(["script", "style", "noscript", "template"]);

/** Text a visitor sees: text nodes outside script, style, noscript and template. */
function visibleText(root: unknown): string {
  const out: string[] = [];
  const walk = (n: WalkNode) => {
    if (n.type === "text" && n.data) out.push(n.data);
    if (n.name && HIDDEN.has(n.name)) return;
    n.children?.forEach(walk);
  };
  walk(root as WalkNode);
  return clean(out.join(" ")) ?? "";
}

/** Visible text of a page, for confirming the business name appears on its own site. */
export function pageText(html: string): string {
  return visibleText(parseDocument(html));
}
