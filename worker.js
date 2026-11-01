/**
 * rebrandyourbrand — Worker (archivo único GENERADO por build.mjs; no lo edites a mano: edita src/*.js y vuelve a ejecutar "node build.mjs").
 * Groq (Brandi), doble opt-in (con reenvío), Stripe B2B (pago único y rescate), seguimiento con onboarding, EmailOps de fases, valoraciones verificadas y Cron Trigger.
 */

// ══ config.js — Configuración: constantes, límites, catálogo de servicios y expresiones comunes. ══

const GROQ_MODEL = "openai/gpt-oss-20b";

const MAX_OUTPUT_TOKENS = 3000;

const MAX_USER_CHARS = 500;

const MAX_HISTORY_MESSAGES = 24;

const MAX_BODY_BYTES = 32 * 1024;

const MAX_WEBHOOK_BYTES = 256 * 1024;

const EMAIL_COOLDOWN_SECONDS = 300;

const MAX_RESENDS = 3;

const RESEND_COOLDOWN_SECONDS = 60;

const TESTIMONIAL_TTL_SECONDS = 60 * 60 * 24 * 30;

const MAX_APPROVED_TESTIMONIALS = 50;

const STRIPE_TOLERANCE_SECONDS = 300;

const STRIPE_EVENT_TTL_SECONDS = 60 * 60 * 24 * 7;

const PENDING_PROJECT_TTL_SECONDS = 60 * 60 * 24 * 7;

const PENDING_VERIFY_TTL_SECONDS = 60 * 60 * 24;

const SESSION_TTL_SECONDS = 60 * 60 * 2; // Turnstile se resuelve una vez y vale para toda la conversación

const CLIENT_PAUSE_REMINDER_DAYS = 15;

const TACIT_REMINDER_DAYS = 15; // retrocompatibilidad

const RENEWAL_NOTICE_DAYS = 30;

const ABANDON_WARNING_DAYS = 30;

const ABANDON_GRACE_DAYS = 7;

const MAX_PHASE_REVISIONS = 2;

// Importe anual obligatorio de infraestructura técnica web (dominio, correo corporativo, DNS/SSL y despliegue edge) si env.WEB_RENEWAL_EUR no está definida en Cloudflare
const WEB_RENEWAL_EUR = 100;

// Importe fijo de una ronda de ajustes adicional una vez agotadas las incluidas en la fase
const EXTRA_REVISION_EUR = 100;

const DAY_MS = 86400 * 1000;

const APPROVED_KEY = "rybb:approved_testimonials";

const ENABLE_EMAIL_FORM = false;

const ALLOWED_HOSTNAMES = ["rebrandyourbrand.es", "www.rebrandyourbrand.es", "api.rebrandyourbrand.es"];

const ALLOWED_ORIGINS = ["https://rebrandyourbrand.es", "https://www.rebrandyourbrand.es"];

const WORKER_URL = "https://api.rebrandyourbrand.es";

const SITE_URL = "https://rebrandyourbrand.es";

const LANG_ORDER = ["es", "ca", "eu", "en"];

const LANG_NAMES = {
  es: "español",
  ca: "català",
  eu: "euskara",
  en: "English",
};

// ── SERVICIOS SUELTOS: el cliente elige y paga solo lo que necesita ──
// Para añadir un servicio: una entrada aquí, otra en SERVICES del index.html (id + precio),
// sus textos svc-<id> / svc-<id>-desc en el index, y su fase en newPhases() / PHASE_TITLES.

const SERVICES = {
  logo: {
    id: "logo",
    price: 400,
    names: {
      es: "logotipo",
      ca: "logotip",
      eu: "logotipoa",
      en: "logo",
    },
    includes: {
      es: "logotipo principal y versión secundaria, listos para redes, cartelería y facturas (incluye la paleta de empresa de regalo)",
      ca: "logotip principal i versió secundària, llestos per a xarxes, cartelleria i factures (inclou la paleta d'empresa de regal)",
      eu: "logotipo nagusia eta bigarren mailako bertsioa, sareetarako, karteletarako eta fakturetarako prest (opari gisa enpresaren paleta barne)",
      en: "primary and secondary logo, ready for social media, signage and invoices (includes complimentary company palette)",
    },
  },
  paleta: {
    id: "paleta",
    price: 100,
    names: {
      es: "paleta de empresa",
      ca: "paleta d'empresa",
      eu: "enpresaren paleta",
      en: "company color palette",
    },
    includes: {
      es: "colores y tipografías elegidos para tu marca (incluida sin coste adicional al contratar el logotipo)",
      ca: "colors i tipografies triats per a la teva marca (inclosa sense cost addicional en contractar el logotip)",
      eu: "zure markarako aukeratutako koloreak eta tipografiak (kostu gehigarririk gabe barne logotipoa kontratatzean)",
      en: "colors and typefaces chosen for your brand (included at no extra cost when hiring the logo)",
    },
  },
  web: {
    id: "web",
    price: 400,
    names: {
      es: "web",
      ca: "web",
      eu: "webgunea",
      en: "website",
    },
    includes: {
      es: "página web rápida y a tu nombre entregada llave en mano (más 100 €/año de infraestructura técnica: dominio, correo corporativo, DNS y despliegue edge)",
      ca: "pàgina web ràpida i a nom teu lliurada clau en mà (més 100 €/any d'infraestructura tècnica: domini, correu corporatiu, DNS i desplegament edge)",
      eu: "zure izenean egindako webgune azkarra giltza eskuan entregatua (gehi 100 €/urtean azpiegitura teknikoa: domeinua, posta korporatiboa, DNS eta edge hedapena)",
      en: "fast website in your name delivered turnkey (plus €100/year technical infrastructure: domain, corporate email, DNS and edge deployment)",
    },
  },
};

const SERVICE_IDS = Object.keys(SERVICES);

const calcPlanTotal = (ids) => {
  if (!Array.isArray(ids)) return 0;
  const hasLogo = ids.includes("logo");
  return ids.reduce((sum, id) => {
    if (!SERVICES[id]) return sum;
    if (id === "paleta" && hasLogo) return sum;
    return sum + SERVICES[id].price;
  }, 0);
};

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

const EMAIL_FIND = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

const AGREE_RE = /(?<![\p{L}\p{N}])(?:confirmo|confirm|vale|adelante|procedemos|s[ií]|perfecto|de acuerdo|acuerdo|ok|okay|yes|sure|go ahead|d'acord|endavant|bai|ados|aurrera|ederto|primeran)(?![\p{L}\p{N}])/iu;

const DENY_RE = /^\s*(?:no|nope|ez|ezeztatu|cancel\w*)(?![\p{L}\p{N}])/iu;

// Precios oficiales permitidos que Brandi puede mencionar: {0, 100, 400, 500, 800} (0 paleta de regalo con logo, 100 paleta suelta o cuota anual, 400 logo o web, 500 paleta y web, 800 pack completo)
const ALLOWED_EUR = new Set([0, 100, 400, 500, 800]);

const CATALOG = [
  `   - ${SERVICES.logo.names.es}: 400 € — ${SERVICES.logo.includes.es}.`,
  `   - ${SERVICES.paleta.names.es}: 100 € (o 0 € incluida de regalo al contratar el logotipo) — ${SERVICES.paleta.includes.es}.`,
  `   - ${SERVICES.web.names.es}: 400 € — ${SERVICES.web.includes.es}.`,
].join("\n");

// ══ utils.js — Utilidades comunes: idioma, fechas, formato de texto y limpieza de entradas. ══

const HTML_ESC = {
  "\x26": "\x26amp;",
  "<": "\x26lt;",
  ">": "\x26gt;",
  '"': "\x26quot;",
  "'": "\x26#39;",
};

const esc = (s) => String(s ?? "").replace(/[\x26<>"']/g, (c) => HTML_ESC[c]);

// ══════════════════════════════════════════════════════════════════════
// CORREOS Y FORMATO
// Un único diseño para todos los correos. Todo el texto empieza en minúscula
// (es parte de la marca). Los correos al cliente salen en el idioma del pedido
// (es / ca / eu / en); los internos, en español.
// ══════════════════════════════════════════════════════════════════════

const EMAIL_LANGS = ["es", "ca", "eu", "en"];

const pickLang = (l) => (EMAIL_LANGS.includes(l) ? l : "es");

// Las fechas se guardan en ISO y se muestran en el idioma del cliente (hora de Madrid)
const DATE_LOCALES = {
  es: "es-ES",
  ca: "ca-ES",
  eu: "eu-ES",
  en: "en-GB",
};

function fmtDate(value, lang) {
  const d = new Date(value);
  // Proyectos antiguos guardaban la fecha ya formateada (dd/mm/aaaa): se muestra tal cual
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(d.getTime())) return String(value ?? "");
  return new Intl.DateTimeFormat(DATE_LOCALES[pickLang(lang)], {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Madrid",
  }).format(d);
}

const lc1 = (s) => {
  const t = String(s ?? "");
  return t.charAt(0).toLowerCase() + t.slice(1);
};

// Correo enmascarado para mostrar en el navegador (nunca se devuelve el completo)
const maskEmail = (e) => {
  const [u = "", d = ""] = String(e).split("@");
  return `${u.slice(0, 1)}${"*".repeat(Math.min(3, Math.max(0, u.length - 1)))}@${d}`;
};

const bold = (v) => `<strong style="color:#17171A;font-weight:600;">${esc(v)}</strong>`;

const lines = (...items) => items.filter(Boolean).join("<br>");

const htmlToText = (s) =>
  String(s)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\x26quot;/g, '"')
    .replace(/\x26#39;/g, "'")
    .replace(/\x26lt;/g, "<")
    .replace(/\x26gt;/g, ">")
    .replace(/\x26amp;/g, "\x26");

const svcLabel = (ids, lang) =>
  (Array.isArray(ids) ? ids : [])
    .filter((id) => SERVICES[id])
    .map((id) => SERVICES[id].names[pickLang(lang)])
    .join(" + ");

function cleanText(v, max) {
  return typeof v === "string"
    ? v.replace(/https?:\/\/\S+|www\.\S+|[<>]/gi, "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max)
    : "";
}

function cleanInput(v, max) {
  return typeof v === "string"
    ? v.replace(/[<>]/g, "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max)
    : "";
}

function cleanNote(v, max) {
  return typeof v === "string"
    ? v.replace(/[<>]/g, "").replace(/\r\n/g, "\n").trim().slice(0, max)
    : "";
}

function cleanHttpsUrl(v, max = 500) {
  if (typeof v !== "string") return "";
  const trimmed = v.trim().slice(0, max);
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed);
    return u.protocol === "https:" ? u.toString() : "";
  } catch {
    return "";
  }
}

const cleanBrand = (v) => {
  const b = cleanText(v, 80);
  return /^(null|none|n\/a|undefined|desconocida?)$/i.test(b) ? "" : b;
};

function safeFilename(name, fallback = "entregable") {
  if (typeof name !== "string") return fallback;
  const base = name.split(/[/\\]/).pop() || fallback;
  const cleaned = base.replace(/["\r\n\t]/g, "").trim();
  return cleaned.slice(0, 150) || fallback;
}

function buildUrl(path, query = {}) {
  const u = new URL(path, WORKER_URL);
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== "") u.searchParams.set(k, String(v));
  }
  return u.toString();
}

// Idioma por la cabecera Accept-Language (solo cuando todavía no sabemos el idioma del pedido)
function langFromRequest(request) {
  const header = request.headers.get("Accept-Language") || "";
  for (const part of header.split(",")) {
    const primary = part.split(";")[0].trim().toLowerCase().split("-")[0];
    if (EMAIL_LANGS.includes(primary)) return primary;
  }
  return "es";
}

// ══ http.js — Cabeceras HTTP, CSP de páginas y constructores de respuestas. ══

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

const PAGE_CSP = "default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'self' https://checkout.stripe.com; base-uri 'none'; frame-ancestors 'none'";

const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": PAGE_CSP,
  ...SECURITY_HEADERS,
};

class HttpError extends Error {
  constructor(status, code, headers = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function jsonResponse(body, status, origin, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...SECURITY_HEADERS,
      ...(origin ? corsHeaders(origin) : {}),
      ...extra,
    },
  });
}

const htmlResponse = (html, status, extra = {}) =>
  new Response(html, { status, headers: { ...HTML_HEADERS, ...extra } });

const redirectTo = (location) =>
  new Response(null, { status: 303, headers: { Location: location, ...SECURITY_HEADERS } });

// ══ i18n.js — Diccionarios multilingües (es / ca / eu / en) para Brandi, correos y páginas. ══

const MSG = {
  es: {
    fallback: "perdona, ha ocurrido un pequeño desajuste técnico. ¿podrías repetirlo?",
    sent: "¡listo! te acabamos de enviar un correo de verificación. ábrelo y pulsa el botón para confirmar tu briefing y abrir la página de tu proyecto con el pago seguro. si no lo ves, mira en spam o reenvíalo con los botones de abajo.",
  },
  ca: {
    fallback: "perdona, hi ha hagut un petit desajust tècnic. ho pots repetir?",
    sent: "llest! acabem d'enviar-te un correu de verificació. obre'l i prem el botó per confirmar el teu briefing i obrir la pàgina del teu projecte amb el pagament segur. si no el veus, mira el correu brossa o reenvia'l amb els botons de sota.",
  },
  eu: {
    fallback: "barkatu, akats tekniko txiki bat gertatu da. errepika dezakezu?",
    sent: "prest! egiaztatze-mezu bat bidali berri dizugu. ireki eta sakatu botoia zure briefing-a berresteko eta ordainketa segurua duen zure proiektuaren orria irekitzeko. ikusten ez baduzu, begiratu spama edo bidali berriro beheko botoiekin.",
  },
  en: {
    fallback: "apologies, a minor technical glitch occurred. could you rephrase?",
    sent: "all set! we just sent you a verification email. open it and click the button to confirm your briefing and open your project page with secure payment. if you cannot see it, check spam or resend it with the buttons below.",
  },
};

const ASK = {
  es: {
    brand: "¿cómo se llama tu marca o proyecto?",
    services: "¿qué necesitas: logotipo (400 €, incluye paleta de empresa de regalo), paleta de empresa (100 €), web (400 €) o una combinación?",
    email: "¿a qué correo electrónico te enviamos la verificación?",
    domain: "¿cuál es tu dominio o web actual (o cuál te gustaría registrar)?",
  },
  ca: {
    brand: "com es diu la teva marca o projecte?",
    services: "què necessites: logotip (400 €, inclou paleta d'empresa de regal), paleta d'empresa (100 €), web (400 €) o una combinació?",
    email: "a quin correu electrònic t'enviem la verificació?",
    domain: "quin és el teu domini o web actual (o quin t'agradaria registrar)?",
  },
  eu: {
    brand: "nola du izena zure marka edo proiektuak?",
    services: "zer behar duzu: logotipoa (400 €, enpresaren paleta opari barne), enpresaren paleta (100 €), webgunea (400 €) edo konbinazio bat?",
    email: "ze helbide elektronikotara bidaliko dizugu egiaztapena?",
    domain: "zein da zure domeinua edo egungo webgunea (edo zein erregistratu nahiko zenuke)?",
  },
  en: {
    brand: "what is your brand or project called?",
    services: "what do you need: logo (€400, includes complimentary company palette), company color palette (€100), website (€400) or a combination?",
    email: "which email address should we send the verification to?",
    domain: "what is your domain or current website (or which one would you like to register)?",
  },
};

const SUMMARY = {
  es: {
    title: "resumen de tu propuesta:",
    brand: "marca",
    domain: "dominio",
    email: "correo",
    services: "servicios",
    total: "inversión total",
    pay: "pago único de creación del 100 %, sin cuotas mensuales",
    legal: "al confirmar, declaras actuar como empresa o autónomo y aceptas las condiciones de servicio y la política de privacidad.",
    ask: "¿confirmas que quieres recibir el correo de verificación para continuar con el pago seguro?",
  },
  ca: {
    title: "resum de la teva proposta:",
    brand: "marca",
    domain: "domini",
    email: "correu",
    services: "serveis",
    total: "inversió total",
    pay: "pagament únic de creació del 100 %, sense quotes mensuals",
    legal: "en confirmar, declares actuar com a empresa o autònom i acceptes les condicions de servei i la política de privacitat.",
    ask: "confirmes que vols rebre el correu de verificació per continuar amb el pagament segur?",
  },
  eu: {
    title: "zure proposamenaren laburpena:",
    brand: "marka",
    domain: "domeinua",
    email: "posta elektronikoa",
    services: "zerbitzuak",
    total: "guztizko inbertsioa",
    pay: "sorkuntzaren % 100eko ordainketa bakarra, hileroko kuotarik gabe",
    legal: "berrestean, enpresa edo autonomo gisa jokatzen duzula adierazten duzu eta zerbitzu-baldintzak zein pribatutasun-politika onartzen dituzu.",
    ask: "berresten al duzu egiaztatze-mezua jaso nahi duzula ordainketa seguruarekin jarraitzeko?",
  },
  en: {
    title: "summary of your proposal:",
    brand: "brand",
    domain: "domain",
    email: "email",
    services: "services",
    total: "total investment",
    pay: "one-time 100% creation payment, no monthly fees",
    legal: "by confirming, you state that you act as a business or sole trader and accept the terms of service and the privacy policy.",
    ask: "do you confirm you want to receive the verification email to continue to the secure payment?",
  },
};

const eur = (n, lang) => (lang === "en" ? `€${n}` : `${n} €`);

function buildSummary(lang, { brand, email, plan, domain } = {}) {
  const l = pickLang(lang);
  const s = SUMMARY[l] || SUMMARY.es;
  const ids = plan?.ids || plan?.services || [];
  const hasLogo = ids.includes("logo");
  const items = ids.map((id) => {
    const svc = SERVICES[id];
    if (!svc) return `   — ${id}`;
    const isFreePalette = id === "paleta" && hasLogo;
    const priceStr = isFreePalette
      ? (l === "en" ? "€0 — included with logo" : l === "ca" ? "0 € — inclosa amb logotip" : l === "eu" ? "0 € — logotipoarekin barne" : "0 € — incluida con logotipo")
      : eur(svc.price, l);
    return `   — ${svc.names[l] || svc.names.es} (${priceStr}): ${svc.includes[l] || svc.includes.es}`;
  });
  const total = plan?.total != null ? plan.total : ids.reduce((sum, id) => {
    if (id === "paleta" && hasLogo) return sum;
    return sum + (SERVICES[id]?.price || 0);
  }, 0);
  return [
    s.title,
    `— ${s.brand}: ${brand}`,
    domain ? `— ${s.domain}: ${domain}` : null,
    `— ${s.email}: ${email}`,
    `— ${s.services}:`,
    ...items,
    `— ${s.total}: ${eur(total, l)} (${s.pay})`,
    "",
    s.legal,
    "",
    s.ask,
  ].filter(Boolean).join("\n");
}

// Textos de los correos al cliente, en orden estricto es / ca / eu / en
const EM = {
  es: {
    verify: {
      subject: "confirma tu correo para completar el briefing — rebrandyourbrand",
      hello: "hola,",
      intro: (br) => `hemos recibido una petición para iniciar un proyecto${br ? ` para ${br}` : ""} en rebrandyourbrand.`,
      ask: "para garantizar tu seguridad, confirma tu dirección de correo electrónico pulsando el siguiente botón:",
      cta: "verificar correo y abrir mi proyecto",
      ignore: "si no has sido tú, puedes ignorar este mensaje.",
    },
    ack: {
      subject: (br) => `correo verificado — acceso a tu proyecto${br ? ` ${br}` : ""} — rebrandyourbrand`,
      hello: "hola,",
      body: (br) => `correo verificado con éxito. ya tienes lista la página privada de tu proyecto${br ? ` para ${br}` : ""}.`,
      next: "desde el enlace inferior puedes completar el pago seguro en stripe ahora o retomarlo más adelante y consultar el avance de cada fase.",
      cta: "abrir mi proyecto y pago seguro",
      note: "guarda este correo para volver a la página de tu proyecto cuando quieras.",
    },
    paid: {
      subject: (br) => `pago confirmado — seguimiento de tu proyecto ${br}`,
      hello: "hola,",
      intro: (br) => `hemos confirmado correctamente tu pago para el proyecto ${br}.`,
      summary: "resumen de tu contratación:",
      plan: "servicios contratados",
      amount: "importe abonado (pago único)",
      status: "estado actual",
      phase: "fase",
      onboarding: "en la página de tu proyecto puedes dejarnos en un minuto tus enlaces actuales, preferencia de dominio y carpeta con materiales iniciales para arrancar sin esperas.",
      cta: "abrir seguimiento y enviar materiales",
      note: "guarda este correo para consultar el estado y los entregables de tu proyecto en cualquier momento.",
    },
    proposal: {
      subject: (br, ph) => `propuesta lista para revisar — ${ph} — ${br}`,
      hello: "hola,",
      intro: (br, ph) => `tenemos lista la propuesta de la fase ${ph} de tu proyecto ${br}.`,
      openDeliverable: "enlace al entregable o vista previa",
      cta: "revisar propuesta, aprobar o pedir ajustes",
      revisions: "desde el botón superior puedes aprobar la fase por escrito para pasar a la siguiente etapa o escribir directamente los cambios puntuales que necesites dentro de tus 2 rondas de revisión gratuitas.",
    },
    phase: {
      subject: (br) => `novedades en tu proyecto ${br} — fase completada`,
      hello: "hola,",
      intro: (br) => `tenemos novedades sobre el avance de tu proyecto ${br}.`,
      done: "fase completada",
      finished: "tu proyecto ha completado todas sus fases y ha finalizado.",
      next: "nueva fase en curso",
      deliverable: "entregable de la fase",
      cta: "ver seguimiento de mi proyecto",
      note: "puedes consultar el historial de fases y entregables en cualquier momento desde el botón superior.",
    },
    tacitReminder: {
      subject: (br, ph) => `recordatorio de revisión pendiente — ${ph} — ${br}`,
      hello: "hola,",
      intro: (br, ph) => `te escribimos para recordarte que tienes pendiente de validar la propuesta de ${ph} en tu proyecto ${br}.`,
      body: "desde el botón inferior puedes aprobar la propuesta para avanzar a la siguiente etapa o solicitar ajustes si aún tienes rondas de revisión disponibles.",
      cta: "revisar propuesta, aprobar o pedir ajustes",
      note: "avanzamos estrictamente a tu ritmo: si necesitas más tiempo el proyecto permanece en pausa indefinida esperando tus indicaciones, sin que el estudio avance de fase por su cuenta.",
    },
    completion: {
      subject: (br) => `proyecto finalizado con éxito — entrega definitiva de ${br}`,
      hello: "hola,",
      intro: (br) => `¡enhorabuena! tu proyecto ${bold(br)} ha completado todas sus fases y ha finalizado con éxito.`,
      body: "hemos registrado la validación final y ya tienes disponibles todos los archivos definitivos y entregables de tu proyecto.",
      deliverable: "enlace a los archivos definitivos o entregable final",
      cta: "abrir mi proyecto y acceder a los archivos",
      note: "guarda este correo para acceder a tus archivos maestros, facturas y seguimiento en cualquier momento.",
    },
    review: {
      subject: (br) => `¿qué tal ha ido ${br}? tu opinión nos importa`,
      hello: "hola,",
      intro: (br) => `tu proyecto ${br} ha finalizado y queremos darte las gracias por confiar en nosotros.`,
      ask: "si tienes un minuto, nos encantaría conocer tu opinión. tu valoración puede aparecer en nuestra web como testimonio de cliente verificado.",
      thanks: "te lo agradecemos de antemano.",
      cta: "dejar mi valoración",
      note: "este enlace es personal y solo sirve para valorar este proyecto.",
    },
    renewal: {
      subject: (br) => `aviso de renovación anual de dominio y correo — ${br}`,
      hello: "hola,",
      intro: (br, date) => `el periodo anual de infraestructura técnica web (dominio, correo corporativo, dns/ssl y despliegue edge) de ${br} vence el ${date}.`,
      body: (amount) => `el importe de renovación anual de infraestructura es de ${amount} (cubre disponibilidad técnica, certificados y renovaciones; no incluye cambios de contenido ni de diseño). puedes abonarlo desde el botón principal o dar de baja la renovación en un clic si no deseas mantener activos el dominio, el correo y la web al terminar el periodo actual.`,
      ctaPay: "abonar renovación anual",
      cancelLine: "dar de baja la renovación anual en un clic",
      note: "si decides no renovar, no se realizará ningún cargo adicional y el dominio y la web dejarán de estar activos al finalizar el periodo vigente.",
    },
    infra: {
      subject: (br) => `información sobre la infraestructura anual de tu web — ${br}`,
      hello: "hola,",
      intro: (br) => `al incluir el desarrollo web en tu proyecto ${bold(br)}, queremos darte total transparencia sobre cómo funciona la cuota anual de infraestructura técnica (100 €/año a partir del segundo año).`,
      coveredTitle: bold("qué cubre exactamente la cuota de 100 €/año:"),
      itemDomain: "— registro y renovación anual de tu dominio propio a tu nombre",
      itemEmail: "— buzón y servicio de correo electrónico corporativo profesional",
      itemSsl: "— gestión de dns y certificados de seguridad ssl de alta disponibilidad",
      itemEdge: "— alojamiento y despliegue continuo en red global edge de máxima velocidad",
      scopeNote: "alcance estricto: esta cuota garantiza la operatividad y renovaciones técnicas de tu web. no incluye mantenimiento de contenidos, textos, fotografías ni nuevas secciones tras la entrega (los ajustes durante la creación incluyen 2 rondas de revisión gratuitas por fase; cualquier cambio extra posterior se factura a 100 € por ronda).",
      cancelNote: "sin sorpresas ni permanencias: 30 días antes de cada vencimiento anual recibirás un aviso por correo con el enlace de pago y un botón directo de baja en un clic. si decides no renovar, no habrá ningún cobro adicional.",
      cta: "ver seguimiento de mi proyecto",
      note: "tienes las condiciones completas disponibles en rebrandyourbrand.es/#terminos.",
    },
    abandonWarning: {
      subject: (br) => `aviso de inactividad — plazo de 7 días antes de la rescisión de ${br}`,
      hello: "hola,",
      intro: (br) => `tu proyecto ${bold(br)} acumula 30 días naturales sin actividad ni respuesta conforme a la cláusula 3.2 de las condiciones del servicio.`,
      body: "dispones de un plazo final de 7 días naturales para aportar los materiales pendientes o validar la propuesta en curso. si transcurrido este plazo no recibimos respuesta, el expediente se dará por abandonado y quedará rescindido formalmente.",
      cta: "acceder a mi proyecto y retomar el trabajo",
      note: "puedes consultar las condiciones del servicio en rebrandyourbrand.es/#terminos.",
    },
    abandoned: {
      subject: (br) => `notificación de rescisión por abandono — ${br}`,
      hello: "hola,",
      intro: (br) => `te comunicamos la rescisión formal de tu proyecto ${bold(br)} por inactividad prolongada conforme a la cláusula 3.2 de las condiciones del servicio.`,
      body: "habiendo transcurrido más de 37 días naturales sin recepción de materiales ni respuesta tras el preaviso reglamentario, el expediente ha quedado cerrado definitivamente.",
      cta: "ver estado del expediente",
      note: "de conformidad con la cláusula 3.2, los importes abonados se conservan en concepto de compensación por reserva de agenda y trabajos preparatorios.",
    },
    chat: {
      confirmSubject: (br) => `hemos recibido tu mensaje — ${br}`,
      hello: "hola,",
      confirmReceived: (br) => `hemos recibido correctamente tu mensaje para el equipo en el chat del proyecto ${br}:`,
      confirmSoon: "gael o bernat te responderán en breve desde el estudio en tu panel de seguimiento.",
      replySubject: (br) => `nueva respuesta de gael y bernat — ${br}`,
      replyIntro: (br) => `gael y bernat han respondido a tu consulta en el proyecto ${br}:`,
      viewPortal: "ver respuesta en el panel de seguimiento",
      autoTranslatedNotice: "traducido automáticamente del original en español",
    },
  },
  ca: {
    verify: {
      subject: "confirma el teu correu per completar el briefing — rebrandyourbrand",
      hello: "hola,",
      intro: (br) => `hem rebut una petició per iniciar un projecte${br ? ` per a ${br}` : ""} a rebrandyourbrand.`,
      ask: "per garantir la teva seguretat, confirma la teva adreça de correu electrònic prement el botó següent:",
      cta: "verificar correu i obrir el meu projecte",
      ignore: "si no has estat tu, pots ignorar aquest missatge.",
    },
    ack: {
      subject: (br) => `correu verificat — accés al teu projecte${br ? ` ${br}` : ""} — rebrandyourbrand`,
      hello: "hola,",
      body: (br) => `correu verificat amb èxit. ja tens a punt la pàgina privada del teu projecte${br ? ` per a ${br}` : ""}.`,
      next: "des de l'enllaç inferior pots completar el pagament segur a stripe ara o reprendre'l més endavant i consultar l'avanç de cada fase.",
      cta: "obrir el meu projecte i pagament segur",
      note: "guarda aquest correu per tornar a la pàgina del teu projecte quan vulguis.",
    },
    paid: {
      subject: (br) => `pagament confirmat — seguiment del teu projecte ${br}`,
      hello: "hola,",
      intro: (br) => `hem confirmat correctament el teu pagament per al projecte ${br}.`,
      summary: "resum de la teva contractació:",
      plan: "serveis contractats",
      amount: "import abonat (pagament únic)",
      status: "estat actual",
      phase: "fase",
      onboarding: "a la pàgina del teu projecte pots deixar-nos en un minut els teus enllaços actuals, preferència de domini i carpeta amb materials inicials per arrencar sense esperes.",
      cta: "obrir seguiment i enviar materials",
      note: "guarda aquest correu per consultar l'estat i els lliurables del teu projecte en qualsevol moment.",
    },
    proposal: {
      subject: (br, ph) => `proposta llesta per revisar — ${ph} — ${br}`,
      hello: "hola,",
      intro: (br, ph) => `tenim a punt la proposta de la fase ${ph} del teu projecte ${br}.`,
      openDeliverable: "enllaç al lliurable o vista prèvia",
      cta: "revisar proposta, aprovar o demanar ajustos",
      revisions: "des del botó superior pots aprovar la fase per escrit per passar a l'etapa següent o escriure directament els canvis puntuals que necessitis dins de les teves 2 rondes de revisió gratuïtes.",
    },
    phase: {
      subject: (br) => `novetats al teu projecte ${br} — fase completada`,
      hello: "hola,",
      intro: (br) => `tenim novetats sobre l'avanç del teu projecte ${br}.`,
      done: "fase completada",
      finished: "el teu projecte ha completat totes les fases i ha finalitzat.",
      next: "nova fase en curs",
      deliverable: "lliurable de la fase",
      cta: "veure el seguiment del meu projecte",
      note: "pots consultar l'historial de fases i lliurables en qualsevol moment des del botó superior.",
    },
    tacitReminder: {
      subject: (br, ph) => `recordatori de revisió pendent — ${ph} — ${br}`,
      hello: "hola,",
      intro: (br, ph) => `t'escrivim per recordar-te que tens pendent de validar la proposta de ${ph} al teu projecte ${br}.`,
      body: "des del botó inferior pots aprovar la proposta per avançar a l'etapa següent o demanar ajustos si encara tens rondes de revisió disponibles.",
      cta: "revisar proposta, aprovar o demanar ajustos",
      note: "avancem estrictament al teu ritme: si necessites més temps el projecte roman en pausa indefinida esperant les teves indicacions, sense que l'estudi avanci de fase pel seu compte.",
    },
    completion: {
      subject: (br) => `projecte finalitzat amb èxit — lliurament definitiu de ${br}`,
      hello: "hola,",
      intro: (br) => `enhorabona! el teu projecte ${bold(br)} ha completat totes les fases i ha finalitzat amb èxit.`,
      body: "hem registrat la validació final i ja tens disponibles tots els arxius definitius i lliurables del teu projecte.",
      deliverable: "enllaç als arxius definitius o lliurable final",
      cta: "obrir el meu projecte i accedir als arxius",
      note: "guarda aquest correu per accedir als teus arxius mestres, factures i seguiment en qualsevol moment.",
    },
    review: {
      subject: (br) => `com ha anat ${br}? la teva opinió ens importa`,
      hello: "hola,",
      intro: (br) => `el teu projecte ${br} ha finalitzat i volem donar-te les gràcies per confiar en nosaltres.`,
      ask: "si tens un minut, ens encantaria conèixer la teva opinió. la teva valoració pot aparèixer a la nostra web com a testimoni de client verificat.",
      thanks: "t'ho agraïm per endavant.",
      cta: "deixar la meva valoració",
      note: "aquest enllaç és personal i només serveix per valorar aquest projecte.",
    },
    renewal: {
      subject: (br) => `avís de renovació anual de domini i correu — ${br}`,
      hello: "hola,",
      intro: (br, date) => `el període anual d'infraestructura tècnica web (domini, correu corporatiu, dns/ssl i desplegament edge) de ${br} venç el ${date}.`,
      body: (amount) => `l'import de renovació anual d'infraestructura és de ${amount} (cobreix disponibilitat tècnica, certificats i renovacions; no inclou canvis de contingut ni de disseny). pots abonar-lo des del botó principal o donar de baixa la renovació en un clic si no vols mantenir actius el domini, el correu i la web en acabar el període actual.`,
      ctaPay: "abonar renovació anual",
      cancelLine: "donar de baixa la renovació anual en un clic",
      note: "si decideixes no renovar, no es farà cap càrrec addicional i el domini i la web deixaran d'estar actius en finalitzar el període vigent.",
    },
    infra: {
      subject: (br) => `informació sobre la infraestructura anual del teu web — ${br}`,
      hello: "hola,",
      intro: (br) => `en incloure el desenvolupament web al teu projecte ${bold(br)}, volem donar-te total transparència sobre com funciona la quota anual d'infraestructura tècnica (100 €/any a partir del segon any).`,
      coveredTitle: bold("què cobreix exactament la quota de 100 €/any:"),
      itemDomain: "— registre i renovació anual del teu domini propi al teu nom",
      itemEmail: "— bústia i servei de correu electrònic corporatiu professional",
      itemSsl: "— gestió de dns i certificats de seguretat ssl d'alta disponibilitat",
      itemEdge: "— allotjament i desplegament continu en xarxa global edge de màxima velocitat",
      scopeNote: "abast estricte: aquesta quota garanteix l'operativitat i renovacions tècniques del teu web. no inclou manteniment de continguts, textos, fotografies ni noves seccions després de l'entrega (els ajustos durant la creació inclouen 2 rondes de revisió gratuïtes per fase; qualsevol canvi extra posterior es factura a 100 € per ronda).",
      cancelNote: "sense sorpreses ni permanències: 30 dies abans de cada venciment anual rebràs un avís per correu amb l'enllaç de pagament i un botó directe de baixa en un clic. si decideixes no renovar, no hi haurà cap cobrament addicional.",
      cta: "veure seguiment del meu projecte",
      note: "tens les condicions completes disponibles a rebrandyourbrand.es/#terminos.",
    },
    abandonWarning: {
      subject: (br) => `avís d'inactivitat — termini de 7 dies abans de la rescissió de ${br}`,
      hello: "hola,",
      intro: (br) => `el teu projecte ${bold(br)} acumula 30 dies naturals sense activitat ni resposta d'acord amb la clàusula 3.2 de les condicions del servei.`,
      body: "disposes d'un termini final de 7 dies naturals per aportar els materials pendents o validar la proposta en curs. si transcorregut aquest termini no rebem resposta, l'expedient es donarà per abandonat i quedarà rescindit formalment.",
      cta: "accedir al meu projecte i reprendre el treball",
      note: "pots consultar les condicions del servei a rebrandyourbrand.es/#terminos.",
    },
    abandoned: {
      subject: (br) => `notificació de rescissió per abandonament — ${br}`,
      hello: "hola,",
      intro: (br) => `et comuniquem la rescissió formal del teu projecte ${bold(br)} per inactivitat prolongada d'acord amb la clàusula 3.2 de les condicions del servei.`,
      body: "havent transcorregut més de 37 dies naturals sense recepció de materials ni resposta després del preavís reglamentari, l'expedient ha quedat tancat definitivament.",
      cta: "veure estat de l'expedient",
      note: "de conformitat amb la clàusula 3.2, els imports abonats es conserven en concepte de compensació per reserva d'agenda i treballs preparatoris.",
    },
    chat: {
      confirmSubject: (br) => `hem rebut el teu missatge — ${br}`,
      hello: "hola,",
      confirmReceived: (br) => `hem rebut correctament el teu missatge per a l'equip al xat del projecte ${br}:`,
      confirmSoon: "en gael o en bernat et respondran ben aviat des de l'estudi al teu panell de seguiment.",
      replySubject: (br) => `nova resposta d'en gael i en bernat — ${br}`,
      replyIntro: (br) => `en gael i en bernat han respost a la teva consulta al projecte ${br}:`,
      viewPortal: "veure resposta al panell de seguiment",
      autoTranslatedNotice: "traduït automàticament de l'original en espanyol",
    },
  },
  eu: {
    verify: {
      subject: "berretsi zure posta briefing-a osatzeko — rebrandyourbrand",
      hello: "kaixo,",
      intro: (br) => `rebrandyourbrand-en proiektu bat hasteko eskaera jaso dugu${br ? ` ${br} markarako` : ""}.`,
      ask: "zure segurtasuna bermatzeko, berretsi zure helbide elektronikoa beheko botoia sakatuta:",
      cta: "posta egiaztatu eta nire proiektua ireki",
      ignore: "zu izan ez bazara, mezu hau baztertu dezakezu.",
    },
    ack: {
      subject: (br) => `posta egiaztatuta — zure proiekturako sarbidea${br ? ` ${br}` : ""} — rebrandyourbrand`,
      hello: "kaixo,",
      body: (br) => `posta behar bezala egiaztatu da. prest duzu zure proiektuaren orri pribatua${br ? ` (${br})` : ""}.`,
      next: "beheko estekatik ordainketa segurua egin dezakezu stripe-n orain edo geroago jarraitu, baita fase bakoitzaren egoera ikusi ere.",
      cta: "ireki nire proiektua eta ordainketa segurua",
      note: "gorde mezu hau zure proiektuaren orrira nahi duzunean itzultzeko.",
    },
    paid: {
      subject: (br) => `ordainketa baieztatuta — zure ${br} proiektuaren jarraipena`,
      hello: "kaixo,",
      intro: (br) => `zure ${br} proiektuaren ordainketa behar bezala baieztatu dugu.`,
      summary: "zure kontratazioaren laburpena:",
      plan: "kontratatutako zerbitzuak",
      amount: "ordaindutako zenbatekoa (ordainketa bakarra)",
      status: "egungo egoera",
      phase: "fasea",
      onboarding: "zure proiektuaren orrian minutu batean utz diezagukezu egungo estekak, domeinu-lehentasuna eta hasierako materialen karpeta itxaronaldirik gabe hasteko.",
      cta: "ireki jarraipena eta bidali materialak",
      note: "gorde mezu hau zure proiektuaren egoera eta entregagarriak edozein unetan kontsultatzeko.",
    },
    proposal: {
      subject: (br, ph) => `proposamena berrikusteko prest — ${ph} — ${br}`,
      hello: "kaixo,",
      intro: (br, ph) => `prest dugu zure ${br} proiektuko ${ph} fasearen proposamena.`,
      openDeliverable: "entregagarrirako edo aurrebistarako esteka",
      cta: "proposamena berrikusi, onartu edo doikuntzak eskatu",
      revisions: "goiko botoitik fasea idatziz onar dezakezu hurrengo etaparantz igarotzeko, edo zuzenean idatzi behar dituzun aldaketa zehatzak barne dituzun doako 2 berrikuspen-txanden barruan.",
    },
    phase: {
      subject: (br) => `berriak zure ${br} proiektuan — fasea osatuta`,
      hello: "kaixo,",
      intro: (br) => `berriak ditugu zure ${br} proiektuaren aurrerapenari buruz.`,
      done: "osatutako fasea",
      finished: "zure proiektuak fase guztiak osatu ditu eta amaitu da.",
      next: "martxan dagoen fase berria",
      deliverable: "faseko entregagarria",
      cta: "ikusi nire proiektuaren jarraipena",
      note: "faseen eta entregagarrien historia edozein unetan kontsulta dezakezu goiko botoitik.",
    },
    tacitReminder: {
      subject: (br, ph) => `berrikuspenaren oroigarria — ${ph} — ${br}`,
      hello: "kaixo,",
      intro: (br, ph) => `zure ${br} proiektuan ${ph} proposamena baliozkotzeko duzula gogorarazteko idazten dizugu.`,
      body: "beheko botoitik proposamena onar dezakezu hurrengo fasera igarotzeko, edo doikuntzak eskatu oraindik berrikuspen-txandak erabilgarri badituzu.",
      cta: "proposamena berrikusi, onartu edo doikuntzak eskatu",
      note: "zorrotz zure erritmora mugitzen gara: denbora gehiago behar baduzu proiektuak etenaldi mugagabean jarraituko du zure jarraibideen zain, estudioak bere kabuz faserik aurreratu gabe.",
    },
    completion: {
      subject: (br) => `proiektua arrakastaz amaitu da — ${br}-(r)en behin betiko entrega`,
      hello: "kaixo,",
      intro: (br) => `zorionak! zure ${bold(br)} proiektuak fase guztiak osatu ditu eta arrakastaz amaitu da.`,
      body: "azken baliozkotzea erregistratu dugu eta dagoeneko eskuragarri dituzu zure proiektuko behin betiko fitxategi eta entregagai guztiak.",
      deliverable: "behin betiko fitxategietarako edo azken entregagairako esteka",
      cta: "ireki nire proiektua eta atzitu fitxategiak",
      note: "gorde mezu hau zure fitxategi nagusiak, fakturak eta jarraipena edozein unetan kontsultatzeko.",
    },
    review: {
      subject: (br) => `zer moduz joan da ${br}? zure iritziak axola digu`,
      hello: "kaixo,",
      intro: (br) => `zure ${br} proiektua amaitu da eta eskerrak eman nahi dizkizugu gugan konfiantza izateagatik.`,
      ask: "minutu bat baduzu, zure iritzia ezagutzea gustatuko litzaiguke. zure balorazioa gure webgunean ager daiteke bezero egiaztatuaren lekukotza gisa.",
      thanks: "aldez aurretik eskertzen dizugu.",
      cta: "utzi nire balorazioa",
      note: "esteka hau pertsonala da eta proiektu hau baloratzeko soilik balio du.",
    },
    renewal: {
      subject: (br) => `domeinuaren eta postaren urteko berritze-abisua — ${br}`,
      hello: "kaixo,",
      intro: (br, date) => `${br} proiektuaren web-azpiegitura teknikoaren urteko epea (domeinua, posta korporatiboa, dns/ssl eta edge hedapena) ${date} egunean amaituko da.`,
      body: (amount) => `azpiegituraren urteko berritzearen zenbatekoa ${amount} da (erabilgarritasun teknikoa, ziurtagiriak eta berritzeak estaltzen ditu; ez ditu eduki edo diseinu aldaketak barne hartzen). botoi nagusitik ordain dezakezu edo klik bakarrean berritzea bertan behera utzi, egungo epea amaitzean domeinua, posta eta webgunea aktibo mantendu nahi ez badituzu.`,
      ctaPay: "ordaindu urteko berritzea",
      cancelLine: "utzi bertan behera urteko berritzea klik bakarrean",
      note: "ez berritzea erabakitzen baduzu, ez da kargu gehigarririk egingo eta domeinuak zein webguneak aktibo egoteari utziko diote indarrean dagoen epea amaitzean.",
    },
    infra: {
      subject: (br) => `zure webguneko urteko azpiegiturari buruzko informazioa — ${br}`,
      hello: "kaixo,",
      intro: (br) => `zure ${bold(br)} proiektuan web garapena sartzean, gardentasun osoa eman nahi dizugu urteko azpiegitura teknikoaren kuotak nola funtzionatzen duen jakiteko (100 €/urte bigarren urtetik aurrera).`,
      coveredTitle: bold("zer estaltzen du zehazki 100 €/urteko kuotak:"),
      itemDomain: "— zure izenean dagoen domeinu propioaren erregistroa eta urteko berritzea",
      itemEmail: "— posta elektroniko korporatibo profesionalaren zerbitzua",
      itemSsl: "— dns kudeaketa eta eskuragarritasun handiko ssl segurtasun-ziurtagiriak",
      itemEdge: "— ostatatzea eta etengabeko hedapena abiadura handiko edge sare globalean",
      scopeNote: "esparru zorrotza: kuota honek zure webgunearen eraginkortasun teknikoa eta berritzeak soilik bermatzen ditu. ez du barne hartzen edukien, testuen, argazkien edo atal berrien mantentzerik entregatu ondoren (sortze-fasean 2 doako berrikuspen-txanda sartzen dira faseko; ondorengo aparteko aldaketa bakoitza 100 €-ko prezio finkoan fakturatzen da).",
      cancelNote: "ustekaberik eta iraunkortasunik gabe: urteko iraungitze bakoitza baino 30 egun lehenago ohar bat jasoko duzu postaz ordainketa-estekarekin eta klik bakarreko baja-botoiarekin. berritzea ez baduzu nahi, ez da kargu gehigarririk egingo.",
      cta: "ikusi nire proiektuaren jarraipena",
      note: "baldintza osoak edozein unetan kontsulta ditzakezu hemen: rebrandyourbrand.es/#terminos.",
    },
    abandonWarning: {
      subject: (br) => `jarduerarik gabeko abisua — 7 eguneko epea ${br} deuseztatu aurretik`,
      hello: "kaixo,",
      intro: (br) => `zure ${bold(br)} proiektuak 30 egun natural daramatza jarduerarik edo erantzunik gabe, zerbitzu-baldintzen 3.2 klausularekin bat etorriz.`,
      body: "azken 7 egun naturaleko epea duzu falta diren materialak bidaltzeko edo martxan dagoen proposamena baliozkotzeko. epe hori igaro ondoren erantzunik jaso ezean, espedientea bertan behera utzitzat joko da eta formalki deuseztatuko da.",
      cta: "nire proiektura sartu eta lanari berrekin",
      note: "zerbitzu-baldintzak rebrandyourbrand.es/#terminos helbidean kontsulta ditzakezu.",
    },
    abandoned: {
      subject: (br) => `utzikeriagatiko deuseztatze-jakinarazpena — ${br}`,
      hello: "kaixo,",
      intro: (br) => `zure ${bold(br)} proiektuaren deuseztapen formala jakinarazten dizugu, ezarritako epean jarduerarik ez izateagatik, zerbitzu-baldintzen 3.2 klausularekin bat etorriz.`,
      body: "arauzko aurreabisua bidali eta falta diren materialak edo erantzuna jaso gabe 37 egun natural baino gehiago igaro ondoren, espedientea behin betiko itxita geratu da.",
      cta: "espedientearen egoera ikusi",
      note: "3.2 klausularekin bat etorriz, ordaindutako zenbatekoak agenda-erreserbagatiko eta aldez aurreko lanengatiko kalte-ordain gisa gordetzen dira.",
    },
    chat: {
      confirmSubject: (br) => `zure mezua jaso dugu — ${br}`,
      hello: "kaixo,",
      confirmReceived: (br) => `behar bezala jaso dugu ${br} proiektuaren txatean lan-taldeari bidalitako mezua:`,
      confirmSoon: "gaelek edo bernatek laster erantzungo dizute estudiotik zure jarraipen-panelean.",
      replySubject: (br) => `gael eta bernaten erantzun berria — ${br}`,
      replyIntro: (br) => `gaelek eta bernatek zure kontsultari erantzun diote ${br} proiektuan:`,
      viewPortal: "ikusi erantzuna jarraipen-panelean",
      autoTranslatedNotice: "gaztelaniazko jatorrizkotik automatikoki itzulita",
    },
  },
  en: {
    verify: {
      subject: "confirm your email to complete your briefing — rebrandyourbrand",
      hello: "hello,",
      intro: (br) => `we received a request to start a project${br ? ` for ${br}` : ""} at rebrandyourbrand.`,
      ask: "to keep you safe, please confirm your email address by clicking the button below:",
      cta: "verify email and open my project",
      ignore: "if you did not request this, you can safely ignore this email.",
    },
    ack: {
      subject: (br) => `email verified — access to your project${br ? ` ${br}` : ""} — rebrandyourbrand`,
      hello: "hello,",
      body: (br) => `email verified successfully. your private project page${br ? ` for ${br}` : ""} is now ready.`,
      next: "use the button below to complete your secure payment on stripe now or return later and track every phase.",
      cta: "open my project and secure payment",
      note: "keep this email to revisit your project page whenever you need.",
    },
    paid: {
      subject: (br) => `payment confirmed — tracking for your project ${br}`,
      hello: "hello,",
      intro: (br) => `we have confirmed your payment for the project ${br}.`,
      summary: "summary of your order:",
      plan: "services",
      amount: "amount paid (one-time payment)",
      status: "current status",
      phase: "phase",
      onboarding: "on your project page you can share in one minute your current links, domain preference and initial assets folder so we can start right away.",
      cta: "open tracking and send materials",
      note: "keep this email to check your project status and deliverables at any time.",
    },
    proposal: {
      subject: (br, ph) => `proposal ready for review — ${ph} — ${br}`,
      hello: "hello,",
      intro: (br, ph) => `the proposal for the ${ph} phase of your project ${br} is ready for your review.`,
      openDeliverable: "link to deliverable or preview",
      cta: "review proposal, approve or request adjustments",
      revisions: "from the button above you can approve the phase in writing to move on to the next stage, or submit the specific adjustments you need within your 2 included free revision rounds.",
    },
    phase: {
      subject: (br) => `news on your project ${br} — phase completed`,
      hello: "hello,",
      intro: (br) => `we have news about the progress of your project ${br}.`,
      done: "phase completed",
      finished: "your project has completed all its phases and is now finished.",
      next: "new phase in progress",
      deliverable: "phase deliverable",
      cta: "view my project tracking",
      note: "you can check the full history of phases and deliverables at any time with the button above.",
    },
    tacitReminder: {
      subject: (br, ph) => `pending review reminder — ${ph} — ${br}`,
      hello: "hello,",
      intro: (br, ph) => `just a friendly reminder that the ${ph} proposal for your project ${br} is awaiting your approval.`,
      body: "use the button below to approve the proposal and move forward, or request adjustments if you still have revision rounds available.",
      cta: "review proposal, approve or request adjustments",
      note: "we work strictly at your pace: if you need more time, your project remains paused indefinitely waiting for your feedback, without the studio advancing any phase on its own.",
    },
    completion: {
      subject: (br) => `project successfully completed — final delivery for ${br}`,
      hello: "hello,",
      intro: (br) => `congratulations! your project ${bold(br)} has completed all phases and is now finished.`,
      body: "we have recorded the final approval and all your final master files and deliverables are now ready for you.",
      deliverable: "link to final master files or deliverable",
      cta: "open my project and access files",
      note: "keep this email handy to access your master files, invoices and project tracking at any time.",
    },
    review: {
      subject: (br) => `how did ${br} go? your opinion matters`,
      hello: "hello,",
      intro: (br) => `your project ${br} is now finished and we want to thank you for trusting us.`,
      ask: "if you have a minute, we would love to hear your opinion. your review may appear on our website as a verified client testimonial.",
      thanks: "we thank you in advance.",
      cta: "leave my review",
      note: "this link is personal and only works to review this project.",
    },
    renewal: {
      subject: (br) => `annual domain and email renewal notice — ${br}`,
      hello: "hello,",
      intro: (br, date) => `the annual technical web infrastructure period (domain, corporate email, dns/ssl and edge deployment) for ${br} expires on ${date}.`,
      body: (amount) => `the annual infrastructure renewal fee is ${amount} (covers technical availability, certificates and renewals; excludes content or design changes). you can complete it via the main button or cancel the renewal in one click if you prefer not to keep the domain, email and website active after the current period ends.`,
      ctaPay: "pay annual renewal",
      cancelLine: "cancel annual renewal in one click",
      note: "if you choose not to renew, no extra charges will be made and the domain and website will stop being active at the end of the current period.",
    },
    infra: {
      subject: (br) => `information about your website's annual infrastructure — ${br}`,
      hello: "hello,",
      intro: (br) => `since your project ${bold(br)} includes web development, we want to provide total transparency on how the annual technical infrastructure fee works (100 €/year starting in year two).`,
      coveredTitle: bold("what the 100 €/year fee strictly covers:"),
      itemDomain: "— annual registration and renewal of your custom domain in your name",
      itemEmail: "— professional corporate email inbox and service",
      itemSsl: "— dns management and high-availability ssl security certificates",
      itemEdge: "— continuous hosting and deployment on a top-speed global edge network",
      scopeNote: "strict scope: this fee guarantees technical uptime and renewals. it does not include content, text, photo maintenance or new sections after delivery (adjustments during creation include 2 free revision rounds per phase; any subsequent extra change is billed at a fixed 100 € per round).",
      cancelNote: "no surprises and zero lock-in: 30 days before each annual renewal you will receive an email reminder with the payment link and a one-click cancellation button. if you choose not to renew, no additional charges will occur.",
      cta: "view project tracking",
      note: "full terms and conditions are always available at rebrandyourbrand.es/#terminos.",
    },
    abandonWarning: {
      subject: (br) => `inactivity notice — 7-day period prior to termination of ${br}`,
      hello: "hello,",
      intro: (br) => `your project ${bold(br)} has recorded 30 calendar days without activity or response pursuant to clause 3.2 of the terms of service.`,
      body: "you have a final period of 7 calendar days to provide the pending materials or validate the proposal in progress. if no response is received within this period, the project will be considered abandoned and formally terminated.",
      cta: "access my project and resume work",
      note: "you can review the terms of service at rebrandyourbrand.es/#terminos.",
    },
    abandoned: {
      subject: (br) => `termination notice due to abandonment — ${br}`,
      hello: "hello,",
      intro: (br) => `we inform you of the formal termination of your project ${bold(br)} due to prolonged inactivity pursuant to clause 3.2 of the terms of service.`,
      body: "having exceeded 37 calendar days without receiving materials or a response following the formal notice, the file has been definitively closed.",
      cta: "view file status",
      note: "pursuant to clause 3.2, fees paid are retained as compensation for schedule reservation and preparatory work.",
    },
    chat: {
      confirmSubject: (br) => `we received your message — ${br}`,
      hello: "hello,",
      confirmReceived: (br) => `we have successfully received your message for the team in the project chat for ${br}:`,
      confirmSoon: "gael or bernat will reply shortly from the studio in your tracking portal.",
      replySubject: (br) => `new reply from gael and bernat — ${br}`,
      replyIntro: (br) => `gael and bernat have replied to your question in project ${br}:`,
      viewPortal: "view reply in tracking portal",
      autoTranslatedNotice: "automatically translated from the original in spanish",
    },
  },
};

// Títulos de las fases por idioma (orden estricto es / ca / eu / en)
const PHASE_TITLES = {
  es: {
    logo: "diseño del logotipo",
    palette: "diseño de la paleta de empresa",
    identity: "diseño del logotipo y la paleta",
    web: "creación de la web",
    delivery: "entrega final",
  },
  ca: {
    logo: "disseny del logotip",
    palette: "disseny de la paleta d'empresa",
    identity: "disseny del logotip i la paleta",
    web: "creació de la web",
    delivery: "lliurament final",
  },
  eu: {
    logo: "logotipoaren diseinua",
    palette: "enpresaren paletaren diseinua",
    identity: "logotipoaren eta paletaren diseinua",
    web: "webgunearen sorkuntza",
    delivery: "azken entrega",
  },
  en: {
    logo: "logo design",
    palette: "company palette design",
    identity: "logo and palette design",
    web: "website creation",
    delivery: "final delivery",
  },
};

const phaseTitle = (phase, lang) =>
  (PHASE_TITLES[pickLang(lang)] || PHASE_TITLES.es)[phase?.key] || phase?.title || "";

// ── Páginas para el cliente: es / ca / eu / en ──
const PG = {
  es: {
    invalid: ["enlace inválido", "enlace inválido", "el enlace no es válido o está incompleto."],
    expired: ["enlace expirado", "enlace expirado", "este enlace ya caducó o ya fue utilizado."],
    config: ["error de configuración", "error de configuración", "falta configuración en el servidor."],
    verify: ["verificación de correo", "confirma tu correo", "pulsa el botón para verificar tu briefing, preparar tu proyecto y abrir la pasarela de pago seguro."],
    retry: ["pasarela de pago", "no hemos podido abrir el pago", "tu briefing ya está registrado. vuelve a pulsar para abrir la pasarela de pago seguro o escríbenos a hola@rebrandyourbrand.es."],
    error: ["error temporal", "error temporal", "inténtalo de nuevo en unos minutos."],
    trackInvalid: ["proyecto no encontrado", "proyecto no encontrado", "el enlace de seguimiento no es válido o ha caducado."],
    trackMissing: ["proyecto no encontrado", "proyecto no encontrado", "no hemos encontrado este proyecto."],
    btn: "verificar y acceder al pago",
    common: {
      backSite: "volver a rebrandyourbrand.es",
      openTracker: "ver seguimiento de mi proyecto",
      openReview: "dejar valoración del proyecto",
      studioTag: "estudio de rebranding y web",
    },
    rv: {
      eyebrow: "opinión verificada",
      title: "valoración del proyecto",
      heading: "cuéntanos qué tal ha ido",
      intro: "gracias por confiar en nosotros. tu opinión nos ayuda a mejorar y, una vez revisada, puede aparecer en nuestra web.",
      business: "tu negocio o marca",
      name: "tu nombre y apellidos",
      rating: "valoración",
      comment: "tu opinión sobre el servicio",
      submit: "enviar valoración",
    },
    rvThanks: ["gracias", "gracias por tu valoración", "la hemos recibido correctamente y la revisaremos antes de publicarla en la web."],
    rvDone: ["valoración registrada", "ya tenemos tu valoración", "gracias por contarnos tu experiencia. este enlace solo sirve para una valoración."],
    rvNotReady: ["valoración no disponible", "todavía no disponible", "podrás valorar tu proyecto en cuanto todas sus fases hayan finalizado."],
    rvMissing: ["faltan datos", "faltan datos por completar", "vuelve atrás y rellena tu nombre y tu comentario."],
    ap: {
      eyebrow: "revisión de fase",
      title: "revisar propuesta",
      heading: "revisar propuesta de fase",
      intro: (ph, br) => `revisa el entregable de la fase "${ph}" del proyecto ${br}. puedes aprobarla para avanzar a la siguiente etapa o solicitar ajustes puntuales.`,
      deliverable: "abrir entregable o vista previa",
      roundsUsed: (u, m) => `rondas de revisión usadas en esta fase: ${u} de ${m}`,
      legal: "al aprobar, das por cerrada esta fase según las condiciones de servicio. si necesitas cambios dentro de las rondas disponibles, despliega el botón secundario de abajo.",
      confirmApprove: "confirmo que he revisado la propuesta y quiero aprobar definitivamente esta fase",
      confirmRevise: "confirmo que he revisado las correcciones y quiero enviar esta ronda de ajustes",
      confirmBuyRevision: "confirmo que quiero desbloquear 1 ronda de ajustes adicional por 100 € mediante pago seguro en stripe",
      confirmRequired: "es obligatorio marcar la casilla de confirmación antes de enviar.",
      btn: "aprobar fase y continuar",
      btnBuyRevision: "desbloquear 1 ronda de ajustes adicional",
      unlockedBanner: "¡ronda extra desbloqueada con éxito! ya puedes indicar tus ajustes en el formulario desplegable de abajo.",
      stripeError: "no se pudo iniciar la pasarela de pago seguro. por favor, inténtalo de nuevo en unos instantes.",
      revToggle: (r, m) => `pedir ajustes (ronda ${r} de ${m})`,
      revLabel: (r, m) => `describe con claridad los ajustes que necesitas (ronda ${r} de ${m})`,
      revPh: "indica en un solo mensaje todos los cambios puntuales para aplicar en esta ronda...",
      revSubmit: (r, m) => `enviar ajustes de la ronda ${r} de ${m}`,
      revEmpty: "escribe los ajustes que necesitas antes de enviar la ronda.",
      revExhausted: "has utilizado las rondas de revisión incluidas en esta fase. puedes aprobar la propuesta arriba para continuar o desbloquear una ronda adicional de ajustes (+100 €).",
      revDone: ["¡enviado correctamente!", "ajustes registrados con éxito", (r, m) => `hemos recibido tus indicaciones de la ronda ${r} de ${m} y te avisaremos por correo en cuanto la versión actualizada esté lista para revisar.`],
      revWorking: ["ajustes en curso", "estamos aplicando tus ajustes", (r, m) => `ya tenemos registrada tu petición de la ronda ${r} de ${m} y estamos preparando la nueva versión. te avisaremos por correo en cuanto esté lista.`],
      done: ["¡enviado correctamente!", "fase aprobada con éxito", "hemos registrado tu validación por escrito y ya hemos activado la siguiente etapa de tu proyecto."],
      already: ["fase ya gestionada", "esta fase ya está cerrada", "esta fase ya consta como aprobada y completada en tu proyecto."],
      completed: ["¡proyecto finalizado con éxito!", "todas las fases completadas", "todas las fases de tu proyecto han sido validadas con éxito. ya tienes disponibles todos los archivos definitivos en tu panel de seguimiento."],
    },
    rn: {
      eyebrow: "infraestructura web",
      title: "cancelar renovación anual",
      heading: "dar de baja la renovación anual",
      intro: (br, date) => `si confirmas la baja para ${br}, no se realizará ningún cargo adicional y el dominio, el correo corporativo y la web dejarán de estar activos al finalizar el periodo vigente (${date}).`,
      btn: "confirmar baja de la renovación anual",
      done: ["baja confirmada", "renovación anual cancelada", "hemos registrado la baja. no recibirás cargos adicionales al vencer el periodo actual."],
      already: ["baja ya registrada", "la renovación ya estaba cancelada", "este proyecto ya tiene desactivada la renovación anual."],
    },
    tr: {
      eyebrow: "portal de cliente",
      title: "seguimiento",
      heading: "seguimiento de tu proyecto",
      project: "proyecto",
      services: "servicios",
      paid: "importe abonado (pago único)",
      due: "importe pendiente (pago único)",
      receipt: "ver recibo o factura en stripe",
      payIntro: "tu proyecto está reservado. completa el pago único de forma segura con stripe para iniciar formalmente la primera fase. si acabas de pagar hace unos segundos, recarga esta página.",
      payBtn: "completar pago seguro en stripe",
      state: "fases del proyecto",
      step: "paso",
      done: "completado",
      doneClient: "aprobado por ti",
      doneTacit: "aprobación tácita",
      review: "propuesta lista — esperando tu validación",
      reviewAction: "revisar, aprobar o pedir ajustes",
      deliverable: "ver entregable",
      studioNote: "nota del estudio",
      active: "en curso actualmente",
      activeRev: (r, m) => `aplicando tus ajustes (ronda ${r} de ${m})`,
      todo: "pendiente",
      obEyebrow: "arranque del proyecto",
      obTitle: "envíanos tus materiales iniciales",
      obIntro: "comparte estos tres datos en un paso para empezar sin esperas. también puedes responder a cualquiera de nuestros correos.",
      obSocials: "web o redes actuales (instagram, maps, linkedin...)",
      obSocialsPh: "ej. instagram.com/tumarca o sin presencia actual",
      obDomain: "dominio (si ya tienes uno o cuál te gustaría)",
      obDomainPh: "ej. ya tengo tumarca.es / me gustaría tumarca.com",
      obDomainRequired: "obligatorio para proyectos con web",
      obDomainMissing: ["dominio obligatorio", "indica el dominio de tu web", "tu proyecto incluye desarrollo web, por lo que necesitamos que indiques el dominio actual que posees o el que deseas que registremos para comenzar."],
      obMaterials: "enlace a carpeta con logo previo, fotos y textos (drive, wetransfer, dropbox...) o notas",
      obMaterialsPh: "https://drive.google.com/... o indicaciones breves",
      obMaterialsHistory: "materiales aportados",
      obReferencesHistory: "referencias visuales e inspiración",
      obAddTitle: "añadir materiales o referencias",
      obAddIntro: "puedes aportar nuevos materiales del negocio o referencias visuales en cualquier momento. todo lo que envíes se registrará en el historial de forma acumulativa sin sobrescribir lo anterior.",
      blockAMaterials: "bloque 1 — materiales del negocio",
      obMaterialsUrl: "enlace externo a carpeta o archivos (opcional, drive, dropbox, wetransfer...)",
      obMaterialsUrlPh: "https://drive.google.com/...",
      obMaterialsFile: "subir archivo directo de material (opcional, logo anterior, fotos, zip, pdf...)",
      obMaterialsFileNote: "acepta cualquier formato (png, jpg, svg, webp, pdf, zip...) hasta 25 mb.",
      obMaterialsNotes: "notas adicionales o indicaciones sobre el material (opcional)",
      obMaterialsNotesPh: "contexto breve sobre lo que envías, colores corporativos deseados, textos...",
      blockBRefs: "bloque 2 — referencias visuales e inspiración",
      obRefUrl: "enlace de referencia o web que te guste (opcional)",
      obRefUrlPh: "https://...",
      obRefFile: "subir captura o imagen de referencia (opcional)",
      obRefNotes: "qué te gusta de esta referencia (opcional)",
      obRefNotesPh: "ej. me gusta la tipografía, el aire limpio, la estructura o el tono de comunicación...",
      obFileDownload: "descargar archivo adjunto",
      obInvalidUrlTitle: "enlace inválido",
      obInvalidUrlHeading: "revisa el enlace proporcionado",
      obInvalidUrlMsg: "los enlaces externos deben usar https:// (por ejemplo https://drive.google.com/...). vuelve atrás y corrígelo o déjalo vacío si subes un archivo directo.",
      fileTooLargeTitle: "archivo demasiado grande",
      fileTooLargeHeading: "tamaño de archivo superado",
      fileTooLarge: "el archivo supera el límite de 25 mb admitido para subida directa. para archivos más pesados, compártelo mediante un enlace externo (drive, wetransfer o dropbox).",
      confirmOnboarding: "confirmo que he revisado los datos y enlaces y quiero enviarlos definitivamente al estudio",
      confirmRequired: "es obligatorio marcar la casilla de confirmación antes de enviar los materiales.",
      confirmRequiredTitle: "confirmación obligatoria",
      confirmRequiredHeading: "marca la casilla de confirmación",
      obAccordionTitle: "¿quieres añadir más materiales o referencias?",
      obDelayWarning: "nota: si ya hemos comenzado a trabajar en la fase actual con los materiales previos, añadir nuevos elementos ahora podría quedar fuera de plazo para la propuesta que estás a punto de revisar.",
      actionRegisteredNotice: "aviso: esta acción ya ha quedado registrada en el sistema y nuestro equipo ha recibido la notificación para continuar con el trabajo.",
      obSuccess: ["¡enviado correctamente!", "materiales registrados con éxito", "hemos recibido tus materiales y referencias correctamente y nuestro equipo los revisará para incorporarlos al proyecto."],
      obSubmit: "enviar materiales al estudio",
      obSentBanner: "materiales recibidos correctamente. nuestro equipo ya tiene todo registrado.",
      obSentTitle: "materiales iniciales enviados",
      obUndoBanner: "materiales añadidos correctamente",
      obUndoBtn: "deshacer",
      obDismissBtn: "cerrar aviso",
      obUndoneBanner: "acción deshecha: hemos restaurado tu borrador para que puedas corregir lo que necesites.",
      obPrevFile: (name) => `archivo previo: ${name} (vuelve a seleccionarlo si deseas adjuntarlo)`,
      obPrevRef: (name) => `referencia previa: ${name} (vuelve a seleccionarla si deseas adjuntarla)`,
      extraWorkEyebrow: "trabajo extraordinario",
      extraWorkTitle: "cambios o mejoras posteriores (100 € por ronda)",
      extraWorkDesc: "como cliente del estudio, tras la entrega final puedes solicitar en cualquier momento una ronda de cambios extraordinarios o mejoras puntuales en tu web o identidad por 100 € precio cerrado.",
      extraWorkPh: "describe los ajustes o cambios que necesitas en tu web, logotipo o identidad...",
      extraWorkBtn: "solicitar y abonar ronda extra (100 €)",
      extraWorkSuccess: "ronda extraordinaria abonada con éxito. el equipo ha recibido tus indicaciones y se pondrá en contacto contigo para aplicarlas.",
      extraWorkEmpty: "por favor, describe brevemente los cambios que necesitas antes de continuar.",
      extraWorkHistory: "trabajos extraordinarios solicitados:",
      extraWorkStatusReceived: "recibido por el estudio",
      obLblSocials: "web o redes",
      obLblDomain: "dominio",
      obLblMaterials: "carpeta o notas",
      obMissing: ["faltan datos", "indica al menos un dato", "rellena al menos uno de los campos antes de enviar el formulario."],
      chatEyebrow: "soporte directo e ia",
      chatHeading: "asistencia y chat del proyecto",
      chatTabBrandi: "brandi (ia)",
      chatTabHuman: "gael y bernat (equipo)",
      brandiIntro: "brandi conoce el estado exacto de tu proyecto, servicios contratados, fases y plazos para resolver tus dudas al instante.",
      switchToHuman: "hablar con el equipo humano",
      brandiWelcome: (brand) => `hola, estoy al tanto de todo lo relativo a tu proyecto para ${brand}. ¿en qué puedo ayudarte hoy?`,
      brandiPlaceholder: "pregunta a brandi sobre fases, entregables, revisiones...",
      humanIntro: "escribe directamente a gael y bernat. te responderemos en tu panel y por correo.",
      humanPlaceholder: "escribe tu mensaje para gael y bernat...",
      humanSentSuccess: "mensaje enviado al equipo. te responderemos a la mayor brevedad.",
      humanEmptyMsg: "escribe un mensaje antes de enviar.",
      sendBtn: "enviar",
      chatYou: "tú",
      chatStudio: "gael y bernat",
      chatBrandi: "brandi (ia)",
      chatNoMessages: "aún no hay mensajes con el equipo. escribe abajo para iniciar la conversación.",
      chatErr: "error de conexión. no se ha podido enviar el mensaje. inténtalo de nuevo.",
      chatTransIndicator: "traducido automáticamente, haz clic para ver el mensaje original",
      chatViewTrans: "ver traducción automática",
    },
  },
  ca: {
    invalid: ["enllaç no vàlid", "enllaç no vàlid", "l'enllaç no és vàlid o és incomplet."],
    expired: ["enllaç caducat", "enllaç caducat", "aquest enllaç ja ha caducat o ja s'ha fet servir."],
    config: ["error de configuració", "error de configuració", "falta configuració al servidor."],
    verify: ["verificació de correu", "confirma el teu correu", "prem el botó per verificar el teu briefing, preparar el teu projecte i obrir la pàgina de pagament segur."],
    retry: ["pàgina de pagament", "no hem pogut obrir el pagament", "el teu briefing ja està registrat. torna a prémer per obrir la pàgina de pagament segur o escriu-nos a hola@rebrandyourbrand.es."],
    error: ["error temporal", "error temporal", "torna-ho a provar d'aquí a uns minuts."],
    trackInvalid: ["projecte no trobat", "projecte no trobat", "l'enllaç de seguiment no és vàlid o ha caducat."],
    trackMissing: ["projecte no trobat", "projecte no trobat", "no hem trobat aquest projecte."],
    btn: "verificar i accedir al pagament",
    common: {
      backSite: "tornar a rebrandyourbrand.es",
      openTracker: "veure el seguiment del meu projecte",
      openReview: "deixar valoració del projecte",
      studioTag: "estudi de rebranding i web",
    },
    rv: {
      eyebrow: "opinió verificada",
      title: "valoració del projecte",
      heading: "explica'ns com ha anat",
      intro: "gràcies per confiar en nosaltres. la teva opinió ens ajuda a millorar i, un cop revisada, pot aparèixer a la nostra web.",
      business: "el teu negoci o marca",
      name: "el teu nom i cognoms",
      rating: "valoració",
      comment: "la teva opinió sobre el servei",
      submit: "enviar valoració",
    },
    rvThanks: ["gràcies", "gràcies per la teva valoració", "l'hem rebuda correctament i la revisarem abans de publicar-la a la web."],
    rvDone: ["valoració registrada", "ja tenim la teva valoració", "gràcies per explicar-nos la teva experiència. aquest enllaç només serveix per a una valoració."],
    rvNotReady: ["valoració no disponible", "encara no disponible", "podràs valorar el teu projecte tan bon punt totes les seves fases hagin finalitzat."],
    rvMissing: ["falten dades", "falten dades per completar", "torna enrere i omple el teu nom i el teu comentari."],
    ap: {
      eyebrow: "revisió de fase",
      title: "revisar proposta",
      heading: "revisar proposta de fase",
      intro: (ph, br) => `revisa el lliurable de la fase "${ph}" del projecte ${br}. pots aprovar-la per avançar a l'etapa següent o demanar ajustos puntuals.`,
      deliverable: "obrir lliurable o vista prèvia",
      roundsUsed: (u, m) => `rondes de revisió usades en aquesta fase: ${u} de ${m}`,
      legal: "en aprovar, dones per tancada aquesta fase segons les condicions de servei. si necessites canvis dins de les rondes disponibles, desplega el botó secundari de sota.",
      confirmApprove: "confirmo que he revisat la proposta i vull aprovar definitivament aquesta fase",
      confirmRevise: "confirmo que he revisat les correccions i vull enviar aquesta ronda d'ajustos",
      confirmBuyRevision: "confirmo que vull desbloquejar 1 ronda d'ajustos addicional per 100 € mitjançant pagament segur a stripe",
      confirmRequired: "és obligatori marcar la casella de confirmació abans d'enviar.",
      btn: "aprovar fase i continuar",
      btnBuyRevision: "desbloquejar 1 ronda d'ajustos addicional",
      unlockedBanner: "ronda extra desbloquejada amb èxit! ja pots indicar els teus ajustos al formulari desplegable de sota.",
      stripeError: "no s'ha pogut iniciar el pagament segur. si us plau, torna-ho a provar d'aquí a uns instants.",
      revToggle: (r, m) => `demanar ajustos (ronda ${r} de ${m})`,
      revLabel: (r, m) => `descriu amb claredat els ajustos que necessites (ronda ${r} de ${m})`,
      revPh: "indica en un sol missatge tots els canvis puntuals per aplicar en aquesta ronda...",
      revSubmit: (r, m) => `enviar ajustos de la ronda ${r} de ${m}`,
      revEmpty: "escriu els ajustos que necessites abans d'enviar la ronda.",
      revExhausted: "has utilitzat les rondes de revisió incloses en aquesta fase. pots aprovar la proposta a dalt per continuar o desbloquejar una ronda addicional d'ajustos (+100 €).",
      revDone: ["enviat correctament!", "ajustos registrats amb èxit", (r, m) => `hem rebut les teves indicacions de la ronda ${r} de ${m} i t'avisarem per correu tan bon punt la versió actualitzada estigui a punt per revisar.`],
      revWorking: ["ajustos en curs", "estem aplicant els teus ajustos", (r, m) => `ja tenim registrada la teva petició de la ronda ${r} de ${m} i estem preparant la nova versió. t'avisarem per correu tan bon punt estigui a punt.`],
      done: ["enviat correctament!", "fase aprovada amb èxit", "hem registrat la teva validació per escrit i ja hem activat l'etapa següent del teu projecte."],
      already: ["fase ja gestionada", "aquesta fase ja està tancada", "aquesta fase ja consta com a aprovada i completada al teu projecte."],
      completed: ["projecte finalitzat amb èxit!", "totes les fases completades", "totes les fases del teu projecte han estat validades amb èxit. ja tens disponibles tots els arxius definitius al teu tauler de seguiment."],
    },
    rn: {
      eyebrow: "infraestructura web",
      title: "baixa de renovació anual",
      heading: "donar de baixa la renovació anual",
      intro: (br, date) => `si confirmes la baixa per a ${br}, no es farà cap càrrec addicional i el domini, el correu corporatiu i la web deixaran d'estar actius en finalitzar el període vigent (${date}).`,
      btn: "confirmar baixa de la renovació anual",
      done: ["baixa confirmada", "renovació anual desactivada", "hem registrat la baixa. no rebràs càrrecs addicionals en vèncer el període actual."],
      already: ["baixa ja registrada", "la renovació ja estava desactivada", "aquest projecte ja té desactivada la renovació anual."],
    },
    tr: {
      eyebrow: "portal de client",
      title: "seguiment",
      heading: "seguiment del teu projecte",
      project: "projecte",
      services: "serveis",
      paid: "import abonat (pagament únic)",
      due: "import pendent (pagament únic)",
      receipt: "veure rebut o factura a stripe",
      payIntro: "el teu projecte està reservat. completa el pagament únic de manera segura amb stripe per iniciar formalment la primera fase. si acabes de pagar fa uns segons, torna a carregar aquesta pàgina.",
      payBtn: "completar pagament segur a stripe",
      state: "fases del projecte",
      step: "pas",
      done: "completat",
      doneClient: "aprovat per tu",
      doneTacit: "aprovació tàcita",
      review: "proposta llesta — esperant la teva validació",
      reviewAction: "revisar, aprovar o demanar ajustos",
      deliverable: "veure lliurable",
      studioNote: "nota de l'estudi",
      active: "en curs actualment",
      activeRev: (r, m) => `aplicant els teus ajustos (ronda ${r} de ${m})`,
      todo: "pendent",
      obEyebrow: "arrencada del projecte",
      obTitle: "envia'ns els teus materials inicials",
      obIntro: "comparteix aquestes tres dades en un pas per començar sense esperes. també pots respondre a qualsevol dels nostres correus.",
      obSocials: "web o xarxes actuals (instagram, maps, linkedin...)",
      obSocialsPh: "ex. instagram.com/latevamarca o sense presència actual",
      obDomain: "domini (si ja en tens un o quin t'agradaria)",
      obDomainPh: "ex. ja tinc latevamarca.cat / m'agradaria latevamarca.com",
      obDomainRequired: "obligatori per a projectes amb web",
      obDomainMissing: ["domini obligatori", "indica el domini de la teva web", "el teu projecte inclou desenvolupament web, per la qual cosa necessitem que indiquis el domini actual que posseeixes o el que vols que registrem per començar."],
      obMaterials: "enllaç a carpeta amb logotip previ, fotos i textos (drive, wetransfer, dropbox...) o notes",
      obMaterialsPh: "https://drive.google.com/... o indicacions breus",
      obMaterialsHistory: "materials aportats",
      obReferencesHistory: "referències visuals i inspiració",
      obAddTitle: "afegir materials o referències",
      obAddIntro: "pots aportar nous materials del negoci o referències visuals en qualsevol moment. tot el que enviïs es registrarà a l'historial de manera acumulativa sense sobreescriure l'anterior.",
      blockAMaterials: "bloc 1 — materials del negoci",
      obMaterialsUrl: "enllaç extern a carpeta o arxius (opcional, drive, dropbox, wetransfer...)",
      obMaterialsUrlPh: "https://drive.google.com/...",
      obMaterialsFile: "pujar arxiu directe de material (opcional, logo previ, fotos, zip, pdf...)",
      obMaterialsFileNote: "accepta qualsevol format (png, jpg, svg, webp, pdf, zip...) fins a 25 mb.",
      obMaterialsNotes: "notes addicionals o indicacions sobre el material (opcional)",
      obMaterialsNotesPh: "context breu sobre el que envies, colors corporatius desitjats, textos...",
      blockBRefs: "bloc 2 — referències visuals i inspiració",
      obRefUrl: "enllaç de referència o web que t'agradi (opcional)",
      obRefUrlPh: "https://...",
      obRefFile: "pujar captura o imatge de referència (opcional)",
      obRefNotes: "què t'agrada d'aquesta referència (opcional)",
      obRefNotesPh: "ex. m'agrada la tipografia, l'aire net, l'estructura o el to de comunicació...",
      obFileDownload: "descarregar arxiu adjunt",
      obInvalidUrlTitle: "enllaç no vàlid",
      obInvalidUrlHeading: "revisa l'enllaç proporcionat",
      obInvalidUrlMsg: "els enllaços externs han d'utilitzar https:// (per exemple https://drive.google.com/...). torna enrere i corregeix-lo o deixa'l buit si puges un arxiu directe.",
      fileTooLargeTitle: "arxiu massa gran",
      fileTooLargeHeading: "mida d'arxiu superada",
      fileTooLarge: "l'arxiu supera el límit de 25 mb admès per a pujada directa. per a arxius més pesats, comparteix-lo mitjançant un enllaç extern (drive, wetransfer o dropbox).",
      confirmOnboarding: "confirmo que he revisat les dades i enllaços i vull enviar-los definitivament a l'estudi",
      confirmRequired: "és obligatori marcar la casella de confirmació abans d'enviar els materials.",
      confirmRequiredTitle: "confirmació obligatòria",
      confirmRequiredHeading: "marca la casella de confirmació",
      obAccordionTitle: "vols afegir més materials o referències?",
      obDelayWarning: "nota: si ja hem començat a treballar en la fase actual amb els materials previs, afegir nous elements ara podria quedar fora de termini per a la proposta que estàs a punt de revisar.",
      actionRegisteredNotice: "avís: aquesta acció ja ha quedat registrada al sistema i el nostre equip ha rebut la notificació per continuar amb el treball.",
      obSuccess: ["enviat correctament!", "materials registrats amb èxit", "hem rebut els teus materials i referències correctament i el nostre equip els revisarà per incorporar-los al projecte."],
      obSubmit: "enviar materials a l'estudi",
      obSentBanner: "materials rebuts correctament. el nostre equip ja ho té tot registrat.",
      obSentTitle: "materials inicials enviats",
      obUndoBanner: "materials afegits correctament",
      obUndoBtn: "desfer",
      obDismissBtn: "tancar avís",
      obUndoneBanner: "acció desfeta: hem restaurat el teu esborrany perque puguis corregir el que necessitis.",
      obPrevFile: (name) => `arxiu previ: ${name} (torna a seleccionar-lo si vols adjuntar-lo)`,
      obPrevRef: (name) => `referència prèvia: ${name} (torna a seleccionar-la si vols adjuntar-la)`,
      extraWorkEyebrow: "treball extraordinari",
      extraWorkTitle: "canvis o millores posteriors (100 € per ronda)",
      extraWorkDesc: "com a client de l'estudi, després del lliurament final pots demanar en qualsevol moment una ronda de canvis extraordinaris o millores puntuals al teu web o identitat per 100 € preu tancat.",
      extraWorkPh: "descriu els ajustos o canvis que necessites al teu web, logotip o identitat...",
      extraWorkBtn: "demanar i abonar ronda extra (100 €)",
      extraWorkSuccess: "ronda extraordinària abonada amb èxit. l'equip ha rebut les teves indicacions i es posarà en contacte amb tu per aplicar-les.",
      extraWorkEmpty: "si us plau, descriu breument els canvis que necessites abans de continuar.",
      extraWorkHistory: "treballs extraordinaris demanats:",
      extraWorkStatusReceived: "rebut per l'estudi",
      obLblSocials: "web o xarxes",
      obLblDomain: "domini",
      obLblMaterials: "carpeta o notes",
      obMissing: ["falten dades", "indica almenys una dada", "omple almenys un dels camps abans d'enviar el formulari."],
      chatEyebrow: "suport directe i ia",
      chatHeading: "assistència i xat del projecte",
      chatTabBrandi: "brandi (ia)",
      chatTabHuman: "gael i bernat (equip)",
      brandiIntro: "la brandi coneix l'estat exacte del teu projecte, serveis contractats, fases i terminis per resoldre els teus dubtes a l'instant.",
      switchToHuman: "parlar amb l'equip humà",
      brandiWelcome: (brand) => `hola, estic al corrent de tot el relatiu al teu projecte per a ${brand}. en què et puc ajudar avui?`,
      brandiPlaceholder: "pregunta a la brandi sobre fases, lliurables, revisions...",
      humanIntro: "escriu directament a en gael i en bernat. et respondrem al teu panell i per correu.",
      humanPlaceholder: "escriu el teu missatge per a en gael i en bernat...",
      humanSentSuccess: "missatge enviat a l'equip. et respondrem com més aviat millor.",
      humanEmptyMsg: "escriu un missatge abans d'enviar.",
      sendBtn: "enviar",
      chatYou: "tu",
      chatStudio: "gael i bernat",
      chatBrandi: "brandi (ia)",
      chatNoMessages: "encara no hi ha missatges amb l'equip. escriu a sota per iniciar la conversa.",
      chatErr: "error de connexió. no s'ha pogut enviar el missatge. torna-ho a provar.",
      chatTransIndicator: "traduït automàticament, fes clic per veure el missatge original",
      chatViewTrans: "mostra la traducció automàtica",
    },
  },
  eu: {
    invalid: ["esteka baliogabea", "esteka baliogabea", "esteka ez da baliozkoa edo osatu gabe dago."],
    expired: ["esteka iraungia", "esteka iraungia", "esteka hau iraungi da edo dagoeneko erabili da."],
    config: ["konfigurazio-errorea", "konfigurazio-errorea", "zerbitzarian konfigurazioa falta da."],
    verify: ["postaren egiaztapena", "berretsi zure posta", "sakatu botoia zure briefing-a egiaztatzeko, proiektua prestatzeko eta ordainketa segururako sarbidea irekitzeko."],
    retry: ["ordainketa-pasabidea", "ezin izan dugu ordainketa ireki", "zure briefing-a erregistratuta dago jada. sakatu berriro ordainketa-pasabide segurua irekitzeko edo idatzi hola@rebrandyourbrand.es helbidera."],
    error: ["aldi baterako errorea", "aldi baterako errorea", "saiatu berriro minutu batzuen buruan."],
    trackInvalid: ["proiektua ez da aurkitu", "proiektua ez da aurkitu", "jarraipen-esteka ez da baliozkoa edo iraungi egin da."],
    trackMissing: ["proiektua ez da aurkitu", "proiektua ez da aurkitu", "ez dugu proiektu hau aurkitu."],
    btn: "egiaztatu eta joan ordainketara",
    common: {
      backSite: "itzuli rebrandyourbrand.es webgunera",
      openTracker: "ikusi nire proiektuaren jarraipena",
      openReview: "eman proiektuaren balorazioa",
      studioTag: "rebranding eta web estudioa",
    },
    rv: {
      eyebrow: "iritzi egiaztatua",
      title: "proiektuaren balorazioa",
      heading: "kontatu zer moduz joan den",
      intro: "eskerrik asko gugan konfiantza izateagatik. zure iritziak hobetzen laguntzen digu eta, berrikusi ondoren, gure webgunean ager daiteke.",
      business: "zure negozioa edo marka",
      name: "zure izen-abizenak",
      rating: "balorazioa",
      comment: "zerbitzuari buruzko zure iritzia",
      submit: "bidali balorazioa",
    },
    rvThanks: ["eskerrik asko", "eskerrik asko zure balorazioagatik", "behar bezala jaso dugu eta webgunean argitaratu aurretik berrikusiko dugu."],
    rvDone: ["balorazioa jasota", "badugu zure balorazioa", "eskerrik asko zure esperientzia kontatzeagatik. esteka honek balorazio bakarrerako balio du."],
    rvNotReady: ["oraindik ez dago erabilgarri", "oraindik ez dago erabilgarri", "proiektuaren fase guztiak amaitzean baloratu ahal izango duzu."],
    rvMissing: ["datuak falta dira", "datuak osatu gabe daude", "itzuli atzera eta bete zure izena eta iruzkina."],
    ap: {
      eyebrow: "fasearen berrikuspena",
      title: "proposamena berrikusi",
      heading: "berrikusi fasearen proposamena",
      intro: (ph, br) => `berrikusi ${br} proiektuko "${ph}" faseko entregagarria. onar dezakezu hurrengo etaparantz aurrera egiteko edo doikuntza zehatzak eskatu.`,
      deliverable: "ireki entregagarria edo aurrebista",
      roundsUsed: (u, m) => `fase honetan erabilitako txandak: ${m}tik ${u}`,
      legal: "onartzean, fase hau itxitzat ematen duzu zerbitzu-baldintzen arabera. eskuragarri dauden txanden barruan aldaketak behar badituzu, ireki beheko bigarren botoia.",
      confirmApprove: "proposamena berrikusi dudala eta fase hau behin betiko onartu nahi dudala berresten dut",
      confirmRevise: "zuzenketak berrikusi ditudala eta doikuntza-txanda hau bidali nahi dudala berresten dut",
      confirmBuyRevision: "stripe-ko ordainketa seguruaren bidez 100 €-ren truke doikuntza-txanda gehigarri 1 desblokeatu nahi dudala berresten dut",
      confirmRequired: "nahitaezkoa da berrespen-laukia markatzea bidali aurretik.",
      btn: "onartu fasea eta jarraitu",
      btnBuyRevision: "desblokeatu doikuntza-txanda gehigarri 1",
      unlockedBanner: "txanda gehigarria arrakastaz desblokeatu da! dagoeneko beheko formulario tolesgarrian zure doikuntzak adieraz ditzakezu.",
      stripeError: "ezin izan da ordainketa segurua hasi. mesedez, saiatu berriro une batzuk buruan.",
      revToggle: (r, m) => `eskatu doikuntzak (${m}tik ${r}. txanda)`,
      revLabel: (r, m) => `azaldu argi behar dituzun doikuntzak (${m}tik ${r}. txanda)`,
      revPh: "adierazi mezu bakarrean txanda honetan aplikatu beharreko aldaketa zehatz guztiak...",
      revSubmit: (r, m) => `bidali ${m}tik ${r}. txandako doikuntzak`,
      revEmpty: "idatzi behar dituzun doikuntzak txanda bidali aurretik.",
      revExhausted: "fase honetan barne hartutako berrikuspen-txandak erabili dituzu. goian proposamena onar dezakezu jarraitzeko edo doikuntza-txanda gehigarri bat desblokeatu (+100 €).",
      revDone: ["behar bezala bidalita!", "doikuntzak arrakastaz erregistratuta", (r, m) => `${m}-tik ${r}. txandako zure jarraibideak jaso ditugu eta postaz jakinaraziko dizugu bertsio eguneratua berrikusteko prest dagoenean.`],
      revWorking: ["doikuntzak abian", "zure doikuntzak aplikatzen ari gara", (r, m) => `dagoeneko erregistratuta dugu ${m}-tik ${r}. txandako zure eskaera eta bertsio berria prestatzen ari gara. prest dagoenean postaz jakinaraziko dizugu.`],
      done: ["behar bezala bidalita!", "fasea arrakastaz onartuta", "zure idatzizko baliozkotzea erregistratu dugu eta dagoeneko aktibatu dugu zure proiektuaren hurrengo etapa."],
      already: ["fasea kudeatuta", "fase hau itxita dago jada", "fase hau dagoeneko onartuta eta osatuta agertzen da zure proiektuan."],
      completed: ["proiektua arrakastaz amaitu da!", "fase guztiak osatuta", "zure proiektuko fase guztiak arrakastaz baliozkotu dira. dagoeneko eskuragarri dituzu behin betiko fitxategi guztiak zure jarraipen-panelean."],
    },
    rn: {
      eyebrow: "web-azpiegitura",
      title: "utzi bertan behera urteko berritzea",
      heading: "eman baja urteko berritzeari",
      intro: (br, date) => `${br} proiekturako baja berresten baduzu, ez da kargu gehigarririk egingo eta domeinuak, posta korporatiboak eta webguneak aktibo egoteari utziko diote indarrean dagoen epea amaitzean (${date}).`,
      btn: "berretsi urteko berritzearen baja",
      done: ["baja baieztatuta", "urteko berritzea bertan behera utzi da", "baja erregistratu dugu. ez duzu kargu gehigarririk jasoko egungo epea amaitzean."],
      already: ["baja erregistratuta", "berritzea dagoeneko bertan behera zegoen", "proiektu honek dagoeneko desaktibatuta du urteko berritzea."],
    },
    tr: {
      eyebrow: "bezeroaren ataria",
      title: "jarraipena",
      heading: "zure proiektuaren jarraipena",
      project: "proiektua",
      services: "zerbitzuak",
      paid: "ordaindutako zenbatekoa (ordainketa bakarra)",
      due: "ordaintzeko zenbatekoa (ordainketa bakarra)",
      receipt: "ikusi ordainagiria edo faktura stripe-n",
      payIntro: "zure proiektua gordeta dago. osatu ordainketa bakarra modu seguruan stripe bidez lehen fasea formalki hasteko. duela segundo batzuk ordaindu baduzu, kargatu berriro orri hau.",
      payBtn: "osatu ordainketa segurua stripe-n",
      state: "proiektuaren faseak",
      step: "urratsa",
      done: "osatuta",
      doneClient: "zuk onartua",
      doneTacit: "onespen isila",
      review: "proposamena prest — zure onarpenaren zain",
      reviewAction: "berrikusi, onartu edo doikuntzak eskatu",
      deliverable: "ikusi entregagarria",
      studioNote: "estudioaren oharra",
      active: "martxan une honetan",
      activeRev: (r, m) => `zure doikuntzak aplikatzen (${m}tik ${r}. txanda)`,
      todo: "egiteke",
      obEyebrow: "proiektuaren abiatzea",
      obTitle: "bidali zure hasierako materialak",
      obIntro: "partekatu hiru datu hauek urrats bakarrean itxaronaldirik gabe hasteko. gure edozein mezuri ere erantzun diezaiokezu.",
      obSocials: "egungo webgunea edo sareak (instagram, maps, linkedin...)",
      obSocialsPh: "adib. instagram.com/zuremarka edo gaur egun presentziarik gabe",
      obDomain: "domeinua (dagoeneko baduzu edo zein nahiko zenukeen)",
      obDomainPh: "adib. badut zuremarka.eus / zuremarka.com nahiko nuke",
      obDomainRequired: "derrigorrezkoa webgunedun proiektuetarako",
      obDomainMissing: ["domeinua derrigorrezkoa", "adierazi zure webgunearen domeinua", "zure proiektuak web garapena barne hartzen du, beraz, lehendik duzun domeinua edo erregistratzea nahi duzuna adierazi behar duzu hasteko."],
      obMaterials: "aurreko logotipoa, argazkiak eta testuak dituen karpetarako esteka (drive, wetransfer, dropbox...) edo oharrak",
      obMaterialsPh: "https://drive.google.com/... edo ohar laburrak",
      obMaterialsHistory: "emandako materialak",
      obReferencesHistory: "ikus-erreferentziak eta inspirazioa",
      obAddTitle: "gehitu materialak edo erreferentziak",
      obAddIntro: "negozioaren material berriak edo ikus-erreferentziak gehi ditzakezu edozein unetan. bidaltzen duzun guztia historian metatuko da aurrekoa gainidatzi gabe.",
      blockAMaterials: "1. blokea — negozioaren materialak",
      obMaterialsUrl: "kanpoko esteka karpeta edo fitxategietara (hautazkoa, drive, dropbox, wetransfer...)",
      obMaterialsUrlPh: "https://drive.google.com/...",
      obMaterialsFile: "kargatu materialaren fitxategi zuzena (hautazkoa, aurreko logoa, argazkiak, zip, pdf...)",
      obMaterialsFileNote: "edozein formatu onartzen du (png, jpg, svg, webp, pdf, zip...) 25 mb arte.",
      obMaterialsNotes: "materialari buruzko ohar osagarriak edo argibideak (hautazkoa)",
      obMaterialsNotesPh: "bidaltzen duzunari buruzko testuinguru laburra, nahi diren kolore korporatiboak, testuak...",
      blockBRefs: "2. blokea — ikus-erreferentziak eta inspirazioa",
      obRefUrl: "erreferentzia-esteka edo gustuko duzun webgunea (hautazkoa)",
      obRefUrlPh: "https://...",
      obRefFile: "kargatu erreferentzia-pantaila-argazkia edo irudia (hautazkoa)",
      obRefNotes: "zer gustatzen zaizu erreferentzia honetatik (hautazkoa)",
      obRefNotesPh: "adib. tipografia, itxura garbia, egitura edo komunikazio-tonua gustatzen zait...",
      obFileDownload: "deskargatu erantsitako fitxategia",
      obInvalidUrlTitle: "esteka baliogabea",
      obInvalidUrlHeading: "berrikusi emandako esteka",
      obInvalidUrlMsg: "kanpoko estekek https:// erabili behar dute (adibidez https://drive.google.com/...). itzuli eta zuzendu edo hutsik utzi fitxategi zuzen bat kargatzen baduzu.",
      fileTooLargeTitle: "fitxategi handiegia",
      fileTooLargeHeading: "fitxategiaren tamaina gainditu da",
      fileTooLarge: "fitxategiak zuzenean igotzeko onartutako 25 mb-ko muga gainditzen du. fitxategi astunagoetarako, partekatu kanpoko esteka baten bidez (drive, wetransfer edo dropbox).",
      confirmOnboarding: "datuak eta estekak berrikusi ditudala eta estudiora behin betiko bidali nahi ditudala berresten dut",
      confirmRequired: "nahitaezkoa da berrespen-laukia markatzea materialak bidali aurretik.",
      confirmRequiredTitle: "derrigorrezko berrespena",
      confirmRequiredHeading: "markatu berrespen-laukia",
      obAccordionTitle: "material edo erreferentzia gehiago gehitu nahi duzu?",
      obDelayWarning: "oharra: aurreko materialekin uneko fasean lanean hasi bagara, elementu berriak gehitzea berrikustear zauden proposamenaren epetik kanpo gera liteke.",
      actionRegisteredNotice: "oharra: ekintza hau sisteman erregistratuta geratu da eta gure lantaldeak jakinarazpena jaso du lanean jarraitzeko.",
      obSuccess: ["behar bezala bidalita!", "materialak arrakastaz erregistratu dira", "zure materialak eta erreferentziak behar bezala jaso ditugu eta gure lantaldeak berrikusiko ditu proiektuan sartzeko."],
      obSubmit: "bidali materialak estudiora",
      obSentBanner: "materialak behar bezala jaso dira. gure taldeak dena erregistratuta dauka jada.",
      obSentTitle: "bidalitako hasierako materialak",
      obUndoBanner: "materialak behar bezala gehitu dira",
      obUndoBtn: "desegin",
      obDismissBtn: "itxi jakinarazpena",
      obUndoneBanner: "ekintza desegin da: zure zirriborroa leheneratu dugu behar duzuna zuzendu ahal izateko.",
      obPrevFile: (name) => `aurreko fitxategia: ${name} (hautatu berriro erantsi nahi baduzu)`,
      obPrevRef: (name) => `aurreko erreferentzia: ${name} (hautatu berriro erantsi nahi baduzu)`,
      extraWorkEyebrow: "ezohiko lana",
      extraWorkTitle: "ondorengo aldaketak edo hobekuntzak (100 € txandako)",
      extraWorkDesc: "estudioko bezero gisa, azken entregaren ondoren edozein unetan eska dezakezu aparteko aldaketa-txanda bat edo puntualki zure webgunean edo nortasunean hobekuntzak egiteko 100 €-ko prezio itxian.",
      extraWorkPh: "azaldu zure webgunean, logotipoan edo nortasunean behar dituzun doikuntzak edo aldaketak...",
      extraWorkBtn: "eskatu eta ordaindu aparteko txanda (100 €)",
      extraWorkSuccess: "aparteko txanda behar bezala ordaindu da. lantaldeak zure oharrak jaso ditu eta zurekin harremanetan jarriko da aplikatzeko.",
      extraWorkEmpty: "mesedez, azaldu laburki behar dituzun aldaketak jarraitu aurretik.",
      extraWorkHistory: "eskatutako aparteko lanak:",
      extraWorkStatusReceived: "estudioak jasoa",
      obLblSocials: "webgunea edo sareak",
      obLblDomain: "domeinua",
      obLblMaterials: "karpeta edo oharrak",
      obMissing: ["datuak falta dira", "adierazi gutxienez datu bat", "bete gutxienez eremuetako bat inprimakia bidali aurretik."],
      chatEyebrow: "zuzeneko laguntza eta adimen artifiziala",
      chatHeading: "laguntza eta proiektuaren txata",
      chatTabBrandi: "brandi (ia)",
      chatTabHuman: "gael eta bernat (lan-taldea)",
      brandiIntro: "brandik zure proiektuaren egoera zehatza, kontratatutako zerbitzuak, faseak eta epeak ezagutzen ditu zure zalantzak berehala argitzeko.",
      switchToHuman: "giza taldearekin hitz egin",
      brandiWelcome: (brand) => `kaixo, ${brand} proiektuari buruzko guztiaren berri dut. zertan lagun zaitzaket gaur?`,
      brandiPlaceholder: "galdetu brandiri faseei, entrega-lanei edo berrikuspenei buruz...",
      humanIntro: "idatzi zuzenean gael eta bernati. zure panelean eta posta elektronikoz erantzungo dizugu.",
      humanPlaceholder: "idatzi zure mezua gael eta bernati...",
      humanSentSuccess: "mezua lan-taldeari bidali zaio. ahalik eta lasterren erantzungo dizugu.",
      humanEmptyMsg: "idatzi mezu bat bidali aurretik.",
      sendBtn: "bidali",
      chatYou: "zu",
      chatStudio: "gael eta bernat",
      chatBrandi: "brandi (ia)",
      chatNoMessages: "oraindik ez dago mezurik lan-taldearekin. idatzi behean elkarrizketa hasteko.",
      chatErr: "konexio-errorea. ezin izan da mezua bidali. saiatu berriro.",
      chatTransIndicator: "automatikoki itzulita, egin klik jatorrizko mezua ikusteko",
      chatViewTrans: "ikusi itzulpen automatikoa",
    },
  },
  en: {
    invalid: ["invalid link", "invalid link", "this link is not valid or is incomplete."],
    expired: ["link expired", "link expired", "this link has expired or has already been used."],
    config: ["configuration error", "configuration error", "the server is missing configuration."],
    verify: ["email verification", "confirm your email", "click the button to verify your briefing, set up your project and open the secure payment page."],
    retry: ["payment gateway", "we could not open the payment page", "your briefing is already registered. click again to open the secure payment page or write to us at hola@rebrandyourbrand.es."],
    error: ["temporary error", "temporary error", "please try again in a few minutes."],
    trackInvalid: ["project not found", "project not found", "the tracking link is not valid or has expired."],
    trackMissing: ["project not found", "project not found", "we could not find this project."],
    btn: "verify and go to payment",
    common: {
      backSite: "back to rebrandyourbrand.es",
      openTracker: "view my project tracking",
      openReview: "leave project review",
      studioTag: "rebranding and web studio",
    },
    rv: {
      eyebrow: "verified review",
      title: "project review",
      heading: "tell us how it went",
      intro: "thank you for trusting us. your feedback helps us improve and, once reviewed, may appear on our website.",
      business: "your business or brand",
      name: "your full name",
      rating: "rating",
      comment: "your opinion about the service",
      submit: "send review",
    },
    rvThanks: ["thank you", "thank you for your review", "we have received it and will review it before publishing it on the website."],
    rvDone: ["review received", "we already have your review", "thank you for sharing your experience. this link only works for one review."],
    rvNotReady: ["not available yet", "not available yet", "you will be able to review your project once all phases are finished."],
    rvMissing: ["missing details", "missing required details", "please go back and fill in your name and comment."],
    ap: {
      eyebrow: "phase review",
      title: "review proposal",
      heading: "review phase proposal",
      intro: (ph, br) => `review the deliverable for the "${ph}" phase of project ${br}. you can approve it to move on to the next stage or request specific adjustments.`,
      deliverable: "open deliverable or preview",
      roundsUsed: (u, m) => `revision rounds used in this phase: ${u} of ${m}`,
      legal: "by approving, this phase is closed under our terms of service. if you need changes within your available rounds, expand the secondary button below.",
      confirmApprove: "i confirm that i have reviewed the proposal and want to approve this phase definitively",
      confirmRevise: "i confirm that i have reviewed the feedback and want to submit this round of adjustments",
      confirmBuyRevision: "i confirm that i want to unlock 1 additional revision round for €100 via secure stripe checkout",
      confirmRequired: "you must tick the confirmation checkbox before sending.",
      btn: "approve phase and continue",
      btnBuyRevision: "unlock 1 additional revision round",
      unlockedBanner: "extra round successfully unlocked! you can now submit your adjustments using the dropdown form below.",
      stripeError: "could not initiate secure payment. please try again in a few moments.",
      revToggle: (r, m) => `request adjustments (round ${r} of ${m})`,
      revLabel: (r, m) => `describe clearly the adjustments you need (round ${r} of ${m})`,
      revPh: "list in a single message all the specific changes to apply in this round...",
      revSubmit: (r, m) => `send adjustments for round ${r} of ${m}`,
      revEmpty: "please write the adjustments you need before submitting this round.",
      revExhausted: "you have used the revision rounds included in this phase. you can approve the proposal above to proceed or unlock an additional revision round (+€100).",
      revDone: ["submitted successfully!", "adjustments recorded successfully", (r, m) => `we have received your instructions for round ${r} of ${m} and will email you as soon as the updated version is ready for review.`],
      revWorking: ["adjustments in progress", "applying your adjustments", (r, m) => `we have recorded your request for round ${r} of ${m} and are preparing the new version. we will email you as soon as it is ready.`],
      done: ["submitted successfully!", "phase approved successfully", "we have recorded your written approval and activated the next stage of your project."],
      already: ["already approved", "this phase is already closed", "this phase is already marked as approved and completed on your project."],
      completed: ["project successfully completed!", "all phases completed", "all phases of your project have been successfully approved. all your final files are now ready in your tracking dashboard."],
    },
    rn: {
      eyebrow: "web infrastructure",
      title: "cancel annual renewal",
      heading: "cancel annual renewal",
      intro: (br, date) => `if you confirm cancellation for ${br}, no further charges will be made and the domain, corporate email and website will stop being active at the end of the current period (${date}).`,
      btn: "confirm annual renewal cancellation",
      done: ["cancellation confirmed", "annual renewal canceled", "we have recorded your cancellation. no extra charges will be made when the current period expires."],
      already: ["already canceled", "renewal was already canceled", "annual renewal is already turned off for this project."],
    },
    tr: {
      eyebrow: "client portal",
      title: "tracking",
      heading: "your project tracking",
      project: "project",
      services: "services",
      paid: "amount paid (one-time payment)",
      due: "amount due (one-time payment)",
      receipt: "view receipt or invoice on stripe",
      payIntro: "your project is reserved. complete your secure one-time payment on stripe to officially start the first phase. if you paid a few seconds ago, reload this page.",
      payBtn: "complete secure payment on stripe",
      state: "project phases",
      step: "step",
      done: "completed",
      doneClient: "approved by you",
      doneTacit: "tacit approval",
      review: "proposal ready — awaiting your approval",
      reviewAction: "review, approve or request adjustments",
      deliverable: "view deliverable",
      studioNote: "studio note",
      active: "in progress",
      activeRev: (r, m) => `applying your adjustments (round ${r} of ${m})`,
      todo: "pending",
      obEyebrow: "project kickoff",
      obTitle: "send us your initial materials",
      obIntro: "share these three details in one step so we can start right away. you can also reply to any of our emails.",
      obSocials: "current website or social media (instagram, maps, linkedin...)",
      obSocialsPh: "e.g. instagram.com/yourbrand or none yet",
      obDomain: "domain (if you already own one or which one you prefer)",
      obDomainPh: "e.g. i own yourbrand.com / i would like yourbrand.es",
      obDomainRequired: "mandatory for website projects",
      obDomainMissing: ["domain required", "please provide your website domain", "your project includes website development, so we need you to indicate your current domain or the domain you want us to register to get started."],
      obMaterials: "link to folder with previous logo, photos and copy (drive, wetransfer, dropbox...) or notes",
      obMaterialsPh: "https://drive.google.com/... or brief notes",
      obMaterialsHistory: "submitted materials",
      obReferencesHistory: "visual references and inspiration",
      obAddTitle: "add materials or references",
      obAddIntro: "you can provide new business assets or visual references at any time. everything you submit is added cumulatively to the log without overwriting previous items.",
      blockAMaterials: "block 1 — business materials",
      obMaterialsUrl: "external link to folder or files (optional, drive, dropbox, wetransfer...)",
      obMaterialsUrlPh: "https://drive.google.com/...",
      obMaterialsFile: "upload direct material file (optional, previous logo, photos, zip, pdf...)",
      obMaterialsFileNote: "accepts any format (png, jpg, svg, webp, pdf, zip...) up to 25 mb.",
      obMaterialsNotes: "additional notes or instructions about the assets (optional)",
      obMaterialsNotesPh: "brief context about what you are sharing, desired corporate colors, copy...",
      blockBRefs: "block 2 — visual references and inspiration",
      obRefUrl: "reference link or website you like (optional)",
      obRefUrlPh: "https://...",
      obRefFile: "upload reference screenshot or image (optional)",
      obRefNotes: "what do you like about this reference (optional)",
      obRefNotesPh: "e.g. i like the typography, clean layout, structure or tone of voice...",
      obFileDownload: "download attached file",
      obInvalidUrlTitle: "invalid link",
      obInvalidUrlHeading: "check the link you provided",
      obInvalidUrlMsg: "external links must use https:// (for example https://drive.google.com/...). please go back and correct it or leave it empty if you upload a direct file.",
      fileTooLargeTitle: "file too large",
      fileTooLargeHeading: "file size limit exceeded",
      fileTooLarge: "the file exceeds the 25 mb limit for direct upload. for heavier files, please share it using an external link (drive, wetransfer or dropbox).",
      confirmOnboarding: "i confirm that i have reviewed the details and links and want to send them definitively to the studio",
      confirmRequired: "you must tick the confirmation checkbox before sending materials.",
      confirmRequiredTitle: "confirmation required",
      confirmRequiredHeading: "please tick the confirmation checkbox",
      obAccordionTitle: "would you like to add more materials or references?",
      obDelayWarning: "note: if we have already begun work on the current phase with previous materials, adding new elements now may fall outside the scope or timeframe for the proposal you are about to review.",
      actionRegisteredNotice: "notice: this action has been recorded in the system and our team has received notification to proceed with the work.",
      obSuccess: ["submitted successfully!", "assets recorded successfully", "we have received your materials and references successfully and our team will review them for the project."],
      obSubmit: "send materials to studio",
      obSentBanner: "materials received. our team has everything logged.",
      obSentTitle: "submitted kickoff materials",
      obUndoBanner: "materials added successfully",
      obUndoBtn: "undo",
      obDismissBtn: "close notice",
      obUndoneBanner: "action undone: your draft has been restored so you can make your corrections.",
      obPrevFile: (name) => `previous file: ${name} (select it again if you wish to attach it)`,
      obPrevRef: (name) => `previous reference: ${name} (select it again if you wish to attach it)`,
      extraWorkEyebrow: "extraordinary work",
      extraWorkTitle: "subsequent adjustments or enhancements (€100 per round)",
      extraWorkDesc: "as a studio client, after final delivery you can request an extraordinary round of adjustments or specific improvements to your website or brand identity at any time for a fixed price of €100.",
      extraWorkPh: "describe the adjustments or changes you need for your website, logo, or brand identity...",
      extraWorkBtn: "request and pay for extra round (€100)",
      extraWorkSuccess: "extra round successfully paid. the studio team has received your notes and will be in touch to implement them.",
      extraWorkEmpty: "please briefly describe the changes you need before continuing.",
      extraWorkHistory: "requested extraordinary work:",
      extraWorkStatusReceived: "received by the studio",
      obLblSocials: "web or social",
      obLblDomain: "domain",
      obLblMaterials: "folder or notes",
      obMissing: ["missing details", "please fill in at least one field", "enter at least one detail before sending the form."],
      chatEyebrow: "direct support and ai",
      chatHeading: "assistance and project chat",
      chatTabBrandi: "brandi (ai)",
      chatTabHuman: "gael and bernat (team)",
      brandiIntro: "brandi knows the exact status of your project, contracted services, phases and deadlines to resolve your questions instantly.",
      switchToHuman: "talk to the human team",
      brandiWelcome: (brand) => `hello, i am up to date with everything regarding your project for ${brand}. how can i help you today?`,
      brandiPlaceholder: "ask brandi about phases, deliverables, revisions...",
      humanIntro: "write directly to gael and bernat. we will reply in your portal and by email.",
      humanPlaceholder: "write your message for gael and bernat...",
      humanSentSuccess: "message sent to the team. we will reply as soon as possible.",
      humanEmptyMsg: "write a message before sending.",
      sendBtn: "send",
      chatYou: "you",
      chatStudio: "gael and bernat",
      chatBrandi: "brandi (ai)",
      chatNoMessages: "no messages with the team yet. write below to start the conversation.",
      chatErr: "connection error. could not send message. please try again.",
      chatTransIndicator: "automatically translated, click to view the original message",
      chatViewTrans: "view automatic translation",
    },
  },
};

// ══ security.js — Criptografía HMAC, tokens deterministas, sesión de chat y Turnstile. ══

const enc = new TextEncoder();

let cachedSecret = "";
let cachedKeyPromise = null;

const getKey = (env) => {
  if (!env.CHAT_SIGNING_SECRET) throw new HttpError(500, "misconfigured");
  if (cachedSecret !== env.CHAT_SIGNING_SECRET || !cachedKeyPromise) {
    cachedSecret = env.CHAT_SIGNING_SECRET;
    cachedKeyPromise = crypto.subtle.importKey(
      "raw",
      enc.encode(cachedSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );
  }
  return cachedKeyPromise;
};

const toHex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

const fromHex = (h) => Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16));

const signRaw = async (key, text) => toHex(await crypto.subtle.sign("HMAC", key, enc.encode(text)));

const verifyRaw = async (key, text, sig) =>
  typeof sig === "string" &&
  /^[0-9a-f]{64}$/.test(sig) &&
  (await crypto.subtle.verify("HMAC", key, fromHex(sig), enc.encode(text)));

const randomHex = (bytes) => toHex(crypto.getRandomValues(new Uint8Array(bytes)));

const signMsg = (key, text) => signRaw(key, `msg|${text}`);

const verifyMsg = (key, text, sig) => verifyRaw(key, `msg|${text}`, sig);

const confirmPayload = (email, brand, plan, domain = "") => `confirm|${email}|${brand}|${plan.ids.join(",")}|${domain || ""}`;

// Tokens deterministas firmados por HMAC (sin depender de claves temporales en KV)
const getActionToken = (key, projectToken, step) => signRaw(key, `action|${projectToken}|${step}`);

const approvePhaseToken = (key, projectToken, step) => signRaw(key, `approve|${projectToken}|${step}`);

const cancelRenewalToken = (key, projectToken, dueIso) => signRaw(key, `crenew|${projectToken}|${dueIso}`);

const renewalActionToken = (key, projectToken) => signRaw(key, `renew|${projectToken}`);

const fileDownloadToken = (key, projectToken, step, fileId) => signRaw(key, `file|${projectToken}|${step}|${fileId}`);

const adminChatToken = (key, projectToken) => signRaw(key, `adminchat|${projectToken}`);

const testimonialDeleteToken = (key, id) => signRaw(key, `tdel|${id}`);

const reviewSig = (key, projectToken) => signRaw(key, `review|${projectToken}`);

const resumeSig = (key, verifyToken) => signRaw(key, `resume|${verifyToken}`);

async function advancePhaseUrl(env, projectToken, step) {
  const key = await getKey(env);
  const t = await getActionToken(key, projectToken, step);
  return buildUrl("/advance-phase", { p: projectToken, step, t });
}

async function approvePhaseUrl(env, projectToken, step) {
  const key = await getKey(env);
  const t = await approvePhaseToken(key, projectToken, step);
  return buildUrl("/approve-phase", { p: projectToken, step, t });
}

async function cancelRenewalUrl(env, projectToken, dueIso) {
  const key = await getKey(env);
  const t = await cancelRenewalToken(key, projectToken, dueIso);
  return buildUrl("/cancel-renewal", { p: projectToken, due: dueIso, t });
}

async function renewalActionUrl(env, projectToken) {
  const key = await getKey(env);
  const t = await renewalActionToken(key, projectToken);
  return buildUrl("/renovar", { p: projectToken, t });
}

async function fileDownloadUrl(env, projectToken, step, fileId) {
  const key = await getKey(env);
  const t = await fileDownloadToken(key, projectToken, step, fileId);
  return buildUrl("/file", { p: projectToken, step, id: fileId, t });
}

async function studioChatUrl(env, projectToken) {
  const key = await getKey(env);
  const t = await adminChatToken(key, projectToken);
  return buildUrl("/responder-chat", { p: projectToken, t });
}

// Sesión de chat: se emite tras resolver Turnstile una vez. Va firmada (HMAC), caduca y está ligada a la IP.
async function makeSession(key, ip) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  return `${exp}.${await signRaw(key, `session|${exp}|${ipKey(ip)}`)}`;
}

async function verifySession(key, session, ip) {
  if (typeof session !== "string" || session.length > 100) return false;
  const [exp, sig] = session.split(".");
  if (!/^\d{10}$/.test(exp || "") || Number(exp) < Date.now() / 1000) return false;
  return verifyRaw(key, `session|${exp}|${ipKey(ip)}`, sig);
}

async function verifyTurnstile(env, token, ip, action = "brandi-chat") {
  if (typeof token !== "string" || !token || token.length > 2048) throw new HttpError(403, "captcha_failed");
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  if (ip) body.set("remoteip", ip);
  let res;
  try {
    res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new HttpError(503, "captcha_unavailable");
  }
  const r = await res.json().catch(() => null);
  if (!r?.success || !ALLOWED_HOSTNAMES.includes(r.hostname) || r.action !== action) {
    throw new HttpError(403, "captcha_failed");
  }
}

function ipKey(ip) {
  if (!ip) return "unknown";
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  return [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t]
    .slice(0, 4)
    .map((g) => g.padStart(4, "0"))
    .join(":");
}

async function parseResume(key, token) {
  if (typeof token !== "string" || token.length !== 129) return null;
  const [vt, sig] = token.split(".");
  if (!/^[a-f0-9]{64}$/.test(vt || "")) return null;
  return (await verifyRaw(key, `resume|${vt}`, sig)) ? vt : null;
}

async function checkRateLimit(env, key, limit = 4, ttlSec = 3600) {
  if (!env?.LEADS_KV || !key) return true;
  const rlKey = `rl:${key}`;
  const current = await env.LEADS_KV.get(rlKey);
  const count = current ? parseInt(current, 10) : 0;
  if (count >= limit) return false;
  await env.LEADS_KV.put(rlKey, String(count + 1), { expirationTtl: ttlSec });
  return true;
}

// ══ email.js — Diseño editorial de correos, envío por Resend y alertas internas. ══

const EMAIL_SIGN = {
  es: "— el equipo de rebrandyourbrand",
  ca: "— l'equip de rebrandyourbrand",
  eu: "— rebrandyourbrand taldea",
  en: "— the rebrandyourbrand team",
};

/**
 * Devuelve { html, text } con el diseño editorial de marca.
 *  paras:         párrafos en HTML ya escapado (usa bold() y lines())
 *  cta:           { label, url } botón principal (opcional)
 *  secondaryLink: { label, url } enlace secundario limpio (opcional)
 *  note:          texto pequeño antes de la firma, en HTML ya escapado (opcional)
 *  quote:         bloque de cita en texto plano (opcional)
 */
function renderEmail(lang, { paras = [], cta = null, secondaryLink = null, note = "", quote = "" }) {
  const l = pickLang(lang);
  const pStyle = "color:#58575E;font-size:14px;line-height:1.65;margin:0 0 20px;";
  const body = paras.map((p) => `<p style="${pStyle}">${p}</p>`).join("");
  const quoteHtml = quote
    ? `<blockquote style="margin:0 0 24px;padding:14px 16px;background:linear-gradient(145deg,rgba(255,255,255,0.95),rgba(246,241,232,0.7));background-color:#FFFFFF;border:1px solid #E4DED0;border-left:3px solid #8CA3C4;border-radius:0 10px 10px 0;box-shadow:inset 0 1px 0 rgba(255,255,255,0.9),0 4px 14px rgba(60,50,30,0.04);color:#17171A;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;">${esc(quote)}</blockquote>`
    : "";
  const button = cta
    ? `<div style="text-align:center;margin:32px 0 20px;"><a href="${esc(cta.url)}" target="_blank" style="background:linear-gradient(150deg,#8CA3C4,#7893B8);background-color:#8CA3C4;color:#0A0A0C;padding:14px 28px;text-decoration:none;font-weight:600;font-size:13px;border-radius:12px;display:inline-block;text-transform:lowercase;box-shadow:inset 0 1px 0 rgba(255,255,255,0.4),0 8px 18px -4px rgba(95,122,158,0.25);">${esc(cta.label)}</a></div>`
    : "";
  const secondary = secondaryLink
    ? `<p style="text-align:center;margin:0 0 24px;font-size:12px;"><a href="${esc(secondaryLink.url)}" target="_blank" style="color:#3D5A85;text-decoration:underline;text-transform:lowercase;">${esc(secondaryLink.label)}</a></p>`
    : "";
  const helpLineByLang = {
    es: '¿tienes alguna pregunta? escríbenos a <a href="mailto:hola@rebrandyourbrand.es" style="color:#3D5A85;text-decoration:underline;">hola@rebrandyourbrand.es</a>.',
    ca: 'tens alguna pregunta? escriu-nos a <a href="mailto:hola@rebrandyourbrand.es" style="color:#3D5A85;text-decoration:underline;">hola@rebrandyourbrand.es</a>.',
    eu: 'galderarik baduzu? idatzi iezaguzu <a href="mailto:hola@rebrandyourbrand.es" style="color:#3D5A85;text-decoration:underline;">hola@rebrandyourbrand.es</a> helbidera.',
    en: 'have any questions? write to us at <a href="mailto:hola@rebrandyourbrand.es" style="color:#3D5A85;text-decoration:underline;">hola@rebrandyourbrand.es</a>.',
  };
  const helpTextByLang = {
    es: "¿tienes alguna pregunta? escríbenos a hola@rebrandyourbrand.es.",
    ca: "tens alguna pregunta? escriu-nos a hola@rebrandyourbrand.es.",
    eu: "galderarik baduzu? idatzi iezaguzu hola@rebrandyourbrand.es helbidera.",
    en: "have any questions? write to us at hola@rebrandyourbrand.es.",
  };
  const footer = `<p style="color:#58575E;font-size:12px;line-height:1.55;margin:32px 0 0;border-top:1px solid #E4DED0;padding-top:20px;">${note ? `${note}<br><br>` : ""}${helpLineByLang[l]}<br><br>${EMAIL_SIGN[l]}</p>`;

  const html = `<!DOCTYPE html>
<html lang="${l}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"></head>
<body style="background-color:#FAF7F3;color:#17171A;font-family:'Inter',Arial,sans-serif;padding:40px 20px;margin:0;">
  <div style="max-width:560px;margin:0 auto;background:linear-gradient(150deg,rgba(255,255,255,0.96) 0%,rgba(246,241,232,0.85) 100%);background-color:#EDE6D6;border:1px solid #E4DED0;border-radius:20px;box-shadow:inset 0 1px 0 rgba(255,255,255,0.95),0 16px 36px -10px rgba(60,50,30,0.08);padding:40px;-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);">
    <h2 style="font-family:'Fraunces',Georgia,serif;font-size:22px;letter-spacing:-0.03em;margin:0 0 24px;color:#17171A;font-weight:400;text-transform:lowercase;">rebrandyourbrand</h2>
    ${body}${quoteHtml}${button}${secondary}${footer}
  </div>
</body></html>`;

  const text = [
    ...paras.map(htmlToText),
    quote,
    cta ? `${cta.label}:\n${cta.url}` : "",
    secondaryLink ? `${secondaryLink.label}:\n${secondaryLink.url}` : "",
    [note && htmlToText(note), helpTextByLang[l], EMAIL_SIGN[l]].filter(Boolean).join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n\n");

  return { html, text };
}

// Resend con soporte de Idempotency-Key, reintento con backoff en 429/5xx y lectura diagnóstica de errores
async function resendSend(env, payload, idempotencyKey, headersExtra = null) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${env.RESEND_API_KEY}`,
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const body = {
    from: "rebrandyourbrand <hola@rebrandyourbrand.es>",
    ...payload,
  };
  if (headersExtra && typeof headersExtra === "object") {
    body.headers = { ...(body.headers || {}), ...headersExtra };
  }

  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(attempt === 0 ? 6000 : 8000),
      });

      if (res.ok) {
        return await res.json().catch(() => ({}));
      }

      const errText = await res.text().catch(() => "");
      const status = res.status;

      if ((status === 429 || status >= 500) && attempt === 0 && idempotencyKey) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }

      console.error(`Resend error ${status}: ${errText.slice(0, 300)}`);
      throw new Error(`Resend error: ${status}`);
    } catch (err) {
      if (attempt === 0 && idempotencyKey && !err.message?.includes("Resend error: 4")) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      throw err;
    }
  }
}

// Aviso interno con el mismo diseño. El asunto y el texto empiezan siempre en minúscula.
function alertAdmin(env, subject, text, ctx) {
  const p = resendSend(
    env,
    {
      to: ["hola@rebrandyourbrand.es"],
      subject: `aviso interno — ${lc1(subject)}`,
      ...renderEmail("es", { paras: [esc(lc1(text)).replace(/\n/g, "<br>")] }),
    },
    `alert-${Date.now()}-${randomHex(4)}`
  ).catch((e) => console.error("alertAdmin failed:", e?.message));
  if (ctx?.waitUntil) ctx.waitUntil(p);
  return p;
}

async function reviewUrl(env, projectToken) {
  return buildUrl("/valorar", { p: projectToken, t: await reviewSig(await getKey(env), projectToken) });
}

async function sendReviewInvite(env, proj, projectToken) {
  const lang = pickLang(proj.lang);
  const t = EM[lang].review;
  await resendSend(
    env,
    {
      to: [proj.clientEmail],
      subject: t.subject(proj.brand),
      ...renderEmail(lang, {
        paras: [t.hello, t.intro(bold(proj.brand)), t.ask, t.thanks],
        cta: { label: t.cta, url: await reviewUrl(env, projectToken) },
        note: t.note,
      }),
    },
    `review-invite-${projectToken}`
  );
}

// ══ leads.js — Doble opt-in de correo y entrega de leads verificados. ══

// Envía (o reenvía) el correo de verificación. "attempt" distingue la clave de idempotencia de cada reenvío.
async function sendVerifyEmail(env, { lang, brand, clientEmail }, verifyToken, attempt = 0) {
  const l = pickLang(lang);
  const t = EM[l].verify;
  await resendSend(
    env,
    {
      to: [clientEmail],
      subject: t.subject,
      ...renderEmail(l, {
        paras: [t.hello, t.intro(brand ? bold(brand) : ""), t.ask],
        cta: { label: t.cta, url: buildUrl("/verify", { token: verifyToken }) },
        note: t.ignore,
      }),
    },
    `verify-${verifyToken}-${attempt}`
  );
}

async function startVerification(env, { lang, messages, plan, clientEmail, brand, domain }) {
  const cooldownKey = `cooldown:${clientEmail}`;
  if (await env.LEADS_KV.get(cooldownKey)) {
    throw new HttpError(429, "email_cooldown", { "Retry-After": String(EMAIL_COOLDOWN_SECONDS) });
  }
  if (!plan) throw new HttpError(400, "plan_required");
  if (!brand || typeof brand !== "string" || !brand.trim()) throw new HttpError(400, "brand_required");

  const l = pickLang(lang);
  const verifyToken = randomHex(32);
  const pendingKey = `pending:${verifyToken}`;
  const pendingPayload = {
    lang: l,
    messages,
    services: plan.ids,
    clientEmail,
    brand,
    domain: domain || "",
    resends: 0,
    timestamp: new Date().toISOString(),
  };
  await Promise.all([
    env.LEADS_KV.put(pendingKey, JSON.stringify(pendingPayload), { expirationTtl: PENDING_VERIFY_TTL_SECONDS }),
    env.LEADS_KV.put(cooldownKey, "1", { expirationTtl: EMAIL_COOLDOWN_SECONDS }),
  ]);
  try {
    await sendVerifyEmail(env, pendingPayload, verifyToken);
  } catch (e) {
    await Promise.all([env.LEADS_KV.delete(pendingKey), env.LEADS_KV.delete(cooldownKey)]).catch(() => {});
    console.error("verification email failed:", e?.message);
    throw new HttpError(502, "email_error");
  }
  return verifyToken;
}

function formatTranscript(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && typeof m.text === "string" && m.text.trim())
    .map((m) => `${m.role === "user" ? "cliente" : "brandi"}: ${m.text}`)
    .join("\n\n");
}

async function deliverVerifiedLead(env, ctx, { lang, messages, clientEmail, brand, plan, projectToken }) {
  const l = pickLang(lang);
  const transcript = formatTranscript(messages);
  const planLine = plan ? `${svcLabel(plan.ids, "es")} — ${plan.total} €` : "";
  const projectPageUrl = projectToken ? buildUrl("/proyecto", { token: projectToken }) : SITE_URL;

  const leadPromise = resendSend(
    env,
    {
      to: ["hola@rebrandyourbrand.es"],
      subject: `lead verificado (${l.toUpperCase()}) — ${brand || "sin marca"} (${clientEmail})`,
      reply_to: clientEmail,
      ...renderEmail("es", {
        paras: [
          "cliente verificado.",
          lines(
            `— marca: ${bold(brand || "sin indicar")}`,
            `— correo: ${bold(clientEmail)}`,
            planLine && `— servicios: ${bold(planLine)}`,
            `— idioma del pedido: ${bold(l)}`
          ),
          transcript ? "conversación con brandi:" : "",
        ].filter(Boolean),
        quote: transcript,
        cta: projectToken ? { label: "ver ficha del proyecto", url: projectPageUrl } : null,
      }),
    },
    `lead-${projectToken || clientEmail}`
  ).catch((e) => console.error("lead email to studio failed:", e?.message));

  const t = EM[l].ack;
  const ack = resendSend(
    env,
    {
      to: [clientEmail],
      subject: t.subject(brand || ""),
      ...renderEmail(l, {
        paras: [t.hello, t.body(brand ? bold(brand) : ""), t.next],
        cta: { label: t.cta, url: projectPageUrl },
        note: t.note,
      }),
    },
    `ack-${projectToken || clientEmail}`
  ).catch((e) => console.error("ack email failed:", e?.message));

  const allEmails = Promise.all([leadPromise, ack]);
  if (ctx?.waitUntil) {
    ctx.waitUntil(allEmails);
  } else {
    await allEmails;
  }
}

// ══ ai.js — Brandi (Groq): prompt, llamada al modelo, validación de respuestas y servicios elegidos. ══

// "plan" en este archivo = { ids: [...], total } con los servicios elegidos

function normalizeServices(input) {
  if (!Array.isArray(input)) return null;
  let ids = SERVICE_IDS.filter((id) => input.includes(id));
  if (!ids.length) return null;
  if (ids.includes("logo") && !ids.includes("paleta")) {
    ids.push("paleta");
  }
  ids = SERVICE_IDS.filter((id) => ids.includes(id));
  return { ids, total: calcPlanTotal(ids) };
}

const planOut = (p) => (p ? p.ids : null);

// Si el modelo devuelve una lista válida (el cliente cambió de idea) manda ella; si no, se mantiene la actual.
const mergeServices = (prev, out) => normalizeServices(out?.services) || prev || null;

async function normalizeMessages(key, messages) {
  if (!Array.isArray(messages)) return [];
  const checked = await Promise.all(
    messages.slice(-MAX_HISTORY_MESSAGES).map(async (m) => {
      if (!m || typeof m.text !== "string") return null;
      if (m.role === "user") {
        const text = m.text.trim().slice(0, MAX_USER_CHARS);
        return text ? { role: "user", text } : null;
      }
      if (m.role === "assistant" && (await verifyMsg(key, m.text, m.sig))) {
        return { role: "assistant", text: m.text };
      }
      return null;
    })
  );
  return checked.filter(Boolean);
}

function hasUnknownPrice(text) {
  for (const m of text.matchAll(/(\d[\d.,]*)\s*(?:€|euros?\b)|€\s*(\d[\d.,]*)/gi)) {
    const raw = (m[1] ?? m[2]).replace(/[.,]+$/, "").replace(/[.,](?=\d{3}(?!\d))/g, "").replace(",", ".");
    if (!ALLOWED_EUR.has(Number(raw))) return true;
  }
  return false;
}

const hasUnknownPercent = (t) => [...t.matchAll(/(\d{1,3})\s?%/g)].some((m) => m[1] !== "50" && m[1] !== "100");

function findEmail(chatMessages) {
  for (let i = chatMessages.length - 1; i >= 0; i--) {
    if (chatMessages[i].role !== "user") continue;
    const found = (chatMessages[i].text.match(EMAIL_FIND) ?? []).filter((e) => e.length <= 254);
    if (found.length) return found[found.length - 1].toLowerCase();
  }
  return "";
}

const DOMAIN_FIND = /\b(?:https?:\/\/)?(?:www\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z]{2,}(?:\.[a-z]{2,})?)\b/i;

const IGNORED_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "msn.com",
]);

function cleanDomainCandidate(raw) {
  if (!raw || typeof raw !== "string") return "";
  const withoutEmails = raw.replace(/\S+@\S+\.\S+/g, " ");
  const m = withoutEmails.match(DOMAIN_FIND);
  if (!m) return "";
  const d = m[1].toLowerCase();
  if (IGNORED_EMAIL_DOMAINS.has(d)) return "";
  return d;
}

function findDomain(chatMessages, fallback = "") {
  if (fallback && typeof fallback === "string") {
    const d = cleanDomainCandidate(fallback);
    if (d) return d;
    const trimmed = fallback.trim().toLowerCase();
    if (trimmed && !trimmed.includes("@") && !IGNORED_EMAIL_DOMAINS.has(trimmed)) {
      return trimmed;
    }
  }
  const msgs = Array.isArray(chatMessages) ? chatMessages : [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role !== "user" || typeof msgs[i].text !== "string") continue;
    const d = cleanDomainCandidate(msgs[i].text);
    if (d) return d;
  }
  return "";
}

const missingOf = (brand, email, plan, domain) =>
  [
    !brand && "brand",
    !plan && "services",
    Boolean(plan?.ids?.includes("web") && !domain) && "domain",
    !email && "email",
  ].filter(Boolean);

function buildSystemInstruction(lang, ctx) {
  const { plan, brand, email, domain, denied } = ctx;
  const langName = LANG_NAMES[pickLang(lang)] || LANG_NAMES.es;

  const servicesBlock = plan
    ? `SERVICIOS ELEGIDOS: ${svcLabel(plan.ids, "es")} (${plan.total} € en total).`
    : `SERVICIOS: sin elegir todavía. El cliente no ha usado el selector de la web, así que quizá no conoce todas las opciones.`;
  const domainBlock = plan?.ids?.includes("web")
    ? (domain ? `DOMINIO WEB: ya conocido (${domain}).` : `DOMINIO WEB: estrictamente OBLIGATORIO al contratar la web. Aún falta.`)
    : "";
  const missing = missingOf(brand, email, plan, domain);
  const deniedBlock = denied
    ? `\nEl cliente acaba de RECHAZAR el resumen. Pregúntale con amabilidad qué quiere cambiar (marca, servicios, dominio o correo). No repitas el resumen.`
    : "";

  return `Eres Brandi, Directora de Arte e Inteligencia Creativa en rebrandyourbrand. Idioma obligatorio de respuesta: ${langName}.

Tu objetivo es entender la marca del cliente, dar una breve pincelada estratégica y reunir los datos necesarios para cerrar la propuesta: MARCA, SERVICIOS${plan?.ids?.includes("web") ? ", DOMINIO" : ""} y CORREO.

ESTILO:
- No actúes como un bot de atención al cliente. Eres una consultora de marca directa, aguda y conceptual.
- Respuestas directas, concisas (máximo 3 frases), en minúsculas relajadas si encaja con el tono editorial (escribe todo en minúsculas, sin mayúsculas iniciales, como el resto de la web), sin tecnicismos innecesarios.
- Habla y escribe SIEMPRE en minúsculas (sin mayúsculas iniciales ni en nombres propios, excepto siglas técnicas indispensables como DNS o SSL), exactamente en sintonía con la estética y voz de marca del estudio.
- Haz UNA sola pregunta por mensaje.
- No uses puntos medios ni el símbolo ampersand en tus textos; usa conjunciones o guiones largos.

No hay planes cerrados: el cliente elige solo los servicios que necesita y paga únicamente por ellos (pago único del 100% mediante enlace seguro tras verificar el correo, sin cuotas mensuales). Servicios y precios oficiales:
${CATALOG}
El logotipo cuesta 400 € e incluye la paleta de empresa de regalo (valorada en 100 €). La paleta de empresa en solitario cuesta 100 €. La web cuesta 400 € de desarrollo (más 100 €/año de infraestructura técnica).
El precio total de creación es la suma de los servicios elegidos (con la paleta a 0 € si se contrata el logotipo: Logotipo + Paleta = 400 €, Logotipo + Paleta + Web = 800 €, Paleta + Web = 500 €). No hay otros descuentos.
Si el cliente elige o pregunta por la web (400 € de pago único de desarrollo), es estrictamente obligatorio conocer su dominio o URL actual (o qué dominio desea registrar) antes de cerrar la propuesta, y aclara si surge la duda que conlleva una cuota obligatoria de 100 €/año exclusivamente por infraestructura técnica gestionada (dominio, correo corporativo, DNS, certificados SSL y despliegue edge): no incluye cambios de contenido, diseño ni nuevas secciones tras la entrega (cada fase incluye 2 rondas de revisión gratuitas durante la creación; cualquier ronda de ajustes extra o cambio posterior tiene un precio cerrado de 100 €).
En los proyectos web, la página entregada incluye una firma discreta del estudio en el pie de página (footer) con enlace a rebrandyourbrand.es y el estudio puede mostrar el trabajo en su portfolio como referencia profesional.

ESTADO ACTUAL DE LA CONVERSACIÓN:
- MARCA: ${brand ? `ya conocida (${brand})` : "pendiente"}
- ${servicesBlock}
${domainBlock ? `- ${domainBlock}\n` : ""}- CORREO: ${email ? "ya recibido" : "pendiente"}
- Datos que aún faltan (por prioridad): ${missing.length ? missing.join(", ") : "ninguno"}.${deniedBlock}

CÓMO CONDUCIR LA CONVERSACIÓN:
1. Primero incorpora lo que el cliente acaba de decir en su último mensaje (marca, servicios, dominio, correo).
2. Después pregunta por el PRIMER dato que siga faltando, siguiendo el orden: marca -> servicios -> dominio (si incluye web) -> correo.
3. Si faltan los SERVICIOS: pregunta qué necesita resolver primero y orienta según su caso (por ejemplo, un logotipo que no se ve bien en pequeño, colores incoherentes, o ninguna web). Menciona los tres servicios y que puede combinarlos. No presiones ni des por hecho ninguno.
4. Si ya hay servicios elegidos, no vuelvas a preguntar por ellos salvo que el cliente quiera cambiarlos. Puedes sugerir en una frase un servicio complementario, una sola vez.
5. Si ha elegido web y falta el DOMINIO: pídelo de forma clara (cuál es su dominio o web actual, o cuál le gustaría registrar para el proyecto).
6. Si falta el CORREO: pídelo diciendo que es para enviarle la verificación y el acceso a su proyecto y pago seguro.
7. Cuando ya no falte nada NO escribas tú el resumen ni digas que has enviado ningún correo: el sistema mostrará el resumen automáticamente. Limítate a decir en una frase que ya lo tienes todo.
- Habla únicamente de los servicios de rebrandyourbrand. Nunca inventes precios ni porcentajes distintos de los oficiales.

FORMATO DE SALIDA (JSON estricto, sin texto fuera del JSON):
{
  "reply": "tu respuesta al cliente",
  "brand": "nombre de la marca del cliente, o null si aún no lo sabes",
  "domain": "dominio indicado por el cliente (ej. mitienda.es), o null",
  "services": ["logo", "paleta", "web"] (solo los elegidos) | null
}
- "services": lista de ids elegidos por el cliente (valores posibles: "logo", "paleta", "web")${plan ? ` (ahora mismo: ${JSON.stringify(plan.ids)}; devuélvelo tal cual salvo que el cliente pida cambiarlo explícitamente)` : "; null mientras no los haya elegido claramente"}.
- "brand": devuelve la marca ya conocida salvo que el cliente la cambie.
- "domain": devuelve el dominio web indicado si el proyecto incluye web.`;
}

function parseModelJson(content) {
  if (typeof content !== "string") throw new Error("empty_content");
  try {
    return JSON.parse(content);
  } catch {
    const a = content.indexOf("{");
    const b = content.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(content.slice(a, b + 1));
    throw new Error("bad_json");
  }
}

// Timeout por intento de 10s y retries = 1 (máx total ~20-25s)
async function askGroq(env, lang, ctx, chatMessages, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const groq = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.GROQ_API_KEY}` },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: "system", content: buildSystemInstruction(lang, ctx) },
            ...chatMessages.map((m) => ({ role: m.role, content: m.text })),
          ],
          max_tokens: 600,
          temperature: 0.4,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (groq.status === 429 || groq.status >= 500) {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        throw new HttpError(503, "upstream_busy", { "Retry-After": "10" });
      }
      if (!groq.ok) throw new HttpError(502, "upstream_error");

      const data = await groq.json().catch(() => null);
      const out = parseModelJson(data?.choices?.[0]?.message?.content);
      if (out && typeof out.reply === "string") {
        out.reply = out.reply
          .replace(/[\u00b7\u2022]/g, " — ")
          .replace(new RegExp("\\x26", "g"), lang === "ca" ? " i " : lang === "en" ? " and " : lang === "eu" ? " eta " : " y ")
          .replace(/(^|[.!?¿¡]\s*|\n\s*)([A-ZÁÉÍÓÚÀÈÒÇÑ])(?![A-ZÁÉÍÓÚÀÈÒÇÑ])/g, (_, p, c) => p + c.toLowerCase());
      }
      return out && typeof out === "object" && !Array.isArray(out) ? out : {};
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (attempt === retries) throw new HttpError(503, "upstream_busy", { "Retry-After": "10" });
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

function buildProjectSystemInstruction(lang, proj) {
  const l = pickLang(lang);
  const langName = LANG_NAMES[l] || LANG_NAMES.es;
  const servicesStr = svcLabel(proj.services, l);
  const phasesStr = (proj.phases || [])
    .map((ph) => {
      const st =
        ph.status === "done"
          ? "completado"
          : ph.status === "review"
          ? "en revisión por el cliente"
          : ph.status === "active"
          ? "en curso por el estudio"
          : "pendiente";
      return `- Fase ${ph.step} (${phaseTitle(ph, l)}): estado ${st}`;
    })
    .join("\n");

  const realMaterials = (proj.materialsList || []).filter((m) => m && (m.id !== "init" || m.url || m.fileId || m.fileUrl || m.notes || m.socials));
  const materialsCount = realMaterials.length;
  const refsCount = (proj.referencesList || []).length;

  return `Eres Brandi, Directora Creativa e Inteligencia Artística de rebrandyourbrand.
El cliente ya ha contratado su proyecto y se encuentra en su portal privado de seguimiento.
Idioma obligatorio de respuesta: ${langName}.

DATOS OFICIALES DEL PROYECTO:
- Marca: ${proj.brand}
- Servicios contratados: ${servicesStr}
- Fases y estado actual:
${phasesStr}
- Materiales aportados: ${materialsCount} registros aportados
- Referencias visuales: ${refsCount} referencias aportadas
- Condiciones B2B: cada fase incluye hasta 2 rondas de revisión gratuitas durante el diseño; revisiones extra o modificaciones posteriores cuestan 100 € cerrados por ronda. En proyectos con web, hay una cuota anual de 100 €/año exclusivamente de infraestructura técnica (dominio, correo, SSL, DNS y despliegue edge).
- La aprobación de cada fase es obligatoria por escrito por parte del cliente para avanzar; avanzamos a su ritmo.

TU MISIÓN:
- Resuelve cualquier duda del cliente sobre el estado de su proyecto, fases, plazos, entregables o condiciones con precisión, cercanía y profesionalidad.
- Respuestas directas, concisas (máximo 3 o 4 frases), en minúsculas relajadas (todo en minúsculas, sin mayúsculas iniciales), sin tecnicismos innecesarios.
- Si el proyecto ya está finalizado y el cliente desea retocar o solicitar mejoras en su web o logotipo, indícale amablemente que puede contratar rondas de trabajo extraordinario a 100 € cerrados por ronda directamente desde el apartado de trabajo extraordinario en este mismo portal.
- NUNCA uses puntos medios ni el carácter ampersand en tus textos. Usa conjunciones o guiones largos.
- Si el cliente solicita cambios complejos, negociaciones, aprobaciones directas de fase o pide expresamente hablar con personas, indícale amablemente que use la pestaña del equipo humano o pulse el botón de "hablar con el equipo humano" para contactar directamente con Gael y Bernat.`;
}

async function askGroqProject(env, lang, proj, chatMessages, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const groq = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.GROQ_API_KEY}` },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: "system", content: buildProjectSystemInstruction(lang, proj) },
            ...chatMessages.map((m) => ({ role: m.role, content: m.text })),
          ],
          max_tokens: 450,
          temperature: 0.4,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!groq.ok) throw new Error(`Groq HTTP ${groq.status}`);
      const data = await groq.json().catch(() => null);
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error("empty_reply");

      const clean = text
        .replace(/[\u00b7\u2022]/g, " — ")
        .replace(new RegExp("\\x26", "g"), lang === "ca" ? " i " : lang === "en" ? " and " : lang === "eu" ? " eta " : " y ")
        .replace(/(^|[.!?¿¡]\s*|\n\s*)([A-ZÁÉÍÓÚÀÈÒÇÑ])(?![A-ZÁÉÍÓÚÀÈÒÇÑ])/g, (_, p, c) => p + c.toLowerCase());
      return clean;
    } catch (e) {
      if (attempt === retries) {
        console.error("askGroqProject failed:", e?.message);
        const l = pickLang(lang);
        return l === "ca"
          ? "no he pogut processar la consulta ara mateix. pots escriure directament a en gael i en bernat a la pestanya de l'equip."
          : l === "en"
          ? "i could not process your query right now. you can write directly to gael and bernat in the team tab."
          : l === "eu"
          ? "ezin izan dut kontsulta prozesatu oraintxe bertan. gael eta bernati idatzi diezaiekezu zuzenean lan-taldearen fitxan."
          : "no he podido procesar la consulta ahora mismo. puedes escribir directamente a gael y bernat en la pestaña del equipo.";
      }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

const LANG_FULL_NAMES = {
  es: "Spanish",
  ca: "Catalan",
  en: "English",
  eu: "Basque",
};

async function translateMessageText(env, text, fromLang, toLang) {
  if (!text || typeof text !== "string") return "";
  const raw = text.trim();
  if (!raw) return "";
  const src = pickLang(fromLang);
  const tgt = pickLang(toLang);
  if (src === tgt) return raw;
  if (!env || !env.GROQ_API_KEY) return raw;

  const targetName = LANG_FULL_NAMES[tgt] || "Spanish";
  const sourceName = LANG_FULL_NAMES[src] || "Spanish";

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a professional studio translator for rebrandyourbrand. Translate the input message accurately from ${sourceName} into natural, human ${targetName}. Maintain the exact meaning and friendly tone. Keep everything in lowercase. Return ONLY strict JSON in the format: {"translated": "your translation here"}. Do not include any explanations, notes, or additional fields.`,
          },
          {
            role: "user",
            content: raw.slice(0, 2500),
          },
        ],
        max_tokens: 450,
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(4500),
    });

    if (!res.ok) {
      console.warn(`Groq translate HTTP ${res.status}`);
      return raw;
    }

    const data = await res.json().catch(() => null);
    const parsed = parseModelJson(data?.choices?.[0]?.message?.content);
    let translated = typeof parsed?.translated === "string" ? parsed.translated.trim() : "";
    if (!translated) return raw;

    translated = translated
      .replace(/[\u00b7\u2022]/g, " — ")
      .replace(new RegExp("\\x26", "g"), tgt === "ca" ? " i " : tgt === "en" ? " and " : tgt === "eu" ? " eta " : " y ")
      .replace(/(^|[.!?¿¡]\s*|\n\s*)([A-ZÁÉÍÓÚÀÈÒÇÑ])(?![A-ZÁÉÍÓÚÀÈÒÇÑ])/g, (_, p, c) => p + c.toLowerCase());

    return translated || raw;
  } catch (err) {
    console.warn("translateMessageText error:", err?.message);
    return raw;
  }
}

// ══ payments.js — Pagos (Stripe B2B): fases del proyecto, checkout, rescate, webhook y confirmación. ══

// Fases secuenciales: una de identidad (si hay logotipo o paleta), una de web (si hay web) y la entrega final.
const newPhases = (ids) => {
  const keys = [];
  if (ids.includes("logo") && ids.includes("paleta")) keys.push("identity");
  else if (ids.includes("logo")) keys.push("logo");
  else if (ids.includes("paleta")) keys.push("palette");
  if (ids.includes("web")) keys.push("web");
  keys.push("delivery");
  return keys.map((key, i) => ({
    step: i + 1,
    key,
    status: i === 0 ? "active" : "pending",
    revisionsUsed: 0,
    revisions: [],
    ...(i === 0 ? { date: new Date().toISOString() } : {}),
  }));
};

const isStripeUrl = (u) => typeof u === "string" && u.startsWith("https://checkout.stripe.com/");

const isStripeReceiptUrl = (u) =>
  typeof u === "string" &&
  (u.startsWith("https://pay.stripe.com/") || u.startsWith("https://invoice.stripe.com/"));

const stripeLocaleFor = (lang) => (pickLang(lang) === "en" ? "en" : "es");

async function saveProject(env, token, proj, extraOpts = {}) {
  if (!env?.LEADS_KV || !token || !proj) return;
  const hasWeb = Boolean(
    (proj.includesWeb || (Array.isArray(proj.services) && proj.services.includes("web"))) &&
    !proj.renewalCanceled &&
    !proj.renewalCancelled
  );
  const nextDueRaw = proj.renewalNextDue || proj.nextRenewalAt || 0;
  const nextDueMs = typeof nextDueRaw === "string" ? new Date(nextDueRaw).getTime() : Number(nextDueRaw);

  const finalOpts = { ...extraOpts };
  if (!proj.paid && finalOpts.expirationTtl === undefined) {
    finalOpts.expirationTtl = 7 * 24 * 60 * 60;
  } else if (proj.paid) {
    delete finalOpts.expirationTtl;
  }

  await env.LEADS_KV.put(`project:${token}`, JSON.stringify(proj), {
    metadata: {
      status: proj.status || "active",
      hasWeb,
      renewalNextDue: Number.isNaN(nextDueMs) ? 0 : nextDueMs,
    },
    ...finalOpts,
  });
}

async function createProjectRecord(env, { clientEmail, brand, plan, lang, messages, domain }) {
  const safeBrand = brand || "proyecto";
  const projectToken = randomHex(32);
  const projectKey = `project:${projectToken}`;
  const cleanMsgs = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, text: m.text.slice(0, 2000) }));

  const nowIso = new Date().toISOString();
  const cleanDomain = typeof domain === "string" ? domain.trim().slice(0, 200) : "";

  const projectData = {
    token: projectToken,
    brand: safeBrand,
    clientEmail,
    domain: cleanDomain,
    lang: pickLang(lang),
    status: "active",
    services: plan.ids,
    totalEur: plan.total,
    messages: cleanMsgs,
    paid: false,
    emailsSent: false,
    currentPhase: 1,
    createdAt: nowIso,
    phases: newPhases(plan.ids),
    materialsList: [],
    referencesList: [],
  };
  await saveProject(env, projectToken, projectData, {
    expirationTtl: PENDING_PROJECT_TTL_SECONDS,
  });
  return projectData;
}

async function fetchStripeSession(env, sessionId) {
  if (!env.STRIPE_SECRET_KEY || typeof sessionId !== "string" || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return null;
  }
  const expandUrl = new URL(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`);
  expandUrl.searchParams.append("expand[]", "payment_intent.latest_charge");
  expandUrl.searchParams.append("expand[]", "invoice");
  try {
    const res = await fetch(expandUrl.toString(), {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error("fetchStripeSession failed:", e?.message);
    return null;
  }
}

function extractReceiptFromSession(session) {
  if (!session || typeof session !== "object") return "";
  const invUrl = typeof session.invoice === "object" ? session.invoice?.hosted_invoice_url : "";
  const chgUrl =
    typeof session.payment_intent === "object"
      ? session.payment_intent?.latest_charge?.receipt_url
      : "";
  const candidate = invUrl || chgUrl || "";
  return isStripeReceiptUrl(candidate) ? candidate : "";
}

function extractBillingFromSession(session) {
  const cd = session?.customer_details;
  if (!cd || typeof cd !== "object") return null;
  const name = cleanInput(cd.business_name || cd.name || "", 120);
  const taxIds = Array.isArray(cd.tax_ids)
    ? cd.tax_ids
        .map((t) => cleanInput(`${t?.type ? `${t.type.toUpperCase()} ` : ""}${t?.value || ""}`, 60))
        .filter(Boolean)
        .join(", ")
    : "";
  const a = cd.address || {};
  const address = [a.line1, a.line2, a.postal_code, a.city, a.state, a.country]
    .map((x) => cleanInput(x || "", 80))
    .filter(Boolean)
    .join(", ");
  if (!name && !taxIds && !address) return null;
  return { name, taxIds, address };
}

// Reutiliza la sesión activa de Stripe o genera una nueva si caducó (>24h) o no existe aún
async function ensureStripeCheckout(env, proj) {
  if (!env.STRIPE_SECRET_KEY || !proj || !Array.isArray(proj.services) || !proj.services.length) {
    return null;
  }

  if (proj.stripeSessionId) {
    const existing = await fetchStripeSession(env, proj.stripeSessionId);
    if (existing) {
      if (existing.payment_status === "paid") {
        await processPaidSession(env, existing).catch((e) =>
          console.error("processPaidSession on ensure failed:", e?.message)
        );
        return { paid: true, url: buildUrl("/proyecto", { token: proj.token }) };
      }
      const expiresMs = Number(existing.expires_at || 0) * 1000;
      if (existing.status === "open" && isStripeUrl(existing.url) && expiresMs > Date.now() + 5 * 60 * 1000) {
        return { paid: false, url: existing.url };
      }
    }
  }

  const l = pickLang(proj.lang);
  const safeBrand = proj.brand || "proyecto";
  const projectUrl = buildUrl("/proyecto", { token: proj.token });
  const qJoin = String.fromCharCode(38);
  const successUrl = `${projectUrl}${qJoin}session_id={CHECKOUT_SESSION_ID}`;

  const params = new URLSearchParams({
    "payment_method_types[0]": "card",
    mode: "payment",
    locale: stripeLocaleFor(l),
    customer_email: proj.clientEmail,
    client_reference_id: proj.token,
    billing_address_collection: "required",
    "tax_id_collection[enabled]": "true",
    "invoice_creation[enabled]": "true",
    customer_creation: "always",
    success_url: successUrl,
    cancel_url: projectUrl,
    "metadata[kind]": "project",
    "metadata[project_token]": proj.token,
    "metadata[services]": proj.services.join(","),
    "metadata[brand]": safeBrand,
    "custom_text[submit][message]": (l === "en" ? "have any questions? write to us at hola@rebrandyourbrand.es." : l === "ca" ? "tens alguna pregunta? escriu-nos a hola@rebrandyourbrand.es." : l === "eu" ? "galderarik baduzu? idatzi iezaguzu hola@rebrandyourbrand.es helbidera." : "¿tienes alguna pregunta? escríbenos a hola@rebrandyourbrand.es."),
  });

  const hasLogo = proj.services.includes("logo");
  let itemIdx = 0;
  proj.services.forEach((id) => {
    if (!SERVICES[id]) return;
    if (id === "paleta" && hasLogo) {
      // La paleta va incluida de regalo en el logotipo (0 €). Stripe en mode=payment no admite line_items con importe 0.
      return;
    }
    const name = SERVICES[id].names[l] || SERVICES[id].names.es;
    const displayName = (id === "logo" && hasLogo)
      ? (l === "en" ? `${name} (includes company palette) — ${safeBrand}`
        : l === "ca" ? `${name} (inclou paleta d'empresa) — ${safeBrand}`
        : l === "eu" ? `${name} (enpresaren paleta barne) — ${safeBrand}`
        : `${name} (incluye paleta de empresa) — ${safeBrand}`)
      : `${name.charAt(0).toUpperCase()}${name.slice(1)} — ${safeBrand}`;

    params.set(`line_items[${itemIdx}][price_data][currency]`, "eur");
    params.set(
      `line_items[${itemIdx}][price_data][product_data][name]`,
      displayName.slice(0, 250)
    );
    params.set(`line_items[${itemIdx}][price_data][unit_amount]`, String(SERVICES[id].price * 100));
    params.set(`line_items[${itemIdx}][quantity]`, "1");
    itemIdx++;
  });

  try {
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Stripe ${res.status}: ${await res.text()}`);
    const session = await res.json();
    if (!isStripeUrl(session.url)) throw new Error(`bad_checkout_url: ${String(session.url).slice(0, 80)}`);

    proj.stripeSessionId = session.id;
    proj.checkoutUrl = session.url;
    await saveProject(env, proj.token, proj, {
      expirationTtl: PENDING_PROJECT_TTL_SECONDS,
    });
    return { paid: false, url: session.url };
  } catch (e) {
    console.error("Stripe Checkout Error:", e?.message);
    await alertAdmin(
      env,
      "fallo al crear sesión de stripe checkout",
      `cliente: ${proj.clientEmail}\nmarca: ${safeBrand}\nservicios: ${proj.services.join(" + ")}\nerror: ${String(e?.message).slice(0, 500)}`
    );
    return null;
  }
}

async function createRenewalCheckout(env, proj, renewalEur) {
  if (!env.STRIPE_SECRET_KEY || !proj || !(renewalEur > 0)) return "";
  const l = pickLang(proj.lang);
  const safeBrand = proj.brand || "proyecto";
  const projectUrl = buildUrl("/proyecto", { token: proj.token });
  const labelByLang = {
    es: "Renovación anual de infraestructura web (dominio, correo, DNS y edge)",
    ca: "Renovació anual d'infraestructura web (domini, correu, DNS i edge)",
    eu: "Web-azpiegituraren urteko berritzea (domeinua, posta, DNS eta edge)",
    en: "Annual web infrastructure renewal (domain, email, DNS and edge)",
  };
  const params = new URLSearchParams({
    "payment_method_types[0]": "card",
    mode: "payment",
    locale: stripeLocaleFor(l),
    customer_email: proj.clientEmail,
    client_reference_id: proj.token,
    billing_address_collection: "required",
    "tax_id_collection[enabled]": "true",
    "invoice_creation[enabled]": "true",
    customer_creation: "always",
    success_url: projectUrl,
    cancel_url: projectUrl,
    "metadata[kind]": "web_renewal",
    "metadata[project_token]": proj.token,
    "metadata[due]": proj.nextRenewalAt || "",
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][product_data][name]": `${labelByLang[l]} — ${safeBrand}`.slice(0, 250),
    "line_items[0][price_data][unit_amount]": String(Math.round(renewalEur * 100)),
    "line_items[0][quantity]": "1",
  });
  try {
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return "";
    const session = await res.json();
    return isStripeUrl(session.url) ? session.url : "";
  } catch {
    return "";
  }
}

async function createExtraRevisionCheckout(env, proj, step, returnUrl, cancelUrl, notes = "") {
  if (!env.STRIPE_SECRET_KEY || !proj) return "";
  const l = pickLang(proj.lang);
  const safeBrand = proj.brand || "proyecto";
  const isPostDelivery = String(step) === "post_delivery";
  const ph = isPostDelivery ? null : ((proj.phases || []).find((p) => Number(p.step) === Number(step)) || { step });
  const phaseName = ph ? (phaseTitle(ph, l) || `fase ${step}`) : "";

  const titleByLang = isPostDelivery
    ? {
        es: "Ronda de cambios extraordinarios post-entrega",
        ca: "Ronda de canvis extraordinaris post-lliurament",
        eu: "Entregaren ondorengo ezohiko aldaketa-txanda",
        en: "Post-delivery extraordinary revision round",
      }
    : {
        es: `Ronda de ajustes adicional — ${phaseName}`,
        ca: `Ronda d'ajustos addicional — ${phaseName}`,
        eu: `Doikuntza-txanda gehigarria — ${phaseName}`,
        en: `Additional revision round — ${phaseName}`,
      };

  const helpMsgByLang = {
    es: "¿tienes alguna pregunta? escríbenos a hola@rebrandyourbrand.es.",
    ca: "tens alguna pregunta? escriu-nos a hola@rebrandyourbrand.es.",
    eu: "galderarik baduzu? idatzi iezaguzu hola@rebrandyourbrand.es helbidera.",
    en: "have any questions? write to us at hola@rebrandyourbrand.es.",
  };

  const params = new URLSearchParams({
    "payment_method_types[0]": "card",
    mode: "payment",
    locale: stripeLocaleFor(l),
    customer_email: proj.clientEmail,
    client_reference_id: proj.token,
    billing_address_collection: "required",
    "tax_id_collection[enabled]": "true",
    "invoice_creation[enabled]": "true",
    customer_creation: "always",
    success_url: returnUrl,
    cancel_url: cancelUrl,
    "metadata[type]": "extra_revision",
    "metadata[projectToken]": proj.token,
    "metadata[step]": String(step),
    "metadata[brand]": safeBrand,
    ...(isPostDelivery ? { "metadata[isPostDelivery]": "true", "metadata[notes]": String(notes).slice(0, 400) } : {}),
    "custom_text[submit][message]": helpMsgByLang[l],
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][product_data][name]": `${titleByLang[l]} — ${safeBrand}`.slice(0, 250),
    "line_items[0][price_data][unit_amount]": String(EXTRA_REVISION_EUR * 100),
    "line_items[0][quantity]": "1",
  });

  try {
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Stripe ${res.status}: ${await res.text()}`);
    const session = await res.json();
    return isStripeUrl(session.url) ? session.url : "";
  } catch (e) {
    console.error("createExtraRevisionCheckout failed:", e?.message);
    return "";
  }
}

async function unlockExtraRevision(env, proj, step, sessionId, sessionData = null) {
  if (!proj || !sessionId) return false;

  const usedSessions = Array.isArray(proj.usedRevisionSessions) ? proj.usedRevisionSessions : [];
  if (usedSessions.includes(sessionId)) {
    return true;
  }

  let session = sessionData;
  if (!session) {
    session = await fetchStripeSession(env, sessionId);
  }
  if (!session || session.payment_status !== "paid") {
    return false;
  }
  if (session.metadata?.type !== "extra_revision") {
    return false;
  }
  if (session.metadata?.projectToken !== proj.token) {
    return false;
  }

  const isPostDelivery =
    String(step) === "post_delivery" ||
    session.metadata?.step === "post_delivery" ||
    session.metadata?.isPostDelivery === "true";

  if (isPostDelivery) {
    proj.usedRevisionSessions = [...usedSessions, sessionId];
    const notes = session.metadata?.notes || proj.pendingExtraWork?.notes || "";
    proj.extraWork = Array.isArray(proj.extraWork) ? proj.extraWork : [];
    if (!proj.extraWork.some((w) => w.sessionId === sessionId)) {
      proj.extraWork.push({
        id: randomHex(4),
        sessionId,
        date: Date.now(),
        notes,
        status: "received",
      });
      delete proj.pendingExtraWork;

      const chatKey = `project_chat:${proj.token}`;
      const history = (await env.LEADS_KV.get(chatKey, { type: "json" })) || [];
      history.push({
        sender: "client",
        date: Date.now(),
        text: `[solicitud de cambios extraordinarios abonada — 100 €]\n${notes}`,
      });
      await env.LEADS_KV.put(chatKey, JSON.stringify(history.slice(-50)));
    }

    await saveProject(env, proj.token, proj);

    if (env.RESEND_API_KEY) {
      const trackingUrl = buildUrl("/proyecto", { token: proj.token });
      await resendSend(
        env,
        {
          to: ["hola@rebrandyourbrand.es"],
          reply_to: proj.clientEmail,
          subject: `trabajo extraordinario abonado (100 €) — ${proj.brand}`,
          ...renderEmail("es", {
            paras: [
              `el cliente de ${bold(proj.brand)} ha contratado y abonado una ronda de cambios extraordinarios post-entrega (100 €).`,
              lines(
                `— cliente: ${bold(proj.clientEmail)}`,
                `— fecha: ${bold(fmtDate(Date.now(), "es"))}`,
                `— id sesión stripe: ${bold(sessionId)}`
              ),
              bold("indicaciones del cliente:"),
            ],
            quote: notes,
            cta: { label: "ver seguimiento del cliente", url: trackingUrl },
          }),
        },
        `extra-post-${proj.token}-${sessionId}`
      ).catch((e) => console.error("extra post-delivery alert email failed:", e?.message));
    }

    return true;
  }

  const ph = (proj.phases || []).find((p) => Number(p.step) === Number(step));
  if (!ph) return false;
  if (String(session.metadata?.step) !== String(step)) {
    return false;
  }

  const baseMax = ph.maxRevisions || MAX_PHASE_REVISIONS;
  ph.maxRevisions = baseMax + 1;
  const paidSessions = Array.isArray(ph.paidRevisionSessions) ? ph.paidRevisionSessions : [];
  if (!paidSessions.includes(sessionId)) {
    ph.paidRevisionSessions = [...paidSessions, sessionId];
  }
  proj.usedRevisionSessions = [...usedSessions, sessionId];

  // Asegurar coherencia de estados: no bloquear ni desincronizar la fase ni el proyecto
  if (proj.status !== "done") {
    proj.status = "in_progress";
  }
  if (ph.status !== "done" && ph.deliverableUrl) {
    ph.status = "review";
  }

  await saveProject(env, proj.token, proj);

  if (env.RESEND_API_KEY) {
    const manageUrl = await advancePhaseUrl(env, proj.token, ph.step);
    const trackingUrl = buildUrl("/proyecto", { token: proj.token });
    const phaseName = phaseTitle(ph, "es");
    await resendSend(
      env,
      {
        to: ["hola@rebrandyourbrand.es"],
        reply_to: proj.clientEmail,
        subject: `ronda extra abonada (100 €) — fase ${ph.step} — ${proj.brand}`,
        ...renderEmail("es", {
          paras: [
            `el cliente ha abonado 100 € por una ronda de ajustes adicional en ${bold(proj.brand)}.`,
            lines(
              `— cliente: ${bold(proj.clientEmail)}`,
              `— fase: ${bold(`paso ${ph.step} — ${phaseName}`)}`,
              `— límite ampliado: ${bold(`${ph.maxRevisions} rondas en total`)}`,
              `— id sesión stripe: ${bold(sessionId)}`
            ),
          ],
          cta: { label: "abrir gestión de la fase actual", url: manageUrl },
          secondaryLink: { label: "ver seguimiento del cliente", url: trackingUrl },
        }),
      },
      `extra-rev-${proj.token}-${ph.step}-${sessionId}`
    ).catch((e) => console.error("extra revision alert email failed:", e?.message));
  }

  return true;
}

async function verifyStripeSignature(env, rawBody, header) {
  if (!env.STRIPE_WEBHOOK_SECRET || typeof header !== "string" || header.length > 1024) return false;
  let t = null;
  const sigs = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") sigs.push(v);
  }
  if (!t || !/^\d{1,12}$/.test(t) || !sigs.length || sigs.length > 5) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > STRIPE_TOLERANCE_SECONDS) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(env.STRIPE_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const payload = enc.encode(`${t}.${rawBody}`);
  let ok = false;
  for (const s of sigs) {
    if (!/^[0-9a-f]{64}$/.test(s)) continue;
    if (await crypto.subtle.verify("HMAC", key, fromHex(s), payload)) ok = true;
  }
  return ok;
}

function addOneYearIso(iso) {
  const d = new Date(iso || Date.now());
  if (Number.isNaN(d.getTime())) return new Date(Date.now() + 365 * DAY_MS).toISOString();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString();
}

async function processPaidSession(env, session, { fromWebhook = false } = {}, ctx = null) {
  if (!session || session.mode !== "payment" || session.payment_status !== "paid") return;

  const token = session.metadata?.project_token || session.client_reference_id;
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
    await alertAdmin(
      env,
      "pago sin project_token",
      `sesión ${session.id} pagada sin token de proyecto válido. revisar en stripe.`
    );
    return;
  }

  const key = `project:${token}`;
  const raw = await env.LEADS_KV.get(key);
  if (!raw) {
    if (fromWebhook) {
      const ageSec = session.created ? Math.max(0, Date.now() / 1000 - Number(session.created)) : 0;
      if (ageSec > 3600) {
        await alertAdmin(
          env,
          "pago sin proyecto en kv tras reintentos",
          `sesión ${session.id} pagada pero el proyecto ${token.slice(0, 8)}... sigue sin aparecer en kv.`
        );
      }
      throw new HttpError(500, "project_not_found_in_kv");
    }
    return;
  }

  const proj = JSON.parse(raw);

  // Caso especial: renovación anual de infraestructura web (cláusula 3.1)
  if (session.metadata?.kind === "web_renewal") {
    if (proj.lastRenewalSessionId === session.id) return;
    proj.lastRenewalSessionId = session.id;
    proj.lastRenewalPaidAt = new Date().toISOString();
    const nextIso = addOneYearIso(proj.nextRenewalAt || proj.finishedAt);
    proj.nextRenewalAt = nextIso;
    proj.renewalPaid = true;
    proj.renewalNextDue = new Date(nextIso).getTime();
    proj.renewalCanceled = false;
    proj.renewalRemindedFor = "";
    proj.renewalOverdueAlertSentAt = null;
    proj.renewalReminderSentAt = null;
    delete proj.renewalCheckoutUrl;
    delete proj.renewalCheckoutCreatedAt;
    await saveProject(env, token, proj);
    await alertAdmin(
      env,
      `renovación anual abonada — ${proj.brand}`,
      `cliente: ${proj.clientEmail}\nmarca: ${proj.brand}\nimporte: ${(Number(session.amount_total || 0) / 100).toFixed(2)} eur\npróximo vencimiento: ${fmtDate(proj.nextRenewalAt, "es")}`
    );
    return;
  }

  // Caso especial: ronda de ajustes adicional (cláusula 1.2)
  if (session.metadata?.type === "extra_revision") {
    const step = parseInt(session.metadata?.step || "1", 10);
    await unlockExtraRevision(env, proj, step, session.id, session);
    return;
  }

  if (session.currency !== "eur" || Number(session.amount_total) !== Math.round(proj.totalEur * 100)) {
    await alertAdmin(
      env,
      "importe de pago no coincide",
      `sesión ${session.id}: cobrado ${session.amount_total} ${session.currency}, esperado ${Math.round(proj.totalEur * 100)} eur (céntimos).`
    );
    return;
  }

  let dirty = false;

  if (!proj.paid) {
    proj.paid = true;
    proj.paidAt = new Date().toISOString();
    proj.stripeSessionId = session.id;
    dirty = true;
  }

  let receiptUrl = extractReceiptFromSession(session);
  let billing = extractBillingFromSession(session);
  if ((!receiptUrl || !billing) && env.STRIPE_SECRET_KEY && session.id) {
    const expanded = await fetchStripeSession(env, session.id);
    if (expanded) {
      receiptUrl = receiptUrl || extractReceiptFromSession(expanded);
      billing = billing || extractBillingFromSession(expanded);
    }
  }
  if (receiptUrl && proj.receiptUrl !== receiptUrl) {
    proj.receiptUrl = receiptUrl;
    dirty = true;
  }
  if (billing && !proj.billing) {
    proj.billing = billing;
    dirty = true;
  }

  if (proj.emailsSent) {
    if (dirty) await saveProject(env, token, proj);
    return;
  }

  const lang = pickLang(proj.lang);
  const trackingUrl = buildUrl("/proyecto", { token });
  const currentActive = proj.phases.find((p) => p.status === "active" || p.status === "review") || proj.phases[0];
  const advanceUrl = await advancePhaseUrl(env, token, currentActive.step);
  const transcript = formatTranscript(proj.messages);

  try {
    if (!proj.clientNotified) {
      const t = EM[lang].paid;
      await resendSend(
        env,
        {
          to: [proj.clientEmail],
          subject: t.subject(proj.brand),
          ...renderEmail(lang, {
            paras: [
              t.hello,
              t.intro(bold(proj.brand)),
              lines(
                t.summary,
                `— ${t.plan}: ${bold(svcLabel(proj.services, lang))}`,
                `— ${t.amount}: ${bold(eur(proj.totalEur, lang))}`,
                `— ${t.status}: ${bold(`${t.phase} ${currentActive.step} — ${phaseTitle(currentActive, lang)}`)}`
              ),
              t.onboarding,
            ],
            cta: { label: t.cta, url: trackingUrl },
            note: t.note,
          }),
        },
        `paid-client-${session.id}`
      );
      proj.clientNotified = true;
      dirty = true;

      if (Array.isArray(proj.services) && proj.services.includes("web") && !proj.infraEmailSent) {
        const inf = EM[lang].infra;
        if (inf) {
          await resendSend(
            env,
            {
              to: [proj.clientEmail],
              subject: inf.subject(proj.brand),
              ...renderEmail(lang, {
                paras: [
                  inf.hello,
                  inf.intro(proj.brand),
                  lines(
                    inf.coveredTitle,
                    inf.itemDomain,
                    inf.itemEmail,
                    inf.itemSsl,
                    inf.itemEdge
                  ),
                  inf.scopeNote,
                  inf.cancelNote,
                ],
                cta: { label: inf.cta, url: trackingUrl },
                note: inf.note,
              }),
            },
            `infra-client-${token}`
          ).catch((e) => console.error("infra email failed:", e?.message));
          proj.infraEmailSent = true;
          dirty = true;
        }
      }
    }

    if (!proj.adminNotified) {
      const b = proj.billing;
      await resendSend(
        env,
        {
          to: ["hola@rebrandyourbrand.es"],
          reply_to: proj.clientEmail,
          subject: `nuevo pago recibido: ${proj.totalEur} € — ${proj.brand}`,
          ...renderEmail("es", {
            paras: [
              "nuevo pago recibido y confirmado en stripe.",
              lines(
                `— cliente: ${bold(proj.clientEmail)}`,
                `— marca: ${bold(proj.brand)}`,
                `— servicios: ${bold(svcLabel(proj.services, "es"))}`,
                `— importe: ${bold(`${proj.totalEur} €`)}`,
                `— idioma del pedido: ${bold(lang)}`,
                b?.name && `— razón social o nombre fiscal: ${bold(b.name)}`,
                b?.taxIds && `— nif / cif: ${bold(b.taxIds)}`,
                b?.address && `— dirección fiscal: ${bold(b.address)}`,
                `— fase activa: ${bold(`paso ${currentActive.step} — ${phaseTitle(currentActive, "es")}`)}`
              ),
              transcript ? "conversación previa con brandi:" : "",
            ].filter(Boolean),
            quote: transcript,
            cta: { label: "gestionar o avanzar fase actual", url: advanceUrl },
            secondaryLink: { label: "abrir seguimiento público del cliente", url: trackingUrl },
            note: "desde el botón principal puedes enviar propuestas con enlace a revisión del cliente o completar la fase directamente.",
          }),
        },
        `paid-admin-${session.id}`
      );
      proj.adminNotified = true;
      dirty = true;
    }

    proj.emailsSent = Boolean(proj.clientNotified && proj.adminNotified);
    dirty = true;
  } finally {
    // Una única escritura consolidada en KV sin expirationTtl (el proyecto pagado queda permanente)
    if (dirty) await saveProject(env, token, proj);
  }
}

// Devuelve 500 en error de webhook (incluida consistencia eventual de KV) para que Stripe reintente
async function handleStripeWebhook(request, env, ctx = null) {
  const missingEnv = ["LEADS_KV", "RESEND_API_KEY", "STRIPE_WEBHOOK_SECRET"].filter((k) => !env[k]);
  if (missingEnv.length) {
    console.error("stripe webhook misconfigured, falta en el Worker:", missingEnv.join(", "));
    return jsonResponse({ error: "misconfigured", missing: missingEnv }, 500, null);
  }

  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_WEBHOOK_BYTES) return jsonResponse({ error: "payload_too_large" }, 413, null);
  const rawBody = await request.text();
  if (enc.encode(rawBody).byteLength > MAX_WEBHOOK_BYTES) {
    return jsonResponse({ error: "payload_too_large" }, 413, null);
  }

  if (!(await verifyStripeSignature(env, rawBody, request.headers.get("Stripe-Signature")))) {
    return jsonResponse({ error: "invalid_signature" }, 400, null);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400, null);
  }
  if (!event || typeof event.id !== "string" || !/^evt_[A-Za-z0-9_]+$/.test(event.id)) {
    return jsonResponse({ error: "invalid_event" }, 400, null);
  }

  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
    return jsonResponse({ received: true }, 200, null);
  }

  const eventKey = `stripe_event:${event.id}`;
  if (await env.LEADS_KV.get(eventKey)) {
    return jsonResponse({ received: true, duplicate: true }, 200, null);
  }

  try {
    await processPaidSession(env, event.data?.object, { fromWebhook: true }, ctx);
    await env.LEADS_KV.put(eventKey, "1", { expirationTtl: STRIPE_EVENT_TTL_SECONDS });
  } catch (e) {
    console.error("stripe webhook processing failed:", e?.message);
    return jsonResponse({ error: "processing_failed" }, 500, null);
  }
  return jsonResponse({ received: true }, 200, null);
}

// ══ pages.js — Identidad visual y plantillas HTML editoriales de api.rebrandyourbrand.es. ══

const RYBB_LOGO_PATH =
  "M258.2 2.5L262.5 2.1L288 2.5L288.5 70.5L293.9 64.4L298.9 60.4L305.2 57.7L313.5 56.4L322.2 57.4L327.4 59.1L333.5 63L339 69.5L341.5 74L344 80.5L346.7 91.7L347.6 97.7L348.7 126.5L348.8 168.5L347.9 195.5L346.7 206.3L344.5 215L341.5 222L338.1 227.6L334.3 231.9L329.7 235.2L323.4 237.9L316.5 238.9L306.9 238.5L301.4 237.1L295.7 233.8L290.6 228.9L286.5 222.9L283.5 236.8L258.1 236.5ZM696 2.5L696.5 2.1L722.7 2.5L723 236.5L715.5 236.9L699 236.5L698.2 234.4L697.4 226.2L696.5 224.1L692.8 229.3L687.8 234.3L682.7 237.2L677.3 238.7L668.5 239L662.6 237.9L656.7 234.8L652.4 231.2L648.9 226.6L646.3 221.2L642.3 207.3L640.3 180.5L640.1 164.5L640.2 118.5L641.3 99.5L642.3 90.6L644.3 81.7L645.6 77.1L648.7 70.2L653 64.4L658.5 60L664.1 57.6L671.6 56.4L679.2 57.4L684.2 59.3L690 63.5L695.5 69.9L695.9 68.5ZM234.2 88.5L140.5 88.8L138.5 88.9L137.9 89.5L139.3 99.2L141.7 105.8L144.6 110.9L151.2 117.3L160.1 121.4L167.6 122.7L172.5 122.8L180.4 121.9L184.3 120.8L189.7 118.2L193.1 115.6L196.4 111.9L199.5 106.3L233.5 110.5L233.7 112.3L230.7 120.2L227.5 126L222.2 132.7L212.8 141.3L207.8 144.3L201.6 147.1L189.4 150.8L182.5 151.9L170.5 152.7L159.5 151.9L152.7 150.7L140.4 147.1L129.8 141.7L121.5 135L116.6 129.9L113.1 125.4L107.3 115.2L103.5 105L101.2 95.4L100.5 89.1L100.1 73.5L101.4 60.8L103.8 51.4L106.7 44.2L113.2 32.7L121.2 23.7L127.2 18.7L132.1 15.6L139.5 11.9L146.1 9.6L156.6 7.2L169.5 6.3L185.2 8.4L196.5 12L207.5 18L211.4 21L217 26.4L224.3 36.2L227.8 42.7L230.4 49.2L233.5 62L234.8 77.5ZM88.5 8.8L89.2 9.5L88.8 18.5L87.7 34.5L86.5 43L79.4 41.2L73.5 40.8L66.6 41.2L61.1 42.6L57 44.5L51.8 48.3L48.5 52L45.6 57.1L43.2 65.6L42.7 73.5L42.5 149.5L41.5 150.1L21.5 150.1L4.5 150.1L3.5 149.5L3.5 9.4L4.5 8.9L36.5 8.9L39.5 8.9L40.2 9.5L40.2 29.5L40.7 32.5L41.5 33L45.5 24L49.1 18.6L54.2 13.7L60.3 9.9L67.8 7.4L74.5 6.7L82.4 7.2ZM138.5 63.9L193.5 64.2L197.8 63.5L195.5 53L192.8 47.7L189.1 43.4L185.3 40.2L180 37.5L174.5 36L168.5 35.4L161.6 36.2L156.2 37.7L151.7 40.1L147.8 43.3L144.5 47.1L141.5 52L139.1 58.6ZM520.8 236.5L497.5 236.9L494.8 236.5L492.5 224.4L486.7 231.2L483.5 234L479.2 236.7L475.5 238L469.5 239L461.6 238.7L456.2 237.3L450.3 234.2L447.1 231.4L444 227.6L441.3 223.2L438.4 216.1L435.4 201.2L434.4 182.5L435.1 165.5L436.3 157.7L439 148.5L441.7 143.2L444.4 139.9L450.1 134.6L456.6 131.1L490.7 119.5L490.8 103.5L489.6 91.8L486.8 84.7L484.8 82.7L482.3 81.2L477.6 80.4L473.7 81.1L471.1 82.5L468.2 85.7L466.6 89.2L465.1 95.5L464.5 109.5L463.5 110.3L437.5 109.7L437.2 100.5L438.2 89.5L441.4 77.9L444.1 72.6L447.5 68L451.6 64.1L456.5 61L464.5 58L475.8 56.5L480 56.5L491.5 58L499.6 60.9L503.9 63.5L509 68.5L512.4 73.1L516.4 83.1L518.9 98.5L519.3 113.5L519.3 215.5ZM621.5 236.6L594.5 236.9L594.1 236.5L593.8 111.5L593 96.5L591.8 89.7L589.5 85L586.2 82.2L581.5 81.2L578.3 81.8L575.6 83.1L573 85.5L571.4 87.9L569 94.5L567.3 108.6L566.9 236.5L541.5 236.9L539.7 236.5L539.4 91.5L538.6 59.5L539.5 58.9L564.5 59.2L565.7 71.5L566.5 72.4L572.2 64.7L577.8 60.3L584.8 57.3L593.4 56.4L602.3 58.2L608.8 61.7L611.9 64.7L614.4 68.1L617.9 75.6L620.8 86.6L621.8 100.5ZM426.8 57.5L426.5 86.8L425.5 87.2L418.5 86.7L413.5 87L410.4 87.8L406.3 89.9L403.1 92.6L400.6 96.1L397.5 105L396.3 122.5L396 236.5L395.5 236.9L389.5 236.9L368 236.5L367.8 88.5L366.9 59.5L367.5 58.9L392.5 59L393.5 59.5L394.5 74L394.7 75.5L395.5 75.6L400.9 66.4L403.8 63.3L408.4 59.9L411.7 58.2L416.5 57L422.5 56.8ZM301.8 81.4L297.5 83L294 86.4L291.9 90.4L290.1 96.5L289.1 104.5L288.5 125.7L288.4 167.5L289.2 192.5L291 203.5L293 208.5L295.6 211.9L299.4 214.2L303.5 214.8L308.4 213.9L312.4 210.9L315.2 205.6L316.6 198.3L317.9 179.5L317.9 122.5L316.8 101.5L314.6 89.9L312.6 85.9L310.1 83.4L305.9 81.6ZM679.7 81.3L675.6 83.1L672.5 87L670.9 91.5L669.3 101.7L668.5 127.6L668.5 170.5L669.2 192.5L671.4 207.2L673 210.6L675.2 213.3L677.8 214.7L681.5 215.2L686 214.5L689.1 211.8L691.7 207.2L693.7 200.4L694.8 190.5L695.7 172.5L695.8 128.5L694.8 104.5L692.7 91.8L690.7 86.8L688 83.5L684.1 81.5ZM488.7 143.2L475.6 148.1L471.3 150.8L467 155.5L464.5 162.1L463.9 169.5L463.8 184.5L464.1 196.5L464.9 202.5L466.5 208L468.1 211.4L470.7 213.9L473.6 215L479.4 215L484 212.5L487.2 208.7L489.8 201.4L490.8 186.5L490.9 143.5L490.5 142.9ZM89 171.5L95.5 171.2L101.5 171.9L107.4 174.1L111.1 176.4L114.9 179.7L119.4 186.1L122.7 195.8L123.2 202.5L123 209.5L119.7 220.2L116.7 225.2L113.4 228.9L108.7 232.2L102.3 234.8L95.3 235.5L88.5 235.1L84.4 234.1L79 231.5L74.6 227.9L71 223.6L68.5 219L66.3 212.3L65.6 204.5L66 196.5L67.4 190.8L69.7 185.3L73.1 180.6L78.3 175.8L82.8 173.4ZM235.8 172.5L235 186.5L234.5 187.5L228.5 186.6L224.1 187.6L220.4 189.9L217.5 194L216.2 201.5L216.2 233.5L215.7 234.5L200.5 234.5L200 231.5L200 172.5L200.5 172.1L214.5 172L215.3 172.5L215.6 180.5L216.5 181.2L220.1 175.6L224.8 172.3L230.5 171.2L233.9 171.6ZM2.5 172.3L18.5 172L19.4 172.5L31.2 213.3L32.5 216.4L44.9 172.5L45.5 172.1L60.5 172.1L61.5 172.4L41.8 232.3L38.4 241.9L35.2 248.7L30.2 254.6L24.2 257.7L14.5 258.1L10.8 257.7L7.8 256.5L10.5 244.3L16.5 244.9L20 243.6L22.5 240.1L23.6 237.1L23.7 234.6ZM133.5 172.5L134.5 172L148.5 172L149.3 172.5L149.5 206.3L150.1 213.4L151.1 216.3L153.4 219L156 220.4L159.5 221L163.1 220.5L166.9 218.4L169.1 215.6L170.4 211.9L170.8 206.5L170.9 172.5L171.5 172.1L186.5 172.3L186.5 234.1L172.5 234.3L171.5 225.8L165 232.5L161 234.4L156.5 235.1L149.6 234.9L145.8 233.7L142 231.5L138 227.5L135.8 223.7L134.6 219.9L133.5 212.9ZM93.8 184.5L88.7 186.1L86.5 188L84.4 190.9L82.3 197.6L81.9 204.5L83 212.5L85.6 217.9L89.4 221.1L94.5 222.2L97.4 221.8L100.2 220.7L103.7 217.2L106.1 211.5L106.9 202.5L105.9 194.6L103.4 189.1L99.7 185.8Z";

const RYBB_BRAND_MARK = `<svg viewBox="0 0 726 261" width="118" height="42" fill="currentColor" aria-hidden="true" style="display:block;height:24px;width:auto;"><path fill-rule="evenodd" d="${RYBB_LOGO_PATH}"></path></svg>`;

const RYBB_LOGO_SVG = RYBB_BRAND_MARK;

const PAGE_CSS = `
:root{
  --ease-editorial: cubic-bezier(.16, 1, .3, 1);
  --ease-out-back: cubic-bezier(.23, 1, .32, 1);
}
*{box-sizing:border-box;margin:0;padding:0}
html{background:#FAF7F3;color:#17171A;-webkit-text-size-adjust:100%}
body{
  min-height:100vh;
  min-height:100dvh;
  background-color:#FAF7F3;
  background-image:
    radial-gradient(circle at 88% 8%,rgba(140,163,196,.12),transparent 28rem),
    linear-gradient(rgba(228,222,208,.35) 1px,transparent 1px);
  background-size:auto,100% 4.5rem;
  color:#17171A;
  font-family:'Inter',ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  line-height:1.6;
  letter-spacing:-.01em;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  padding:2rem 1.25rem 3rem;
}
.shell{width:100%;max-width:480px}
.shell.wide{max-width:600px}
.topbar{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:1rem;
  margin-bottom:1.25rem;
  padding:0 .25rem;
}
.brand-link{display:inline-flex;align-items:center;color:#17171A;text-decoration:none}
.brand-link:hover{opacity:.82}
.brand-tag{
  font:600 11px/1.2 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
  color:#58575E;
  text-transform:lowercase;
  letter-spacing:.04em;
}
.card{
  background:linear-gradient(150deg,rgba(255,255,255,.94) 0%,rgba(246,241,232,.78) 100%);
  backdrop-filter:blur(24px) saturate(160%);
  -webkit-backdrop-filter:blur(24px) saturate(160%);
  border:1px solid rgba(228,222,208,.95);
  border-radius:20px;
  padding:2.25rem;
  width:100%;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.95),0 20px 50px -10px rgba(60,50,30,.08);
}
@media(max-width:520px){
  body{padding:1.25rem 1rem 2.25rem}
  .card{padding:1.5rem}
  .brand-tag{display:none}
}
.eyebrow{
  display:block;
  font:600 11px/1.3 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
  letter-spacing:.1em;
  text-transform:lowercase;
  color:#3D5A85;
  margin-bottom:.5rem;
}
h1,h2,h3{
  font-family:'Fraunces',Georgia,'Times New Roman',serif;
  font-weight:400;
  color:#17171A;
  letter-spacing:-.03em;
  text-transform:lowercase;
  line-height:1.18;
}
h1{font-size:1.75rem;margin-bottom:.75rem}
h2{font-size:1.25rem;margin-bottom:.65rem}
h3{font-size:1.05rem;margin-bottom:.65rem}
p.lead{color:#58575E;font-size:.92rem;line-height:1.65;margin-bottom:1.5rem}
p.lead:empty{display:none}
.box{
  background:linear-gradient(145deg,rgba(255,255,255,.96),rgba(246,241,232,.75));
  backdrop-filter:blur(16px);
  -webkit-backdrop-filter:blur(16px);
  border:1px solid rgba(228,222,208,.92);
  border-radius:14px;
  padding:1.15rem 1.25rem;
  margin-bottom:1.25rem;
  text-align:left;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 8px 22px -6px rgba(60,50,30,.05);
}
.box.accent{border-color:#8CA3C4;box-shadow:inset 0 1px 0 rgba(255,255,255,.95),0 10px 24px -6px rgba(140,163,196,.15)}
.box.review-box{border-color:rgba(232,163,61,.7);background:linear-gradient(145deg,rgba(255,253,249,.96),rgba(255,248,236,.75))}
.kv{display:grid;gap:.55rem;font-size:.86rem;color:#58575E}
.kv-row{display:flex;flex-wrap:wrap;justify-content:space-between;gap:.35rem 1rem;padding-bottom:.5rem;border-bottom:1px solid rgba(228,222,208,.65)}
.kv-row:last-child{padding-bottom:0;border-bottom:none}
.kv-val{color:#17171A;font-weight:600;text-align:right}
blockquote{
  background:linear-gradient(145deg,rgba(255,255,255,.95),rgba(246,241,232,.65));
  color:#17171A;
  font-size:.9rem;
  font-style:italic;
  line-height:1.6;
  margin:0 0 1.35rem;
  text-align:left;
  border:1px solid rgba(228,222,208,.9);
  border-left:3px solid #8CA3C4;
  border-radius:0 12px 12px 0;
  padding:.9rem 1rem;
  white-space:pre-wrap;
  word-break:break-word;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 4px 14px rgba(60,50,30,.04);
}
label{
  display:block;
  text-align:left;
  font-size:.78rem;
  font-weight:500;
  color:#58575E;
  text-transform:lowercase;
  margin:0 0 .4rem;
}
input,select,textarea{
  width:100%;
  background:rgba(255,255,255,.9);
  backdrop-filter:blur(8px);
  -webkit-backdrop-filter:blur(8px);
  border:1px solid rgba(228,222,208,.95);
  border-radius:11px;
  padding:.72rem .85rem;
  font:inherit;
  font-size:.88rem;
  color:#17171A;
  margin-bottom:1rem;
  box-shadow:inset 0 1px 2px rgba(0,0,0,.02),0 1px 0 rgba(255,255,255,.8);
  transition:border-color .2s ease,box-shadow .2s ease,background .2s ease;
}
textarea{
  field-sizing:content;
  height:auto;
  min-block-size:4.5lh;
  max-block-size:14lh;
  resize:vertical;
}
input::placeholder,textarea::placeholder{color:rgba(88,87,94,.6)}
input[readonly]{background:#F6F2E8;color:#58575E}
input[type="file"]{
  padding:.55rem .75rem;
  font-size:.82rem;
  background:rgba(255,255,255,.85);
  cursor:pointer;
}
input[type="file"]::file-selector-button{
  border:1px solid rgba(228,222,208,.95);
  background:linear-gradient(150deg,rgba(255,255,255,.95),rgba(237,230,214,.8));
  color:#17171A;
  padding:.4rem .8rem;
  border-radius:8px;
  margin-right:.8rem;
  font:600 .78rem/1.2 inherit;
  cursor:pointer;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.9);
  transition:background .2s,border-color .2s;
}
input[type="file"]::file-selector-button:hover{
  background:#EDE6D6;
  border-color:#8CA3C4;
}
.file-note{
  font-size:.74rem;
  color:#58575E;
  margin-top:-.6rem;
  margin-bottom:1rem;
  display:block;
}
.section-subheading{
  font-weight:600;
  font-size:.84rem;
  margin-top:1.15rem;
  margin-bottom:.65rem;
  color:#17171A;
  text-transform:lowercase;
  border-bottom:1px solid #E4DED0;
  padding-bottom:.35rem;
}
.section-subheading:first-child{margin-top:0}
.history-item{
  padding:.85rem 0;
  border-top:1px solid rgba(228,222,208,.65);
}
.history-item:first-child{
  padding-top:.2rem;
  border-top:none;
}
.history-head{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:.5rem;
  margin-bottom:.45rem;
}
.confirm-box{
  margin-top:.85rem;
  margin-bottom:1.15rem;
  padding:.85rem 1rem;
  background:linear-gradient(145deg,rgba(255,253,249,.92),rgba(255,248,236,.75));
  backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);
  border:1px solid rgba(232,163,61,.75);
  border-radius:12px;
  text-align:left;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.95),0 4px 14px rgba(232,163,61,.08);
}
.confirm-label{
  display:flex;
  align-items:flex-start;
  gap:.65rem;
  font-size:.82rem;
  line-height:1.45;
  color:#17171A;
  cursor:pointer;
  margin-bottom:0;
  user-select:none;
}
.confirm-label input[type="checkbox"]{
  width:1.15rem;
  height:1.15rem;
  min-width:1.15rem;
  margin:0;
  margin-top:.12rem;
  accent-color:#E8A33D;
  cursor:pointer;
}
.add-materials-slider{
  margin-top:1.5rem;
  border:1px solid rgba(228,222,208,.95);
  border-radius:16px;
  background:linear-gradient(150deg,rgba(255,255,255,.88),rgba(246,241,232,.75));
  backdrop-filter:blur(16px);
  -webkit-backdrop-filter:blur(16px);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 8px 24px -6px rgba(60,50,30,.06);
  overflow:hidden;
  text-align:left;
}
.add-materials-slider summary.slider-summary{
  list-style:none;
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:.95rem 1.15rem;
  font-size:.84rem;
  font-weight:600;
  color:#17171A;
  cursor:pointer;
  background:transparent;
  user-select:none;
  letter-spacing:-.01em;
  transition:background 200ms ease;
}
.add-materials-slider summary.slider-summary::-webkit-details-marker{display:none}
.add-materials-slider summary.slider-summary:hover{background:rgba(228,222,208,.35)}
.add-materials-slider summary.slider-summary::after{content:'+';font-weight:700;color:#825008;font-size:.95rem}
.add-materials-slider[open] summary.slider-summary::after{content:'−'}
.add-materials-slider .slider-body{
  padding:1.15rem;
  background:rgba(255,255,255,.6);
  border-top:1px solid rgba(228,222,208,.8);
}
.slider-warning{
  margin-bottom:1.15rem;
  padding:.85rem 1rem;
  background:rgba(251,249,244,.85);
  border-left:3px solid #E8A33D;
  border-radius:8px;
  font-size:.80rem;
  line-height:1.5;
  color:#58575E;
}
.slider-warning p{margin:0}
.notice-box{
  margin-top:1rem;
  margin-bottom:1.25rem;
  padding:.85rem 1rem;
  background:linear-gradient(145deg,rgba(255,255,255,.88),rgba(246,241,232,.65));
  backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);
  border:1px solid rgba(228,222,208,.9);
  border-radius:12px;
  font-size:.82rem;
  line-height:1.45;
  color:#58575E;
  text-align:left;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 4px 12px rgba(60,50,30,.03);
}
.notice-box p{margin:0}
input:focus,select:focus,textarea:focus{outline:none;border-color:#8CA3C4;box-shadow:0 0 0 3px rgba(140,163,196,.2)}
button,.btn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:.45rem;
  width:100%;
  background:linear-gradient(150deg,#8CA3C4,#7893B8);
  color:#0A0A0C;
  border:1px solid rgba(140,163,196,.9);
  padding:.85rem 1.25rem;
  font:600 .84rem/1.2 inherit;
  letter-spacing:.02em;
  text-transform:lowercase;
  text-decoration:none;
  border-radius:12px;
  cursor:pointer;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 8px 18px -4px rgba(95,122,158,.25);
  transition:all 240ms var(--ease-editorial);
  will-change:transform;
}
button:hover,.btn:hover{background:linear-gradient(150deg,#5F7A9E,#4E6A8E);border-color:#5F7A9E;color:#FFFFFF;transform:translateY(-1px);box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 12px 24px -6px rgba(95,122,158,.3)}
button:active,.btn:active{transform:scale(0.97);box-shadow:inset 0 1px 0 rgba(0,0,0,.15),0 4px 10px -2px rgba(95,122,158,.2)}
button.secondary,.btn.secondary,button.no{
  background:linear-gradient(150deg,rgba(255,255,255,.95),rgba(246,241,232,.75));
  backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);
  color:#17171A;
  border:1px solid rgba(228,222,208,.95);
  margin-top:.6rem;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 4px 12px rgba(60,50,30,.04);
}
button.secondary:hover,.btn.secondary:hover,button.no:hover{
  border-color:#8CA3C4;
  background:#FFFFFF;
  color:#17171A;
  transform:translateY(-1px);
}
button.secondary:active,.btn.secondary:active,button.no:active{
  transform:scale(0.97);
}
.btn-inline{
  width:auto;
  padding:.52rem .9rem;
  font-size:.76rem;
  border-radius:9px;
}
.rev-details{margin-top:.65rem;text-align:left}
.rev-details summary{list-style:none;margin-top:0;user-select:none}
.rev-details summary::-webkit-details-marker{display:none}
.rev-details[open] summary{border-color:#E8A33D;background:#FFFDF9;color:#825008}
.rev-body{
  margin-top:.65rem;
  background:linear-gradient(145deg,rgba(255,255,255,.95),rgba(246,241,232,.75));
  backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);
  border:1px solid rgba(228,222,208,.92);
  border-radius:14px;
  padding:1.05rem 1.15rem;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 6px 18px rgba(60,50,30,.04);
}
.rev-err{
  color:#825008;
  background:#FFFDF9;
  border:1px solid #E8A33D;
  border-radius:8px;
  padding:.55rem .75rem;
  font-size:.8rem;
  margin-bottom:.85rem;
}
:focus-visible{outline:2px solid #E8A33D;outline-offset:2px}
.timeline{display:grid;gap:.85rem;margin-bottom:1.25rem;text-align:left}
.phase-card{
  background:linear-gradient(145deg,rgba(255,255,255,.94),rgba(246,241,232,.7));
  backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);
  border:1px solid rgba(228,222,208,.92);
  border-radius:14px;
  padding:.95rem 1.1rem;
  display:flex;
  align-items:flex-start;
  gap:.85rem;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 4px 14px rgba(60,50,30,.03);
}
.phase-card.is-done{border-color:rgba(140,163,196,.6);background:linear-gradient(145deg,rgba(255,255,255,.9),rgba(235,242,250,.65))}
.phase-card.is-active{border-color:#8CA3C4;box-shadow:inset 0 1px 0 rgba(255,255,255,.95),0 8px 22px rgba(95,122,158,.12)}
.phase-card.is-review{border-color:rgba(232,163,61,.8);background:linear-gradient(145deg,rgba(255,253,249,.96),rgba(255,248,236,.75));box-shadow:inset 0 1px 0 rgba(255,255,255,.95),0 10px 24px rgba(232,163,61,.12)}
.phase-dot{
  width:28px;
  height:28px;
  border-radius:999px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  flex-shrink:0;
  font:700 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;
  border:1px solid #E4DED0;
  color:#58575E;
  background:#F6F2E8;
  margin-top:.1rem;
}
.phase-card.is-done .phase-dot{background:#8CA3C4;border-color:#8CA3C4;color:#0A0A0C}
.phase-card.is-active .phase-dot{background:rgba(232,163,61,.16);border-color:#E8A33D;color:#825008}
.phase-card.is-review .phase-dot{background:#E8A33D;border-color:#E8A33D;color:#0A0A0C}
.phase-body{flex:1;min-width:0}
.phase-title{display:block;font-size:.92rem;font-weight:600;color:#17171A;text-transform:lowercase}
.phase-meta{display:block;font-size:.76rem;color:#58575E;margin-top:.15rem}
.phase-card.is-review .phase-meta{color:#825008;font-weight:600}
.phase-note{
  margin-top:.65rem;
  padding:.6rem .75rem;
  border-radius:8px;
  background:#F6F2E8;
  color:#17171A;
  font-size:.82rem;
  line-height:1.5;
  white-space:pre-wrap;
  word-break:break-word;
}
.phase-actions{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.7rem}
.pill-link{
  display:inline-flex;
  align-items:center;
  gap:.35rem;
  font:600 .75rem/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;
  color:#3D5A85;
  text-decoration:none;
  text-transform:lowercase;
  padding:.42rem .72rem;
  border-radius:9px;
  border:1px solid rgba(140,163,196,.55);
  background:linear-gradient(145deg,rgba(255,255,255,.8),rgba(140,163,196,.15));
  backdrop-filter:blur(8px);
  -webkit-backdrop-filter:blur(8px);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.7);
  transition:all 200ms var(--ease-editorial);
  will-change:transform;
}
.pill-link:hover{background:#8CA3C4;color:#0A0A0C;border-color:#8CA3C4;transform:translateY(-1px)}
.pill-link:active{transform:scale(0.96)}
.banner-ok{
  background:linear-gradient(145deg,rgba(255,255,255,.94),rgba(240,245,252,.75));
  backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);
  border:1px solid rgba(140,163,196,.8);
  border-left:3px solid #3D5A85;
  border-radius:12px;
  padding:.8rem 1rem;
  margin-bottom:1.15rem;
  font-size:.82rem;
  color:#17171A;
  text-align:left;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 6px 16px rgba(60,50,30,.04);
}
.undo-bar-wrap{
  position:fixed;
  bottom:1.5rem;
  bottom:max(1.5rem, calc(env(safe-area-inset-bottom, 0px) + 1rem));
  left:50%;
  transform:translateX(-50%);
  width:calc(100% - 2rem);
  max-width:480px;
  z-index:99999;
  background:linear-gradient(150deg,rgba(23,23,26,.96),rgba(30,30,34,.92));
  backdrop-filter:blur(24px) saturate(180%);
  -webkit-backdrop-filter:blur(24px) saturate(180%);
  color:#F5F2EA;
  border:1px solid rgba(255,255,255,.16);
  border-radius:16px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.2),0 20px 48px -8px rgba(0,0,0,.5);
  overflow:hidden;
  animation:undoPopIn .35s var(--ease-editorial) forwards, undoDismiss .4s var(--ease-editorial) 60s forwards;
  transition:opacity .3s var(--ease-editorial),transform .3s var(--ease-editorial),visibility .3s;
  will-change:transform,opacity;
}
.undo-bar-wrap.is-dismissed{
  opacity:0;
  transform:translate(-50%,16px) scale(0.96);
  pointer-events:none;
}
@keyframes undoPopIn{
  from{opacity:0;transform:translate(-50%,24px) scale(0.96);}
  to{opacity:1;transform:translate(-50%,0) scale(1);}
}
@keyframes undoDismiss{
  0%,95%{opacity:1;transform:translate(-50%,0) scale(1);pointer-events:auto;}
  100%{opacity:0;transform:translate(-50%,16px) scale(0.96);pointer-events:none;visibility:hidden;}
}
.undo-bar-content{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:.75rem;
  padding:.85rem 1rem;
}
.undo-bar-text{
  display:flex;
  align-items:center;
  gap:.65rem;
  font-size:.82rem;
  font-weight:500;
  color:#F5F2EA;
  text-transform:lowercase;
  min-width:0;
  flex:1;
}
.undo-ring{
  width:20px;
  height:20px;
  transform:rotate(-90deg);
  flex-shrink:0;
}
.undo-ring-bg{
  stroke:rgba(255,255,255,.16);
}
.undo-ring-stroke{
  stroke:#E8A33D;
  stroke-dasharray:56.55;
  stroke-dashoffset:0;
  animation:undoRingCountdown 60s linear forwards;
  stroke-linecap:round;
}
@keyframes undoRingCountdown{
  from{stroke-dashoffset:0;}
  to{stroke-dashoffset:56.55;}
}
.undo-bar-actions{
  display:flex;
  align-items:center;
  gap:.5rem;
  flex-shrink:0;
}
.btn-undo{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  background:#E8A33D;
  color:#0A0A0C;
  border:1px solid #E8A33D;
  border-radius:8px;
  padding:.4rem .75rem;
  font:600 .76rem/1.2 inherit;
  text-transform:lowercase;
  cursor:pointer;
  transition:background .2s var(--ease-editorial),border-color .2s var(--ease-editorial),transform .2s var(--ease-editorial);
  will-change:transform;
}
.btn-undo:hover{
  background:#F0BE82;
  border-color:#F0BE82;
  transform:translateY(-1px);
}
.btn-undo:active{
  transform:scale(0.96);
}
.btn-dismiss{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  background:transparent;
  color:#9C9BA3;
  border:1px solid rgba(255,255,255,.15);
  border-radius:8px;
  width:28px;
  height:28px;
  padding:0;
  font:inherit;
  outline:none;
  -webkit-appearance:none;
  appearance:none;
  text-decoration:none;
  cursor:pointer;
  transition:color .2s var(--ease-editorial),border-color .2s var(--ease-editorial),transform .2s var(--ease-editorial),background .2s var(--ease-editorial);
  will-change:transform;
  flex-shrink:0;
}
.btn-dismiss:hover{
  color:#F5F2EA;
  background:rgba(255,255,255,.08);
  border-color:rgba(255,255,255,.35);
  transform:scale(1.05);
}
.btn-dismiss:active{
  transform:scale(0.94);
}
.foot{
  margin-top:1.25rem;
  display:flex;
  flex-wrap:wrap;
  justify-content:space-between;
  gap:.5rem 1rem;
  padding:0 .25rem;
  font-size:.75rem;
  color:#58575E;
  text-transform:lowercase;
}
.foot a{color:#3D5A85;text-decoration:none}
.foot a:hover{text-decoration:underline}

/* Hybrid Chat Widget (Liquid Glass y Editorial Physics) */
.chat-section{
  margin-top:1.5rem;
  border-radius:18px;
  border:1px solid rgba(228,222,208,.95);
  background:linear-gradient(150deg,rgba(255,255,255,.94) 0%,rgba(246,241,232,.8) 100%);
  backdrop-filter:blur(20px) saturate(160%);
  -webkit-backdrop-filter:blur(20px) saturate(160%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.95),0 16px 36px -10px rgba(60,50,30,.07);
  overflow:hidden;
  text-align:left;
}
.chat-header{
  padding:1.15rem 1.35rem;
  border-bottom:1px solid rgba(228,222,208,.85);
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  justify-content:space-between;
  gap:.85rem;
  background:rgba(255,255,255,.4);
}
.chat-header-info{min-width:0}
.chat-mode-tabs{
  display:inline-flex;
  align-items:center;
  background:rgba(228,222,208,.5);
  padding:.25rem;
  border-radius:9999px;
  border:1px solid rgba(228,222,208,.9);
}
.chat-tab-btn{
  display:inline-flex;
  align-items:center;
  gap:.45rem;
  padding:.42rem .85rem;
  border-radius:9999px;
  border:none;
  background:transparent;
  color:#58575E;
  font:600 .76rem/1.2 inherit;
  text-transform:lowercase;
  letter-spacing:.02em;
  cursor:pointer;
  transition:all 220ms var(--ease-editorial);
  width:auto;
  box-shadow:none;
}
.chat-tab-btn:hover{
  color:#17171A;
  background:rgba(255,255,255,.6);
  transform:none;
}
.chat-tab-btn.is-active{
  background:#FFFFFF;
  color:#17171A;
  box-shadow:0 2px 8px rgba(60,50,30,.08),inset 0 1px 0 rgba(255,255,255,.9);
}
.tab-dot{
  width:7px;
  height:7px;
  border-radius:9999px;
  display:inline-block;
}
.tab-dot.ai{background:#E8A33D;box-shadow:0 0 6px rgba(232,163,61,.5)}
.tab-dot.human{background:#8CA3C4;box-shadow:0 0 6px rgba(140,163,196,.6)}
.chat-panel{
  display:none;
  padding:1.15rem 1.35rem 1.35rem;
}
.chat-panel.is-active{display:block}
.chat-intro-banner{
  padding:.75rem 1rem;
  border-radius:12px;
  background:rgba(251,249,244,.85);
  border:1px solid rgba(228,222,208,.9);
  font-size:.80rem;
  line-height:1.5;
  color:#58575E;
  margin-bottom:1rem;
  display:flex;
  flex-direction:column;
  gap:.5rem;
}
.chat-intro-banner.human-banner{border-left:3px solid #8CA3C4}
.chat-intro-banner p{margin:0}
.btn-switch-human{
  align-self:flex-start;
  background:transparent;
  border:none;
  color:#3D5A85;
  font:600 .76rem/1.2 inherit;
  cursor:pointer;
  padding:0;
  text-decoration:underline;
  text-transform:lowercase;
  box-shadow:none;
  width:auto;
}
.btn-switch-human:hover{color:#17171A;background:transparent;transform:none}
.chat-msg-list{
  display:flex;
  flex-direction:column;
  gap:.75rem;
  max-height:380px;
  overflow-y:auto;
  padding-right:.35rem;
  margin-bottom:1rem;
  scroll-behavior:smooth;
}
.chat-empty{
  text-align:center;
  padding:2rem 1rem;
  font-size:.82rem;
  color:#9C9BA3;
  font-style:italic;
}
.chat-msg-row{display:flex;width:100%}
.chat-msg-row.is-client{justify-content:flex-end}
.chat-msg-row.is-studio,.chat-msg-row.is-ai{justify-content:flex-start}
.chat-msg-bubble{
  max-width:88%;
  border-radius:14px;
  padding:.75rem .95rem;
  font-size:.84rem;
  line-height:1.55;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.8),0 4px 12px rgba(60,50,30,.03);
  word-break:break-word;
}
.chat-msg-row.is-client .chat-msg-bubble{
  background:linear-gradient(150deg,#8CA3C4,#7893B8);
  color:#0A0A0C;
  border:1px solid rgba(140,163,196,.85);
  border-bottom-right-radius:4px;
}
.chat-msg-row.is-studio .chat-msg-bubble{
  background:linear-gradient(145deg,rgba(255,255,255,.95),rgba(246,241,232,.8));
  color:#17171A;
  border:1px solid rgba(140,163,196,.55);
  border-bottom-left-radius:4px;
}
.chat-msg-row.is-ai .chat-msg-bubble{
  background:linear-gradient(145deg,rgba(255,253,249,.95),rgba(255,248,236,.85));
  color:#17171A;
  border:1px solid rgba(232,163,61,.6);
  border-bottom-left-radius:4px;
}
.chat-msg-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:.75rem;
  margin-bottom:.25rem;
  font-size:.72rem;
}
.chat-msg-row.is-client .chat-msg-head{color:rgba(10,10,12,.75)}
.chat-msg-row.is-studio .chat-msg-head{color:#3D5A85}
.chat-msg-row.is-ai .chat-msg-head{color:#825008}
.chat-msg-author{font-weight:600;text-transform:lowercase}
.chat-msg-date{font-size:.68rem;opacity:.8}
.chat-msg-text{white-space:pre-wrap}
.chat-trans-wrap{
  margin-top:.45rem;
  padding-top:.35rem;
  border-top:1px dashed rgba(140,163,196,.35);
}
.chat-trans-toggle{
  background:none;
  border:none;
  padding:0;
  margin:0;
  cursor:pointer;
  display:inline-flex;
  align-items:center;
  gap:.35rem;
  font-family:inherit;
  font-size:.72rem;
  color:#3D5A85;
  text-decoration:underline;
  text-transform:lowercase;
  line-height:1.35;
  opacity:.88;
  transition:opacity .15s ease;
}
.chat-trans-toggle:hover{
  opacity:1;
}
.chat-trans-toggle svg{
  flex-shrink:0;
  width:12px;
  height:12px;
}
.chat-input-wrap{
  display:flex;
  align-items:flex-end;
  gap:.65rem;
  background:rgba(255,255,255,.85);
  backdrop-filter:blur(8px);
  -webkit-backdrop-filter:blur(8px);
  border:1px solid rgba(228,222,208,.95);
  border-radius:14px;
  padding:.5rem .65rem;
  box-shadow:inset 0 1px 2px rgba(0,0,0,.02);
  transition:border-color .2s ease,box-shadow .2s ease;
}
.chat-input-wrap:focus-within{
  border-color:#8CA3C4;
  box-shadow:0 0 0 3px rgba(140,163,196,.2);
}
.chat-input-wrap textarea{
  flex:1;
  background:transparent;
  border:none;
  border-radius:0;
  padding:.4rem .3rem;
  font:inherit;
  font-size:.84rem;
  color:#17171A;
  margin-bottom:0;
  box-shadow:none;
  min-block-size:2.2lh;
  max-block-size:6lh;
  resize:none;
}
.chat-input-wrap textarea:focus{outline:none;box-shadow:none}
.chat-send-btn{
  width:36px;
  height:36px;
  min-width:36px;
  border-radius:10px;
  background:linear-gradient(150deg,#8CA3C4,#7893B8);
  color:#0A0A0C;
  border:1px solid rgba(140,163,196,.9);
  display:inline-flex;
  align-items:center;
  justify-content:center;
  cursor:pointer;
  padding:0;
  transition:all 200ms var(--ease-editorial);
  box-shadow:0 2px 6px rgba(95,122,158,.2);
}
.chat-send-btn:hover{background:#5F7A9E;color:#FFFFFF;transform:translateY(-1px)}
.chat-send-btn:active{transform:scale(0.94)}
.chat-send-btn.btn-ai{background:#E8A33D;border-color:#E8A33D}
.chat-send-btn.btn-ai:hover{background:#F0BE82;border-color:#F0BE82}
.chat-send-btn svg{width:15px;height:15px}
.chat-typing{
  display:inline-flex;
  align-items:center;
  gap:4px;
  padding:.5rem .75rem;
}
.chat-typing span{
  width:5px;
  height:5px;
  background:#E8A33D;
  border-radius:999px;
  animation:typingBounce 1s infinite alternate;
}
.chat-typing span:nth-child(2){animation-delay:.2s}
.chat-typing span:nth-child(3){animation-delay:.4s}
@keyframes typingBounce{
  from{transform:translateY(0);opacity:.4}
  to{transform:translateY(-4px);opacity:1}
}
`;

function page(
  title,
  heading,
  text,
  {
    form = false,
    html = "",
    lang = "es",
    eyebrow = "",
    wide = false,
    formLabel = "verificar y acceder al pago",
    footerUrl = SITE_URL,
    footerLabel = "",
    overlay = "",
  } = {}
) {
  const l = pickLang(lang);
  const common = (PG[l] || PG.es).common;
  const tag = common.studioTag;
  const backText = footerLabel || common.backSite;

  return `<!DOCTYPE html><html lang="${l}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="robots" content="noindex"><meta name="color-scheme" content="light"><meta name="theme-color" content="#FFFFFF"><title>${esc(lc1(title))} — rebrandyourbrand</title><style>${PAGE_CSS}</style></head><body><div class="shell${wide ? " wide" : ""}"><header class="topbar"><a href="${SITE_URL}" class="brand-link" aria-label="rebrandyourbrand">${RYBB_BRAND_MARK}</a><span class="brand-tag">${esc(tag)}</span></header><main class="card">${eyebrow ? `<span class="eyebrow">${esc(eyebrow)}</span>` : ""}<h1>${esc(heading)}</h1>${text ? `<p class="lead">${esc(text)}</p>` : ""}${html}${form ? `<form method="POST"><button type="submit">${esc(formLabel)}</button></form>` : ""}</main><footer class="foot"><a href="${esc(footerUrl)}">${esc(backText)}</a><a href="mailto:hola@rebrandyourbrand.es">hola@rebrandyourbrand.es</a></footer></div>${overlay}</body></html>`;
}

const msgPage = (lang, key, status, extra = {}) => {
  const l = pickLang(lang);
  const [title, heading, text] = PG[l][key];
  return htmlResponse(
    page(title, heading, text, { lang: l, formLabel: PG[l].btn, ...extra }),
    status
  );
};

const errorPage = (lang = "es") => msgPage(lang, "error", 502);

const paymentRetryPage = (lang) => msgPage(lang, "retry", 502, { form: true });

const stars = (n) => `${"★".repeat(n)}${"☆".repeat(5 - n)}`;

// ══ handlers.js — Manejadores de rutas: verificar, seguimiento, onboarding, fases, bajas y reseñas. ══

async function handleVerify(request, env, ctx, url) {
  let L = langFromRequest(request);
  const token = url.searchParams.get("token");
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return msgPage(L, "invalid", 400);

  if (request.method === "GET" || request.method === "HEAD") {
    try {
      const rawGet = env.LEADS_KV ? await env.LEADS_KV.get(`pending:${token}`) : null;
      if (rawGet) L = pickLang(JSON.parse(rawGet).lang);
    } catch {}
    return msgPage(L, "verify", 200, { eyebrow: PG[L].verify[0], form: true });
  }

  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
  }
  if (!env.LEADS_KV || !env.RESEND_API_KEY) return msgPage(L, "config", 500);

  const key = `pending:${token}`;
  const raw = await env.LEADS_KV.get(key);
  if (!raw) return msgPage(L, "expired", 400);

  const data = JSON.parse(raw);
  L = pickLang(data.lang);

  const plan = normalizeServices(data.services);
  if (!plan) {
    await alertAdmin(
      env,
      "verificación sin servicios válidos",
      `cliente: ${data.clientEmail}\nmarca: ${data.brand}\nservicios: ${JSON.stringify(data.services)}`,
      ctx
    );
    return paymentRetryPage(L);
  }

  let proj = null;
  if (typeof data.projectToken === "string" && /^[a-f0-9]{64}$/.test(data.projectToken)) {
    const rawProj = await env.LEADS_KV.get(`project:${data.projectToken}`);
    if (rawProj) proj = JSON.parse(rawProj);
  }
  if (!proj) {
    proj = await createProjectRecord(env, {
      clientEmail: data.clientEmail,
      brand: data.brand,
      plan,
      lang: L,
      messages: data.messages,
      domain: data.domain,
    });
    data.projectToken = proj.token;
  }

  const projectPageUrl = buildUrl("/proyecto", { token: proj.token });

  if (proj.paid) {
    return redirectTo(projectPageUrl);
  }

  if (!env.STRIPE_SECRET_KEY) {
    await alertAdmin(
      env,
      "la clave stripe_secret_key no está configurada",
      `cliente verificado sin poder generar el pago: ${data.clientEmail} (${data.brand}).`,
      ctx
    );
  }

  const leadPromise = data.leadDelivered
    ? Promise.resolve(true)
    : deliverVerifiedLead(env, ctx, { ...data, plan, projectToken: proj.token }).then(
        () => true,
        (e) => {
          console.error("deliver lead failed:", e?.message);
          return false;
        }
      );

  const checkoutPromise = env.STRIPE_SECRET_KEY
    ? ensureStripeCheckout(env, proj).catch((e) => {
        console.error("checkout failed:", e?.message);
        return null;
      })
    : Promise.resolve(null);

  const [delivered, checkout] = await Promise.all([leadPromise, checkoutPromise]);

  data.leadDelivered = delivered;
  if (checkout?.url && isStripeUrl(checkout.url)) data.checkoutUrl = checkout.url;
  await env.LEADS_KV.put(key, JSON.stringify(data), {
    expirationTtl: PENDING_VERIFY_TTL_SECONDS,
  });

  if (checkout?.paid) return redirectTo(projectPageUrl);
  if (checkout?.url) return redirectTo(checkout.url);
  return msgPage(L, "retry", 502, {
    form: true,
    footerUrl: projectPageUrl,
    footerLabel: PG[L].common.openTracker,
  });
}

function checkAllServicesApproved(proj) {
  if (!proj || !Array.isArray(proj.phases) || proj.phases.length === 0) return false;
  return proj.phases.every((ph) => ph.status === "done");
}

async function finalizeProjectClosure(
  env,
  proj,
  projectToken,
  { deliverableUrl = "", deliverableFilename = "", note = "" } = {}
) {
  if (!proj || !projectToken) return { ok: false, reason: "invalid_args" };

  const now = new Date().toISOString();
  let changed = false;

  // 1. Asegurar que todas las fases (incluida entrega final) queden con status "done"
  if (Array.isArray(proj.phases)) {
    for (const ph of proj.phases) {
      if (ph.status !== "done") {
        ph.status = "done";
        if (!ph.date) ph.date = now;
        if (!ph.approvedBy) ph.approvedBy = "client";
        if (!ph.approvedAt) ph.approvedAt = now;
        changed = true;
      }
    }
  }

  // 2. Establecer campos globales del proyecto
  if (proj.status !== "done") {
    proj.status = "done";
    changed = true;
  }
  if (!proj.finishedAt) {
    proj.finishedAt = now;
    changed = true;
  }
  const maxStep = Array.isArray(proj.phases) ? proj.phases.length : 1;
  if (Number(proj.currentPhase) <= maxStep) {
    proj.currentPhase = maxStep + 1;
    changed = true;
  }
  if (Array.isArray(proj.services) && proj.services.includes("web")) {
    if (!proj.nextRenewalAt) {
      proj.nextRenewalAt = addOneYearIso(now);
      changed = true;
    }
    if (!proj.renewalNextDue || proj.renewalNextDue !== proj.nextRenewalAt) {
      proj.renewalNextDue = proj.nextRenewalAt;
      changed = true;
    }
  }

  // Determinar el mejor entregable definitivo disponible
  const effectiveDelivUrl =
    deliverableUrl ||
    [...proj.phases].reverse().find((ph) => ph.deliverableUrl)?.deliverableUrl ||
    "";
  const effectiveDelivFilename =
    deliverableFilename ||
    [...proj.phases].reverse().find((ph) => ph.deliverableFilename)?.deliverableFilename ||
    "";
  const effectiveNote =
    note ||
    [...proj.phases].reverse().find((ph) => ph.note)?.note ||
    "";

  // Si deliveryPhase existe y no tenía entregable asignado, hereda el definitivo
  const deliveryPhase = proj.phases.find((ph) => ph.key === "delivery");
  if (deliveryPhase) {
    if (!deliveryPhase.deliverableUrl && effectiveDelivUrl) {
      deliveryPhase.deliverableUrl = effectiveDelivUrl;
      if (effectiveDelivFilename) deliveryPhase.deliverableFilename = effectiveDelivFilename;
      if (effectiveNote) deliveryPhase.note = effectiveNote;
      changed = true;
    }
  }

  const lang = pickLang(proj.lang);
  const trackingUrl = buildUrl("/proyecto", { token: projectToken });

  // 3. Correo de entrega final / cierre de proyecto al cliente con archivos definitivos (idempotente)
  if (!proj.completionEmailSent && env.RESEND_API_KEY) {
    const tc = EM[lang].completion || EM[lang].phase;
    try {
      await resendSend(
        env,
        {
          to: [proj.clientEmail],
          subject: tc.subject(proj.brand),
          ...renderEmail(lang, {
            paras: [
              tc.hello,
              tc.intro(proj.brand),
              tc.body,
              effectiveDelivUrl
                ? `${tc.deliverable}: <a href="${esc(effectiveDelivUrl)}" target="_blank" style="color:#3D5A85;font-weight:600;">${esc(effectiveDelivFilename || effectiveDelivUrl)}</a>`
                : "",
            ].filter(Boolean),
            quote: effectiveNote,
            cta: { label: tc.cta, url: trackingUrl },
            secondaryLink: effectiveDelivUrl
              ? { label: tc.deliverable, url: effectiveDelivUrl }
              : null,
            note: tc.note,
          }),
        },
        `completion-client-${projectToken}`
      );
      proj.completionEmailSent = true;
      changed = true;
    } catch (e) {
      console.error("completion client email failed:", e?.message);
    }
  }

  // 4. Notificación de cierre con éxito al estudio (idempotente)
  if (!proj.adminCompletionSent && env.RESEND_API_KEY) {
    try {
      await resendSend(
        env,
        {
          to: ["hola@rebrandyourbrand.es"],
          reply_to: proj.clientEmail,
          subject: `proyecto finalizado con éxito — ${proj.brand}`,
          ...renderEmail("es", {
            paras: [
              "el cliente ha validado todas las fases y el proyecto ha finalizado con éxito.",
              lines(
                `— proyecto: ${bold(proj.brand)}`,
                `— cliente: ${bold(proj.clientEmail)}`,
                `— servicios: ${bold(svcLabel(proj.services, "es"))}`,
                `— fecha de finalización (iso): ${bold(now)}`,
                effectiveDelivUrl ? `— entregable final: ${bold(effectiveDelivUrl)}` : ""
              ),
            ],
            cta: { label: "ver ficha del proyecto", url: trackingUrl },
          }),
        },
        `completion-admin-${projectToken}`
      );
      proj.adminCompletionSent = true;
      changed = true;
    } catch (e) {
      console.error("completion admin email failed:", e?.message);
    }
  }

  // 5. Correo automatizado con enlace único a reseña verificada (idempotente)
  if (!proj.reviewInvited && env.RESEND_API_KEY) {
    try {
      await sendReviewInvite(env, proj, projectToken);
      proj.reviewInvited = true;
      changed = true;
    } catch (e) {
      console.error("review invite failed in closure:", e?.message);
      await alertAdmin(
        env,
        "fallo al enviar la invitación a valorar en el cierre",
        `proyecto: ${proj.brand}\ncliente: ${proj.clientEmail}\nenlace de valoración (envíaselo a mano): ${await reviewUrl(env, projectToken)}`
      ).catch(() => {});
    }
  }

  if (changed) {
    await saveProject(env, projectToken, proj);
  }

  return { ok: true, finished: true };
}

async function completeProjectPhase(
  env,
  proj,
  projectToken,
  { step = 0, approvedBy = "studio", deliverableUrl = "", deliverableFilename = "", note = "", legacyActionToken = "" } = {}
) {
  let targetIdx = -1;
  if (step > 0) {
    targetIdx = proj.phases.findIndex(
      (ph) => ph.step === Number(step) && (ph.status === "active" || ph.status === "review")
    );
  }
  if (targetIdx < 0) {
    targetIdx = proj.phases.findIndex(
      (ph) => ph.step === Number(proj.currentPhase) && (ph.status === "active" || ph.status === "review")
    );
  }
  if (targetIdx < 0) {
    targetIdx = proj.phases.findIndex((ph) => ph.status === "active" || ph.status === "review");
  }
  if (targetIdx < 0) {
    if (checkAllServicesApproved(proj)) {
      await finalizeProjectClosure(env, proj, projectToken, { deliverableUrl, deliverableFilename, note });
      return { ok: true, finished: true };
    }
    return { ok: false, reason: "already_finished" };
  }

  const now = new Date().toISOString();
  const advancedPhase = proj.phases[targetIdx];
  advancedPhase.status = "done";
  advancedPhase.date = now;
  advancedPhase.approvedBy = approvedBy;
  if (approvedBy === "client") advancedPhase.approvedAt = now;
  if (deliverableUrl) advancedPhase.deliverableUrl = deliverableUrl;
  if (deliverableFilename) advancedPhase.deliverableFilename = deliverableFilename;
  if (note) advancedPhase.note = note;

  // Comprobar si se ha alcanzado el final del último servicio contratado o de todas las fases
  let nextPhase = null;
  let nextStep = 0;
  let finished = false;

  const isLastPhase = targetIdx + 1 >= proj.phases.length;
  if (isLastPhase && advancedPhase.key === "delivery") {
    finished = true;
    await finalizeProjectClosure(env, proj, projectToken, {
      deliverableUrl: deliverableUrl || advancedPhase.deliverableUrl || "",
      deliverableFilename: deliverableFilename || advancedPhase.deliverableFilename || "",
      note: note || advancedPhase.note || "",
    });
  } else if (!isLastPhase) {
    nextPhase = proj.phases[targetIdx + 1];
    nextPhase.status = "active";
    nextPhase.date = now;
    nextStep = nextPhase.step;
    proj.currentPhase = nextStep;
    await saveProject(env, projectToken, proj);
    if (nextPhase.key === "delivery" && approvedBy === "client") {
      await alertAdmin(
        env,
        `todas las fases creativas aprobadas — ${proj.brand}`,
        `el cliente ha aprobado la última fase creativa. el proyecto pasa a la fase de entrega final ("delivery"), pendiente del despliegue y entrega de archivos finales por parte del estudio.\n\ncliente: ${proj.clientEmail}\nproyecto: ${proj.brand}`
      ).catch(() => {});
    }
  }

  const lang = pickLang(proj.lang);
  const advancedTitleEs = phaseTitle(advancedPhase, "es");
  const nextTitleEs = nextPhase ? phaseTitle(nextPhase, "es") : "";
  const nextActionUrl = !finished ? await advancePhaseUrl(env, projectToken, nextStep) : "";
  const trackingUrl = buildUrl("/proyecto", { token: projectToken });
  const t = EM[lang].phase;

  const adminSubject =
    approvedBy === "client"
      ? `fase aprobada por el cliente: "${advancedTitleEs}" — ${proj.brand}`
      : `fase completada: "${advancedTitleEs}" — ${proj.brand}`;

  const adminParas =
    approvedBy === "client"
      ? [
          "el cliente ha dejado aprobada por escrito la fase actual.",
          lines(
            `— proyecto: ${bold(proj.brand)}`,
            `— cliente: ${bold(proj.clientEmail)}`,
            `— fase aprobada: ${bold(advancedTitleEs)}`,
            `— registro de aprobación (iso): ${bold(now)}`,
            finished
              ? `— estado: ${bold("proyecto finalizado con éxito")}`
              : `— nueva fase activa: ${bold(`paso ${nextStep} — ${nextTitleEs}`)}`
          ),
        ]
      : [
          "hola,",
          `la fase ${bold(advancedTitleEs)} del proyecto ${bold(proj.brand)} se ha completado con éxito.`,
          finished
            ? "el proyecto ha completado todas sus fases y ha finalizado con éxito."
            : `la nueva fase activa es: ${bold(`paso ${nextStep} — ${nextTitleEs}`)}.`,
        ];

  if (!finished) {
    try {
      await Promise.all([
        resendSend(
          env,
          {
            to: ["hola@rebrandyourbrand.es"],
            reply_to: proj.clientEmail,
            subject: adminSubject,
            ...renderEmail("es", {
              paras: adminParas,
              cta: nextActionUrl
                ? { label: `gestionar siguiente fase (${nextTitleEs})`, url: nextActionUrl }
                : { label: "ver ficha del proyecto", url: trackingUrl },
            }),
          },
          `phase-admin-${projectToken}-${advancedPhase.step}`
        ),
        resendSend(
          env,
          {
            to: [proj.clientEmail],
            subject: t.subject(proj.brand),
            ...renderEmail(lang, {
              paras: [
                t.hello,
                t.intro(bold(proj.brand)),
                lines(
                  `— ${t.done}: ${bold(phaseTitle(advancedPhase, lang))}`,
                  `— ${t.next}: ${bold(phaseTitle(nextPhase, lang))}`
                ),
              ],
              quote: advancedPhase.note || "",
              cta: { label: t.cta, url: trackingUrl },
              secondaryLink: advancedPhase.deliverableUrl
                ? { label: t.deliverable, url: advancedPhase.deliverableUrl }
                : null,
              note: t.note,
            }),
          },
          `phase-client-${projectToken}-${advancedPhase.step}`
        ),
      ]);
    } catch (e) {
      console.error("phase advance email failed:", e?.message);
      const retryAdvanceUrl = await advancePhaseUrl(env, projectToken, advancedPhase.step);
      await alertAdmin(
        env,
        "fallo al enviar correos de avance de fase",
        `proyecto: ${proj.brand}\nerror: ${e?.message}\nenlace de gestión: ${retryAdvanceUrl}`
      );
    }
  }

  if (legacyActionToken) {
    await env.LEADS_KV.delete(`phase_action:${legacyActionToken}`).catch(() => {});
  }

  return {
    ok: true,
    finished,
    advancedTitleEs,
    nextTitleEs,
    nextActionUrl,
  };
}

// ── GESTIÓN INTERNA DE FASES Y ENTREGABLES (/advance-phase) ──
async function handlePhaseAdvance(request, env, ctx, url) {
  if (ctx instanceof URL || (ctx && typeof ctx.searchParams === "object")) {
    url = ctx;
    ctx = null;
  }
  if (!env.LEADS_KV || !env.RESEND_API_KEY) {
    return htmlResponse(page("error", "error de configuración", "falta configuración en el servidor."), 500);
  }

  let projectToken = "";
  let step = 0;
  let legacyActionToken = "";

  const pParam = url.searchParams.get("p");
  const stepParam = parseInt(url.searchParams.get("step") || "", 10);
  const tParam = url.searchParams.get("t");
  const legacyToken = url.searchParams.get("token");

  if (pParam || tParam) {
    if (
      !pParam ||
      !/^[a-f0-9]{64}$/.test(pParam) ||
      !Number.isInteger(stepParam) ||
      stepParam < 1 ||
      stepParam > 20 ||
      !tParam ||
      !/^[a-f0-9]{64}$/.test(tParam)
    ) {
      return htmlResponse(page("enlace inválido", "enlace inválido", "el enlace de gestión no es válido."), 400);
    }
    const key = await getKey(env);
    if (!(await verifyRaw(key, `action|${pParam}|${stepParam}`, tParam))) {
      return htmlResponse(page("enlace inválido", "enlace inválido", "la firma del enlace no es válida."), 400);
    }
    projectToken = pParam;
    step = stepParam;
  } else if (legacyToken && /^[a-f0-9]{64}$/.test(legacyToken)) {
    const rawAction = await env.LEADS_KV.get(`phase_action:${legacyToken}`);
    if (!rawAction) {
      return htmlResponse(page("enlace caducado", "acción ya procesada", "este enlace antiguo ya fue utilizado o caducó."), 400);
    }
    const actionData = JSON.parse(rawAction);
    projectToken = actionData.projectToken;
    step = Number(actionData.step);
    legacyActionToken = legacyToken;
  } else {
    return htmlResponse(page("enlace inválido", "enlace inválido", "faltan parámetros en el enlace."), 400);
  }

  const rawProj = await env.LEADS_KV.get(`project:${projectToken}`);
  if (!rawProj) {
    return htmlResponse(page("no encontrado", "proyecto no encontrado", "no hemos encontrado este proyecto en kv."), 404);
  }
  const proj = JSON.parse(rawProj);
  const trackingUrl = buildUrl("/proyecto", { token: projectToken });

  if (!proj.paid) {
    return htmlResponse(
      page("pago pendiente", "proyecto aún sin pagar", `el proyecto ${proj.brand} todavía no figura como pagado.`, {
        eyebrow: "gestión interna",
        footerUrl: trackingUrl,
        footerLabel: "ver página del cliente",
      }),
      400
    );
  }

  // allDone ya declarado al inicio de handleProject
  if (allDone || checkAllServicesApproved(proj)) {
    if (!allDone || !proj.finishedAt || !proj.reviewInvited || proj.status !== "done") {
      await finalizeProjectClosure(env, proj, projectToken).catch((e) =>
        console.error("handlePhaseAdvance auto-finalize failed:", e?.message)
      );
    }
    return htmlResponse(
      page("proyecto finalizado", "proyecto ya finalizado", `todas las fases de ${proj.brand} ya figuran como completadas.`, {
        eyebrow: "gestión interna",
        footerUrl: trackingUrl,
        footerLabel: "ver seguimiento del proyecto",
      }),
      200
    );
  }

  if (Number(proj.currentPhase) !== step) {
    const activeAdvanceUrl = await advancePhaseUrl(env, projectToken, proj.currentPhase);
    return htmlResponse(
      page(
        "fase ya gestionada",
        "esta fase ya avanzó",
        `este enlace correspondía al paso ${step}, pero ${proj.brand} se encuentra ahora en el paso ${proj.currentPhase}.`,
        {
          eyebrow: "gestión interna",
          html: `<a class="btn" href="${esc(activeAdvanceUrl)}">ir al paso actual (${Number(proj.currentPhase)})</a>`,
          footerUrl: trackingUrl,
          footerLabel: "ver página del cliente",
        }
      ),
      200
    );
  }

  const currentPhaseObj =
    proj.phases.find((ph) => ph.step === step) ||
    proj.phases.find((ph) => ph.status === "active" || ph.status === "review");
  if (!currentPhaseObj) {
    return htmlResponse(page("finalizado", "proyecto finalizado", "este proyecto no tiene fases pendientes."), 400);
  }

  const currentTitleEs = phaseTitle(currentPhaseObj, "es");
  const revsMax = currentPhaseObj.maxRevisions || MAX_PHASE_REVISIONS;
  const revsUsed = Math.min(revsMax, Math.max(0, Number(currentPhaseObj.revisionsUsed) || 0));
  const stateLabel =
    currentPhaseObj.status === "review"
      ? `en revisión del cliente (enviada el ${fmtDate(currentPhaseObj.reviewSentAt || currentPhaseObj.date, "es")})`
      : revsUsed > 0
        ? `aplicando ajustes del cliente (ronda ${revsUsed} de ${revsMax})`
        : "en curso en el estudio";

  if (request.method === "GET" || request.method === "HEAD") {
    const materialsList = (Array.isArray(proj.materialsList) ? [...proj.materialsList] : []).filter((m) => {
      if (!m) return false;
      if (m.id === "init" && !m.url && !m.fileId && !m.fileUrl && !m.notes && !m.socials) {
        if (m.domain && !proj.domain) proj.domain = m.domain;
        return false;
      }
      return true;
    });
    if (proj.onboarding && materialsList.length === 0) {
      const ob = proj.onboarding;
      const legacyUrl = cleanHttpsUrl(ob.materials || "", 500);
      const hasRealContent = Boolean(legacyUrl || ob.socials || ob.materials || ob.notes);
      if (hasRealContent) {
        materialsList.push({
          id: "legacy",
          createdAt: ob.submittedAt || ob.receivedAt || "",
          domain: ob.domain || "",
          socials: ob.socials || "",
          notes: legacyUrl ? "" : (ob.materials || ""),
          url: legacyUrl || "",
          fileUrl: "",
          filename: "",
        });
      } else if (ob.domain && !proj.domain) {
        proj.domain = ob.domain;
      }
    }
    const referencesList = Array.isArray(proj.referencesList) ? [...proj.referencesList] : [];

    const matItemsHtml = await Promise.all(
      materialsList.map(async (m, i) => {
        const dateStr = m.createdAt ? fmtDate(m.createdAt, "es") : "";
        const urlLink = cleanHttpsUrl(m.url || "", 500);
        let fileLink = "";
        if (m.fileId) fileLink = await fileDownloadUrl(env, projectToken, "mat", m.fileId);
        else if (m.fileUrl) fileLink = m.fileUrl;
        return `
          <div class="history-item">
            <div class="history-head">
              <span style="font-size:.78rem;font-weight:600;color:#3D5A85;">material #${i + 1}</span>
              ${dateStr ? `<span style="font-size:.74rem;color:#58575E;">${esc(dateStr)}</span>` : ""}
            </div>
            <div class="kv" style="font-size:.82rem;">
              ${m.domain ? `<div class="kv-row"><span>dominio</span><span class="kv-val">${esc(m.domain)}</span></div>` : ""}
              ${m.socials ? `<div class="kv-row"><span>web / redes</span><span class="kv-val">${esc(m.socials)}</span></div>` : ""}
              ${urlLink ? `<div class="kv-row"><span>enlace externo</span><span class="kv-val" style="word-break:break-all;"><a href="${esc(urlLink)}" target="_blank" rel="noopener noreferrer" style="color:#3D5A85;text-decoration:underline;">${esc(urlLink)}</a></span></div>` : ""}
              ${fileLink ? `<div class="kv-row"><span>archivo directo</span><span class="kv-val"><a class="pill-link" href="${esc(fileLink)}" target="_blank" rel="noopener noreferrer">${esc(m.filename || "descargar material")}</a></span></div>` : ""}
            </div>
            ${m.notes ? `<div class="phase-note" style="margin-top:.55rem;">${esc(m.notes)}</div>` : ""}
          </div>`;
      })
    );

    const refItemsHtml = await Promise.all(
      referencesList.map(async (r, i) => {
        const dateStr = r.createdAt ? fmtDate(r.createdAt, "es") : "";
        const urlLink = cleanHttpsUrl(r.url || "", 500);
        let fileLink = "";
        if (r.fileId) fileLink = await fileDownloadUrl(env, projectToken, "ref", r.fileId);
        else if (r.fileUrl) fileLink = r.fileUrl;
        return `
          <div class="history-item">
            <div class="history-head">
              <span style="font-size:.78rem;font-weight:600;color:#825008;">referencia #${i + 1}</span>
              ${dateStr ? `<span style="font-size:.74rem;color:#58575E;">${esc(dateStr)}</span>` : ""}
            </div>
            <div class="kv" style="font-size:.82rem;">
              ${urlLink ? `<div class="kv-row"><span>enlace web</span><span class="kv-val" style="word-break:break-all;"><a href="${esc(urlLink)}" target="_blank" rel="noopener noreferrer" style="color:#3D5A85;text-decoration:underline;">${esc(urlLink)}</a></span></div>` : ""}
              ${fileLink ? `<div class="kv-row"><span>captura / archivo</span><span class="kv-val"><a class="pill-link" href="${esc(fileLink)}" target="_blank" rel="noopener noreferrer">${esc(r.filename || "descargar referencia")}</a></span></div>` : ""}
            </div>
            ${r.notes ? `<div class="phase-note" style="margin-top:.55rem;">${esc(r.notes)}</div>` : ""}
          </div>`;
      })
    );

    const obHtml = matItemsHtml.length
      ? `<div class="box">
          <span class="eyebrow">materiales aportados por el cliente</span>
          ${matItemsHtml.join("")}
        </div>`
      : "";

    const refHtml = refItemsHtml.length
      ? `<div class="box">
          <span class="eyebrow">referencias visuales del cliente</span>
          ${refItemsHtml.join("")}
        </div>`
      : "";

    const revsHtml =
      Array.isArray(currentPhaseObj.revisions) && currentPhaseObj.revisions.length
        ? `<div class="box review-box">
            <span class="eyebrow">historial de ajustes solicitados por el cliente</span>
            ${currentPhaseObj.revisions
              .map(
                (rv) => `<div style="margin-bottom:.75rem;">
                  <span style="display:block;font-size:.75rem;font-weight:600;color:#825008;margin-bottom:.25rem;">ronda ${Number(rv.round) || 1} de ${revsMax}${rv.requestedAt ? ` — ${esc(fmtDate(rv.requestedAt, "es"))}` : ""}</span>
                  <div class="phase-note" style="margin-top:0;">${esc(rv.text || "")}</div>
                </div>`
              )
              .join("")}
          </div>`
        : "";

    const html = `
      <div class="box">
        <div class="kv">
          <div class="kv-row"><span>proyecto</span><span class="kv-val">${esc(proj.brand)}</span></div>
          <div class="kv-row"><span>cliente</span><span class="kv-val">${esc(proj.clientEmail)}</span></div>
          <div class="kv-row"><span>idioma</span><span class="kv-val">${esc(proj.lang)}</span></div>
          ${proj.domain ? `<div class="kv-row"><span>dominio preferido</span><span class="kv-val">${esc(proj.domain)}</span></div>` : ""}
          <div class="kv-row"><span>servicios</span><span class="kv-val">${esc(svcLabel(proj.services, "es"))}</span></div>
          <div class="kv-row"><span>fase actual</span><span class="kv-val">paso ${currentPhaseObj.step} — ${esc(currentTitleEs)}</span></div>
          <div class="kv-row"><span>estado</span><span class="kv-val">${esc(stateLabel)}</span></div>
          <div class="kv-row"><span>rondas de revisión usadas</span><span class="kv-val">${revsUsed} de ${revsMax}</span></div>
        </div>
      </div>
      ${obHtml}
      ${refHtml}
      ${revsHtml}
      <form method="POST" enctype="multipart/form-data" style="text-align:left;">
        <label for="deliverable_file">1. subir archivo directo del entregable (opcional, cualquier formato)</label>
        <input id="deliverable_file" name="deliverable_file" type="file">
        <span class="file-note">acepta cualquier formato (pdf, zip, png, jpg, svg, webp, mp4...) hasta 25 mb.</span>
        <label for="deliverable_url">2. o pegar enlace externo (opcional si subes archivo, ej. github pages o figma)</label>
        <input id="deliverable_url" name="deliverable_url" type="url" maxlength="500" placeholder="https://..." value="${esc(currentPhaseObj.deliverableUrl || "")}">
        <label for="note">nota para el cliente (opcional)</label>
        <textarea id="note" name="note" rows="4" maxlength="600" placeholder="contexto breve sobre la entrega, qué revisar o pasos siguientes...">${esc(currentPhaseObj.note || "")}</textarea>
        <button type="submit" name="decision" value="review">${currentPhaseObj.key === "delivery" ? "completar entrega final y cerrar proyecto" : "enviar propuesta a revisión del cliente"}</button>
      </form>
    `;

    return htmlResponse(
      page(
        `gestionar fase — ${proj.brand}`,
        "gestionar fase del proyecto",
        "puedes subir un entregable o indicar un enlace para que el cliente lo revise y valide por escrito en su panel privado.",
        {
          eyebrow: "panel interno del estudio",
          wide: true,
          html,
          footerUrl: trackingUrl,
          footerLabel: "ver página pública del cliente",
        }
      ),
      200
    );
  }

  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
  }

  const form = await request.formData().catch(() => null);
  const currentManageUrl = await advancePhaseUrl(env, projectToken, step);

  const rawUrl = String(form?.get("deliverable_url") ?? form?.get("deliverableUrl") ?? "").trim();
  const directUrl = cleanHttpsUrl(rawUrl, 500);
  if (rawUrl && !directUrl) {
    return htmlResponse(
      page(
        "enlace inválido",
        "revisa el enlace del entregable",
        "el enlace al entregable debe usar https:// (por ejemplo https://drive.google.com/...). vuelve atrás y corrígelo o déjalo vacío si subes un archivo directo.",
        {
          eyebrow: "panel interno del estudio",
          footerUrl: currentManageUrl,
          footerLabel: "volver a la fase",
        }
      ),
      400
    );
  }

  const delivFile = form?.get("deliverable_file");
  let uploadedFileUrl = "";
  let uploadedFilename = "";

  if (
    delivFile &&
    typeof delivFile === "object" &&
    typeof delivFile.arrayBuffer === "function" &&
    delivFile.size > 0
  ) {
    if (delivFile.size > 25 * 1024 * 1024) {
      return htmlResponse(
        page(
          "archivo demasiado grande",
          "tamaño de archivo superado",
          "el archivo supera el límite de 25 mb admitido para subida directa. para archivos más pesados, compártelo mediante un enlace externo (drive, wetransfer o dropbox) en el campo inferior.",
          {
            eyebrow: "panel interno del estudio",
            footerUrl: currentManageUrl,
            footerLabel: "volver a la fase",
          }
        ),
        400
      );
    }
    const fileId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const arrayBuf = await delivFile.arrayBuffer();
    uploadedFilename = safeFilename(delivFile.name, `entregable-fase-${step}`);
    const contentType = cleanInput(delivFile.type, 100) || "application/octet-stream";
    await env.LEADS_KV.put(`file:${projectToken}:${step}:${fileId}`, arrayBuf, {
      metadata: {
        filename: uploadedFilename,
        contentType,
        size: delivFile.size,
        createdAt: new Date().toISOString(),
      },
    });
    uploadedFileUrl = await fileDownloadUrl(env, projectToken, step, fileId);
  }

  const effectiveDeliverableUrl = uploadedFileUrl || directUrl || currentPhaseObj.deliverableUrl || "";
  const effectiveDeliverableFilename =
    uploadedFilename || (uploadedFileUrl ? uploadedFilename : (!directUrl ? currentPhaseObj.deliverableFilename || "" : ""));

  if (!effectiveDeliverableUrl) {
    return htmlResponse(
      page(
        "entregable obligatorio",
        "falta el entregable de la fase",
        "es obligatorio adjuntar un archivo o indicar un enlace al entregable antes de enviar la propuesta al cliente.",
        {
          eyebrow: "panel interno del estudio",
          footerUrl: currentManageUrl,
          footerLabel: "volver a la fase",
        }
      ),
      400
    );
  }

  const note = cleanNote(form?.get("note") ?? "", 600);
  const decision = String(form?.get("decision") ?? "review");

  if (currentPhaseObj.key === "delivery") {
    const now = new Date().toISOString();
    currentPhaseObj.status = "done";
    currentPhaseObj.date = now;
    currentPhaseObj.deliverableUrl = effectiveDeliverableUrl;
    if (effectiveDeliverableFilename) {
      currentPhaseObj.deliverableFilename = effectiveDeliverableFilename;
    }
    currentPhaseObj.note = note;

    await finalizeProjectClosure(env, proj, projectToken, {
      deliverableUrl: effectiveDeliverableUrl,
      deliverableFilename: effectiveDeliverableFilename,
      note,
    });

    return htmlResponse(
      page(
        "¡enviado correctamente!",
        "entrega final completada",
        `has completado la entrega final de ${proj.brand}. se han enviado los archivos definitivos y la invitación a valorar al cliente.`,
        {
          eyebrow: "panel interno del estudio",
          html: `<div class="notice-box"><p>aviso: el proyecto ha finalizado con éxito y el cliente ha recibido la notificación y los archivos.</p></div><a class="btn" href="${esc(trackingUrl)}">ver página pública del cliente</a>`,
          footerUrl: trackingUrl,
          footerLabel: "ver página pública del cliente",
        }
      ),
      200
    );
  }

  if (decision === "review") {
    const now = new Date().toISOString();
    proj.lastClientActivityAt = Date.now();
    currentPhaseObj.status = "review";
    currentPhaseObj.reviewSentAt = now;
    currentPhaseObj.deliverableUrl = effectiveDeliverableUrl;
    if (effectiveDeliverableFilename) {
      currentPhaseObj.deliverableFilename = effectiveDeliverableFilename;
    } else {
      delete currentPhaseObj.deliverableFilename;
    }
    currentPhaseObj.note = note;
    delete currentPhaseObj.reminderSentAt;
    delete currentPhaseObj.tacitAlertSentAt;

    const lang = pickLang(proj.lang);
    const tp = EM[lang].proposal;
    const phaseNameClient = phaseTitle(currentPhaseObj, lang);
    const clientApproveUrl = await approvePhaseUrl(env, projectToken, step);

    try {
      await resendSend(
        env,
        {
          to: [proj.clientEmail],
          reply_to: "hola@rebrandyourbrand.es",
          subject: tp.subject(proj.brand, phaseNameClient),
          ...renderEmail(lang, {
            paras: [
              tp.hello,
              tp.intro(bold(proj.brand), bold(phaseNameClient)),
              effectiveDeliverableUrl
                ? `${tp.openDeliverable}: <a href="${esc(effectiveDeliverableUrl)}" target="_blank" style="color:#3D5A85;font-weight:600;">${esc(effectiveDeliverableFilename || effectiveDeliverableUrl)}</a>`
                : "",
            ].filter(Boolean),
            quote: note,
            cta: { label: tp.cta, url: clientApproveUrl },
            secondaryLink: { label: EM[lang].phase.cta, url: trackingUrl },
            note: tp.revisions,
          }),
        },
        `proposal-${projectToken}-${step}-${Date.now()}`
      );

      await saveProject(env, projectToken, proj);
    } catch (e) {
      console.error("proposal email failed:", e?.message);
      return htmlResponse(
        page(
          "error al enviar",
          "no se ha podido enviar el correo",
          "ha fallado el envío a través de resend, así que la fase no se ha modificado. inténtalo de nuevo en unos minutos.",
          {
            eyebrow: "panel interno del estudio",
            footerUrl: currentManageUrl,
            footerLabel: "volver a intentarlo",
          }
        ),
        500
      );
    }

    return htmlResponse(
      page(
        "¡enviado correctamente!",
        "propuesta enviada a revisión con éxito",
        `hemos avisado a ${proj.clientEmail} con el enlace para revisar y validar por escrito "${currentTitleEs}".`,
        {
          eyebrow: "panel interno del estudio",
          html: `<div class="notice-box"><p>aviso: esta acción ya ha quedado registrada en el sistema y el cliente ha recibido la notificación para revisar la propuesta.</p></div><a class="btn" href="${esc(currentManageUrl)}">volver al panel de esta fase</a>`,
          footerUrl: trackingUrl,
          footerLabel: "ver página pública del cliente",
        }
      ),
      200
    );
  }

  return htmlResponse(
    page(
      "acción no permitida",
      "validación obligatoria del cliente",
      "la progresión del proyecto depende exclusivamente de la aprobación por escrito del cliente (cláusula 3.3). no es posible completar fases unilateralmente.",
      {
        eyebrow: "panel interno del estudio",
        footerUrl: currentManageUrl,
        footerLabel: "volver a la fase",
      }
    ),
    400
  );
}

// ── REVISIÓN, SOLICITUD DE AJUSTES Y APROBACIÓN ESCRITA POR EL CLIENTE (/approve-phase) ──
async function handlePhaseApprove(request, env, ctx, url) {
  if (ctx instanceof URL || (ctx && typeof ctx.searchParams === "object")) {
    url = ctx;
    ctx = null;
  }
  let L = langFromRequest(request);
  const p = url.searchParams.get("p");
  const step = parseInt(url.searchParams.get("step") || "", 10);
  const t = url.searchParams.get("t");

  if (
    !p ||
    !/^[a-f0-9]{64}$/.test(p) ||
    !Number.isInteger(step) ||
    step < 1 ||
    step > 20 ||
    !t ||
    !/^[a-f0-9]{64}$/.test(t)
  ) {
    return msgPage(L, "invalid", 400);
  }
  if (!env.LEADS_KV || !env.RESEND_API_KEY) return msgPage(L, "config", 500);

  const key = await getKey(env);
  if (!(await verifyRaw(key, `approve|${p}|${step}`, t))) return msgPage(L, "invalid", 400);

  const rawProj = await env.LEADS_KV.get(`project:${p}`);
  if (!rawProj) return msgPage(L, "trackMissing", 404);

  const proj = JSON.parse(rawProj);
  L = pickLang(proj.lang);
  const A = PG[L].ap;
  const T = PG[L].tr;
  const trackingUrl = buildUrl("/proyecto", { token: p });

  const ph = (proj.phases || []).find((x) => x.step === step);
  if (!ph || !proj.paid) return msgPage(L, "invalid", 400);

  if (ph.status === "done" || Number(proj.currentPhase) !== step) {
    const isCompleted = proj.status === "done" || checkAllServicesApproved(proj);
    const completedInfo = isCompleted && A.completed ? A.completed : A.already;
    let reviewBtn = "";
    if (isCompleted) {
      const revUrl = await reviewUrl(env, p);
      if (revUrl) {
        reviewBtn = `<a class="btn" href="${esc(revUrl)}" style="margin-bottom:.75rem;">${esc(PG[L].common?.openReview || "dejar valoración del proyecto")}</a>`;
      }
    }
    return htmlResponse(
      page(completedInfo[0], completedInfo[1], completedInfo[2], {
        lang: L,
        eyebrow: A.eyebrow,
        html: `${reviewBtn}<a class="btn secondary" href="${esc(trackingUrl)}">${esc(PG[L].common.openTracker)}</a>`,
        footerUrl: trackingUrl,
        footerLabel: PG[L].common.openTracker,
      }),
      200
    );
  }

  const maxRevs = ph.maxRevisions || MAX_PHASE_REVISIONS;
  const used = Math.min(maxRevs, Math.max(0, Number(ph.revisionsUsed) || 0));
  const nextRound = used + 1;

  if (ph.status === "active" && used > 0) {
    return htmlResponse(
      page(A.revWorking[0], A.revWorking[1], A.revWorking[2](used, maxRevs), {
        lang: L,
        eyebrow: A.eyebrow,
        html: `<a class="btn" href="${esc(trackingUrl)}">${esc(PG[L].common.openTracker)}</a>`,
        footerUrl: trackingUrl,
        footerLabel: PG[L].common.openTracker,
      }),
      200
    );
  }

  const renderReviewScreen = (revError = "", statusCode = 200) => {
    const unlockedBanner =
      url.searchParams.get("unlocked") === "1" ? `<div class="banner-ok">${esc(A.unlockedBanner)}</div>` : "";

    const detailHtml =
      ph.note || ph.deliverableUrl || used > 0 || unlockedBanner
        ? `<div class="box">
            ${unlockedBanner}
            ${ph.note ? `<p style="font-size:.84rem;color:#17171A;margin-bottom:${ph.deliverableUrl || used > 0 ? ".75rem" : "0"};white-space:pre-wrap;"><strong>${esc(T.studioNote)}:</strong> ${esc(ph.note)}</p>` : ""}
            ${ph.deliverableUrl ? `<a class="pill-link" href="${esc(ph.deliverableUrl)}" target="_blank" rel="noopener noreferrer">${esc(ph.deliverableFilename ? `${A.deliverable} (${ph.deliverableFilename})` : A.deliverable)}</a>` : ""}
            ${used > 0 ? `<p style="font-size:.75rem;color:#58575E;margin-top:${ph.deliverableUrl ? ".65rem" : "0"};">${esc(A.roundsUsed(used, maxRevs))}</p>` : ""}
          </div>`
        : "";

    const canRevise = ph.status === "review" && used < maxRevs;
    const reviseHtml = canRevise
      ? `<details class="rev-details"${revError ? " open" : ""}>
          <summary class="btn secondary">${esc(A.revToggle(nextRound, maxRevs))}</summary>
          <div class="rev-body">
            ${revError ? `<p class="rev-err">${esc(revError)}</p>` : ""}
            <form method="POST">
              <input type="hidden" name="decision" value="revise">
              <label for="feedback">${esc(A.revLabel(nextRound, maxRevs))}</label>
              <textarea id="feedback" name="feedback" rows="4" minlength="5" maxlength="1500" required placeholder="${esc(A.revPh)}"></textarea>
              <button type="submit">${esc(A.revSubmit(nextRound, maxRevs))}</button>
            </form>
          </div>
        </details>`
      : used >= maxRevs
        ? `<div class="box" style="margin-top:.85rem;margin-bottom:.85rem;font-size:.82rem;color:#58575E;">
            <p style="margin-bottom:.75rem;">${esc(A.revExhausted)}</p>
            ${revError ? `<p class="rev-err" style="margin-bottom:.75rem;">${esc(revError)}</p>` : ""}
            <form method="POST">
              <input type="hidden" name="decision" value="buy_revision">
              <button type="submit" class="btn secondary">${esc(A.btnBuyRevision)} (+100 €)</button>
            </form>
          </div>`
        : "";

    const bodyHtml = `${detailHtml}<p class="lead" style="font-size:.82rem;margin-bottom:1.25rem;">${esc(A.legal)}</p><form method="POST"><input type="hidden" name="decision" value="approve"><button type="submit">${esc(A.btn)}</button></form>${reviseHtml}`;

    return htmlResponse(
      page(A.title, A.heading, A.intro(phaseTitle(ph, L), proj.brand), {
        lang: L,
        eyebrow: A.eyebrow,
        html: bodyHtml,
        footerUrl: trackingUrl,
        footerLabel: PG[L].common.openTracker,
      }),
      statusCode
    );
  };

  if (request.method === "GET" || request.method === "HEAD") {
    const revSessionId = url.searchParams.get("rev_session_id");
    if (revSessionId && /^cs_[A-Za-z0-9_]+$/.test(revSessionId)) {
      const unlocked = await unlockExtraRevision(env, proj, step, revSessionId);
      if (unlocked) {
        return redirectTo(buildUrl("/approve-phase", { p, step: String(step), t, unlocked: "1" }));
      }
    }
    return renderReviewScreen();
  }

  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
  }

  if (ph.status !== "review") {
    if (ph.status === "done") {
      const isCompleted = proj.status === "done" || proj.phases.every((item) => item.status === "done");
      const completedInfo = isCompleted ? A.doneLast : A.donePhase(phaseTitle(ph, L));
      let reviewBtn = "";
      if (isCompleted) {
        const revUrl = await reviewUrl(env, p);
        if (revUrl) {
          reviewBtn = `<a class="btn" href="${esc(revUrl)}" style="margin-bottom:.75rem;">${esc(PG[L].common?.openReview || "dejar valoración del proyecto")}</a>`;
        }
      }
      return htmlResponse(
        page(completedInfo[0], completedInfo[1], completedInfo[2], {
          lang: L,
          eyebrow: A.eyebrow,
          html: `${reviewBtn}<a class="btn secondary" href="${esc(trackingUrl)}">${esc(PG[L].common.openTracker)}</a>`,
          footerUrl: trackingUrl,
          footerLabel: PG[L].common.openTracker,
        }),
        200
      );
    }
    if (ph.status === "active" && used > 0) {
      return htmlResponse(
        page(A.revWorking[0], A.revWorking[1], A.revWorking[2](used, maxRevs), {
          lang: L,
          eyebrow: A.eyebrow,
          html: `<a class="btn" href="${esc(trackingUrl)}">${esc(PG[L].common.openTracker)}</a>`,
          footerUrl: trackingUrl,
          footerLabel: PG[L].common.openTracker,
        }),
        200
      );
    }
    return redirectTo(trackingUrl);
  }

  const form = await request.formData().catch(() => null);
  const decision = String(form?.get("decision") || "approve");

  if (decision === "buy_revision") {
    const qJoin = String.fromCharCode(38);
    const returnUrl = `${WORKER_URL}/approve-phase?p=${p}${qJoin}step=${step}${qJoin}t=${t}${qJoin}rev_session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${WORKER_URL}/approve-phase?p=${p}${qJoin}step=${step}${qJoin}t=${t}`;
    const checkoutUrl = await createExtraRevisionCheckout(env, proj, step, returnUrl, cancelUrl);
    if (!checkoutUrl) {
      return renderReviewScreen(A.stripeError, 500);
    }
    return redirectTo(checkoutUrl);
  }

  if (decision === "revise") {
    if (ph.status !== "review" || used >= maxRevs) {
      return renderReviewScreen("", 400);
    }
    const feedback = cleanNote(form?.get("feedback") ?? "", 1500);
    if (!feedback || feedback.length < 5) {
      return renderReviewScreen(A.revEmpty, 400);
    }

    const now = new Date().toISOString();
    const round = nextRound;
    const phaseTitleEs = phaseTitle(ph, "es");
    const manageUrl = await advancePhaseUrl(env, p, step);

    // 1. Consolidar inmediatamente el estado en KV
    ph.revisionsUsed = round;
    if (!Array.isArray(ph.revisions)) ph.revisions = [];
    ph.revisions.push({ round, text: feedback, requestedAt: now });
    ph.status = "active";
    ph.lastRevisionAt = now;
    delete ph.reminderSentAt;
    delete ph.tacitAlertSentAt;
    delete proj.abandonWarningSentAt;
    await saveProject(env, p, proj);

    // 2. Enviar notificación al estudio de forma resiliente
    const emailNotice = async () => {
      try {
        await resendSend(
          env,
          {
            to: ["hola@rebrandyourbrand.es"],
            reply_to: proj.clientEmail,
            subject: `ajustes solicitados (ronda ${round} de ${maxRevs}) — "${phaseTitleEs}" — ${proj.brand}`,
            ...renderEmail("es", {
              paras: [
                "el cliente ha solicitado ajustes directamente desde la página de revisión de fase.",
                lines(
                  `— proyecto: ${bold(proj.brand)}`,
                  `— cliente: ${bold(proj.clientEmail)}`,
                  `— fase: ${bold(`paso ${ph.step} — ${phaseTitleEs}`)}`,
                  `— ronda consumida: ${bold(`ronda ${round} de ${maxRevs}`)}`,
                  `— fecha (iso): ${bold(now)}`
                ),
                "cambios solicitados por el cliente:",
              ],
              quote: feedback,
              cta: { label: "abrir panel de la fase para subir nueva versión", url: manageUrl },
              secondaryLink: { label: "ver seguimiento público del cliente", url: trackingUrl },
              note:
                round >= maxRevs
                  ? "esta ha sido la última ronda incluida en esta fase. el cliente puede desbloquear rondas adicionales directamente por 100 € (cláusula 1.2)."
                  : "cuando tengas lista la propuesta ajustada, vuelve a enviarla a revisión desde el panel de la fase.",
            }),
          },
          `revise-admin-${p}-${step}-r${round}`
        );
      } catch (e) {
        console.error("revision request email failed:", e?.message);
        await alertAdmin(
          env,
          `fallo al notificar solicitud de ajustes (${proj.brand})`,
          `proyecto: ${proj.brand}\nerror: ${e?.message}\nenlace de gestión: ${manageUrl}`,
          ctx
        );
      }
    };

    if (ctx?.waitUntil) {
      ctx.waitUntil(emailNotice());
    } else {
      await emailNotice();
    }

    const noticeText = PG[L].tr?.actionRegisteredNotice || "aviso: esta acción ya ha quedado registrada en el sistema y nuestro equipo ha recibido la notificación para continuar con el trabajo.";
    return htmlResponse(
      page(A.revDone[0], A.revDone[1], A.revDone[2](round, maxRevs), {
        lang: L,
        eyebrow: A.eyebrow,
        html: `<div class="notice-box"><p>${esc(noticeText)}</p></div><a class="btn" href="${esc(trackingUrl)}">${esc(PG[L].common.openTracker)}</a>`,
        footerUrl: trackingUrl,
        footerLabel: PG[L].common.openTracker,
      }),
      200
    );
  }

  const res = await completeProjectPhase(env, proj, p, {
    step,
    approvedBy: "client",
    deliverableUrl: ph.deliverableUrl || "",
    deliverableFilename: ph.deliverableFilename || "",
    note: ph.note || "",
  });

  if (!res.ok && res.reason === "email_failed") return errorPage(L);

  const noticeText = PG[L].tr?.actionRegisteredNotice || "aviso: esta acción ya ha quedado registrada en el sistema y nuestro equipo ha recibido la notificación para continuar con el trabajo.";
  const succ = res.finished && A.completed ? A.completed : A.done;
  let reviewBtn = "";
  if (res.finished) {
    const revUrl = await reviewUrl(env, p);
    if (revUrl) {
      reviewBtn = `<a class="btn" href="${esc(revUrl)}" style="margin-bottom:.75rem;">${esc(PG[L].common?.openReview || "dejar valoración del proyecto")}</a>`;
    }
  }
  return htmlResponse(
    page(succ[0], succ[1], succ[2], {
      lang: L,
      eyebrow: A.eyebrow,
      html: `<div class="notice-box"><p>${esc(noticeText)}</p></div>${reviewBtn}<a class="btn secondary" href="${esc(trackingUrl)}">${esc(PG[L].common.openTracker)}</a>`,
      footerUrl: trackingUrl,
      footerLabel: PG[L].common.openTracker,
    }),
    200
  );
}

// ── BAJA EN UN CLIC DE LA RENOVACIÓN ANUAL (/cancel-renewal) ──
async function handleCancelRenewal(request, env, ctx, url) {
  if (ctx instanceof URL || (ctx && typeof ctx.searchParams === "object")) {
    url = ctx;
    ctx = null;
  }
  let L = langFromRequest(request);
  const p = url.searchParams.get("p");
  const due = url.searchParams.get("due") || "";
  const t = url.searchParams.get("t");

  if (!p || !/^[a-f0-9]{64}$/.test(p) || !due || due.length > 40 || !t || !/^[a-f0-9]{64}$/.test(t)) {
    return msgPage(L, "invalid", 400);
  }
  if (!env.LEADS_KV) return msgPage(L, "config", 500);

  const key = await getKey(env);
  if (!(await verifyRaw(key, `crenew|${p}|${due}`, t))) return msgPage(L, "invalid", 400);

  const rawProj = await env.LEADS_KV.get(`project:${p}`);
  if (!rawProj) return msgPage(L, "trackMissing", 404);

  const proj = JSON.parse(rawProj);
  L = pickLang(proj.lang);
  const RN = PG[L].rn;
  const trackingUrl = buildUrl("/proyecto", { token: p });

  const hasWeb = Boolean(
    proj.includesWeb || (Array.isArray(proj.services) && proj.services.includes("web"))
  );
  if (!proj.paid || !hasWeb) {
    return msgPage(L, "trackInvalid", 400);
  }

  const currentDue = String(proj.renewalNextDue || proj.nextRenewalAt || "");
  if (due && currentDue && due !== currentDue && due !== String(proj.nextRenewalAt || "") && due !== String(proj.renewalNextDue || "")) {
    return msgPage(L, "trackInvalid", 400);
  }

  const dueFormatted = fmtDate(proj.nextRenewalAt || due, L);

  if (proj.renewalCanceled) {
    return htmlResponse(
      page(RN.already[0], RN.already[1], RN.already[2], {
        lang: L,
        eyebrow: RN.eyebrow,
        footerUrl: trackingUrl,
        footerLabel: PG[L].common.openTracker,
      }),
      200
    );
  }

  if (request.method === "GET" || request.method === "HEAD") {
    return htmlResponse(
      page(RN.title, RN.heading, RN.intro(proj.brand, dueFormatted), {
        lang: L,
        eyebrow: RN.eyebrow,
        form: true,
        formLabel: RN.btn,
        footerUrl: trackingUrl,
        footerLabel: PG[L].common.openTracker,
      }),
      200
    );
  }

  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
  }

  proj.renewalCanceled = true;
  proj.renewalCanceledAt = new Date().toISOString();
  await saveProject(env, p, proj);
  await alertAdmin(
    env,
    `baja de renovación anual confirmada — ${proj.brand}`,
    `cliente: ${proj.clientEmail}\nmarca: ${proj.brand}\nvencimiento del periodo actual: ${fmtDate(proj.nextRenewalAt || due, "es")}`
  );

  return htmlResponse(
    page(RN.done[0], RN.done[1], RN.done[2], {
      lang: L,
      eyebrow: RN.eyebrow,
      html: `<a class="btn secondary" href="${esc(trackingUrl)}">${esc(PG[L].common.openTracker)}</a>`,
      footerUrl: trackingUrl,
      footerLabel: PG[L].common.openTracker,
    }),
    200
  );
}

// ── REDIRECCIÓN PERSISTENTE DE RENOVACIÓN (/renovar) ──
async function handleRenewalRedirect(request, env, ctx, url) {
  if (ctx instanceof URL || (ctx && typeof ctx.searchParams === "object")) {
    url = ctx;
    ctx = null;
  }
  let L = langFromRequest(request);
  const p = url.searchParams.get("p");
  const t = url.searchParams.get("t");
  if (!p || !/^[a-f0-9]{64}$/.test(p) || !t || !/^[a-f0-9]{64}$/.test(t)) {
    return msgPage(L, "invalid", 400);
  }
  const key = await getKey(env);
  if (!(await verifyRaw(key, `renew|${p}`, t))) {
    return msgPage(L, "invalid", 400);
  }
  if (!env.LEADS_KV) return msgPage(L, "config", 500);
  const raw = await env.LEADS_KV.get(`project:${p}`);
  if (!raw) return msgPage(L, "trackMissing", 404);
  const proj = JSON.parse(raw);
  L = pickLang(proj.lang);
  if (!proj.paid || !Array.isArray(proj.services) || !proj.services.includes("web")) {
    return msgPage(L, "invalid", 400);
  }

  const now = Date.now();
  if (
    proj.renewalCheckoutUrl &&
    proj.renewalCheckoutCreatedAt &&
    now - Number(proj.renewalCheckoutCreatedAt) < 20 * 3600 * 1000
  ) {
    return redirectTo(proj.renewalCheckoutUrl);
  }

  const rawRenewal =
    env.WEB_RENEWAL_EUR !== undefined && String(env.WEB_RENEWAL_EUR).trim() !== ""
      ? Number(env.WEB_RENEWAL_EUR)
      : WEB_RENEWAL_EUR;
  const renewalEur = Number.isFinite(rawRenewal) && rawRenewal >= 0 ? rawRenewal : WEB_RENEWAL_EUR;
  const checkoutUrl = await createRenewalCheckout(env, proj, renewalEur);
  if (!checkoutUrl) {
    return paymentRetryPage(L);
  }

  proj.renewalCheckoutUrl = checkoutUrl;
  proj.renewalCheckoutCreatedAt = now;
  await saveProject(env, p, proj);

  return redirectTo(checkoutUrl);
}

// ── DESCARGA DIRECTA DE ENTREGABLES (/file) ──
async function handleFileDownload(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  const p = url.searchParams.get("p");
  const step = String(url.searchParams.get("step") || "").trim();
  const id = url.searchParams.get("id");
  const t = url.searchParams.get("t");

  if (
    !p ||
    !/^[a-f0-9]{64}$/.test(p) ||
    !step ||
    !/^[a-zA-Z0-9_-]{1,32}$/.test(step) ||
    !id ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(id) ||
    !t ||
    !/^[a-f0-9]{64}$/.test(t)
  ) {
    return new Response("parámetros de archivo incompletos o inválidos", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" },
    });
  }

  const key = await getKey(env);
  if (!(await verifyRaw(key, `file|${p}|${step}|${id}`, t))) {
    return new Response("enlace de archivo no válido o firma incorrecta", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" },
    });
  }

  if (!env.LEADS_KV) {
    return new Response("error de configuración en el servidor", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" },
    });
  }

  const { value, metadata } = await env.LEADS_KV.getWithMetadata(`file:${p}:${step}:${id}`, {
    type: "arrayBuffer",
  });

  if (!value) {
    return new Response("archivo no encontrado o expirado", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" },
    });
  }

  const fallbackName = step === "mat" ? "material" : (step === "ref" ? "referencia" : `entregable-fase-${step}`);
  const filename = metadata?.filename || fallbackName;
  const safeName = safeFilename(filename, fallbackName);
  const contentType = metadata?.contentType || "application/octet-stream";
  const size = metadata?.size || value.byteLength;
  const encodedName = encodeURIComponent(safeName);

  const SAFE_INLINE_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "application/pdf",
  ]);
  const dispositionType = SAFE_INLINE_TYPES.has(contentType.toLowerCase()) ? "inline" : "attachment";

  return new Response(value, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${dispositionType}; filename="${safeName.replace(/["\r\n\\]/g, "_")}"; filename*=UTF-8''${encodedName}`,
      "Content-Length": String(size),
      "Cache-Control": "private, max-age=86400",
      "Content-Security-Policy": "sandbox",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

async function checkProjectChatRateLimit(env, token, ip) {
  if (env.CHAT_LIMITER) {
    const { success } = await env.CHAT_LIMITER.limit({ key: `pc:${token.slice(0, 16)}:${ipKey(ip)}` });
    if (!success) return false;
  }
  if (env.LEADS_KV) {
    const rlKey = `rl:pchat:${token}:${ipKey(ip)}`;
    const current = await env.LEADS_KV.get(rlKey);
    const count = current ? parseInt(current, 10) : 0;
    if (count >= 12) return false;
    await env.LEADS_KV.put(rlKey, String(count + 1), { expirationTtl: 600 });
  }
  return true;
}

// Envío diferido de notificación de materiales cuando finaliza el timer o se pulsa la X
async function flushPendingMaterialsNotice(env, token, proj) {
  if (!proj || !proj.pendingMaterialsNotice) return;
  const notice = proj.pendingMaterialsNotice;
  delete proj.pendingMaterialsNotice;

  const matItem = Array.isArray(proj.materialsList) ? proj.materialsList.find((m) => m && m.id === notice.matId) : null;
  const refItem = Array.isArray(proj.referencesList) ? proj.referencesList.find((r) => r && r.id === notice.refId) : null;

  await saveProject(env, token, proj);

  if (!env.RESEND_API_KEY || (!matItem && !refItem)) {
    return;
  }

  const projectPageUrl = buildUrl("/proyecto", { token });
  const manageUrl = await advancePhaseUrl(env, token, proj.currentPhase || 1);
  const addedLines = [];

  if (matItem) {
    addedLines.push(bold("materiales del negocio aportados:"));
    if (matItem.domain) addedLines.push(`— dominio: ${bold(matItem.domain)}`);
    if (matItem.socials) addedLines.push(`— web / redes: ${bold(matItem.socials)}`);
    if (matItem.url) addedLines.push(`— enlace externo: <a href="${esc(matItem.url)}" target="_blank" style="color:#3D5A85;font-weight:600;">${esc(matItem.url)}</a>`);
    let fileLink = "";
    if (matItem.fileId) fileLink = await fileDownloadUrl(env, token, "mat", matItem.fileId);
    else if (matItem.fileUrl) fileLink = matItem.fileUrl;
    if (fileLink) addedLines.push(`— archivo directo: <a href="${esc(fileLink)}" target="_blank" style="color:#3D5A85;font-weight:600;">${esc(matItem.filename || "descargar archivo")}</a>`);
    if (matItem.notes) addedLines.push(`— notas: ${esc(matItem.notes)}`);
  }

  if (refItem) {
    if (addedLines.length) addedLines.push("");
    addedLines.push(bold("referencias visuales e inspiración:"));
    if (refItem.url) addedLines.push(`— enlace de referencia: <a href="${esc(refItem.url)}" target="_blank" style="color:#3D5A85;font-weight:600;">${esc(refItem.url)}</a>`);
    let refFileLink = "";
    if (refItem.fileId) refFileLink = await fileDownloadUrl(env, token, "ref", refItem.fileId);
    else if (refItem.fileUrl) refFileLink = refItem.fileUrl;
    if (refFileLink) addedLines.push(`— captura o imagen: <a href="${esc(refFileLink)}" target="_blank" style="color:#3D5A85;font-weight:600;">${esc(refItem.filename || "descargar referencia")}</a>`);
    if (refItem.notes) addedLines.push(`— qué le gusta: ${esc(refItem.notes)}`);
  }

  const subjectType = matItem && refItem
    ? "nuevos materiales y referencias recibidos"
    : (refItem ? "nuevas referencias visuales recibidas" : "nuevos materiales recibidos");

  await resendSend(
    env,
    {
      to: ["hola@rebrandyourbrand.es"],
      reply_to: proj.clientEmail,
      subject: `${subjectType} — ${proj.brand}`,
      ...renderEmail("es", {
        paras: [
          `el cliente ha aportado nueva información para ${bold(proj.brand)}.`,
          `— cliente: ${bold(proj.clientEmail)}`,
          ...addedLines,
        ],
        cta: { label: "abrir gestión de la fase actual", url: manageUrl },
        secondaryLink: { label: "ver seguimiento del cliente", url: projectPageUrl },
      }),
    },
    `materials-${token}-${notice.timestamp}`
  ).catch((e) => console.error("materials email failed:", e?.message));
}

// ── SEGUIMIENTO DEL PROYECTO, RESCATE DE PAGO Y ONBOARDING (/proyecto) ──
async function handleProject(request, env, ctx, url) {
  if (ctx instanceof URL || (ctx && typeof ctx.searchParams === "object")) {
    url = ctx;
    ctx = null;
  }
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  let L = langFromRequest(request);
  const token = url.searchParams.get("token");
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return msgPage(L, "trackInvalid", 404);
  }
  if (!env.LEADS_KV) return msgPage(L, "config", 500);

  const raw = await env.LEADS_KV.get(`project:${token}`);
  if (!raw) return msgPage(L, "trackMissing", 404);

  let proj = JSON.parse(raw);
  if (proj.pendingMaterialsNotice && Date.now() - (Number(proj.pendingMaterialsNotice.timestamp) || 0) >= 60000) {
    await flushPendingMaterialsNotice(env, token, proj);
  }
  L = pickLang(proj.lang);
  const T = PG[L].tr;
  const projectPageUrl = buildUrl("/proyecto", { token });
  const allDone = proj.status === "done" || (Array.isArray(proj.phases) && proj.phases.length > 0 && proj.phases.every((ph) => ph.status === "done"));
  const hasWeb = Array.isArray(proj.services) && proj.services.includes("web");

  if (request.method === "POST") {
    let bodyJson = null;
    let form = null;
    const cType = request.headers.get("Content-Type") || "";
    if (cType.includes("application/json")) {
      bodyJson = await request.json().catch(() => null);
    } else {
      form = await request.formData().catch(() => null);
    }
    const op = String(bodyJson?.op || form?.get("op") || (!proj.paid ? "pay" : ""));

    if (op === "brandi_chat") {
      const okRate = await checkProjectChatRateLimit(env, token, ip);
      if (!okRate) {
        if (bodyJson) return jsonResponse({ error: "rate_limited" }, 429);
        return redirectTo(projectPageUrl + "#chat");
      }
      const msgText = cleanInput(bodyJson?.message || form?.get("message") || "", 1000);
      if (!msgText) {
        if (bodyJson) return jsonResponse({ error: "empty_message" }, 400);
        return redirectTo(projectPageUrl + "#chat");
      }
      const key = await getKey(env);
      const rawHistory = Array.isArray(bodyJson?.history) ? bodyJson.history : [];
      const checkedHistory = (
        await Promise.all(
          rawHistory.slice(-12).map(async (m) => {
            if (!m || typeof m.text !== "string") return null;
            if (m.role === "user") {
              const text = m.text.trim().slice(0, 600);
              return text ? { role: "user", text } : null;
            }
            if (m.role === "assistant" && typeof m.sig === "string" && (await verifyMsg(key, m.text, m.sig))) {
              return { role: "assistant", text: m.text.trim().slice(0, 600), sig: m.sig };
            }
            return null;
          })
        )
      ).filter(Boolean);
      checkedHistory.push({ role: "user", text: msgText.slice(0, 600) });

      const reply = await askGroqProject(env, L, proj, checkedHistory);
      const sig = await signMsg(key, reply);
      if (bodyJson) {
        return jsonResponse({ ok: true, reply, sig }, 200);
      }
      return redirectTo(projectPageUrl + "#chat");
    }

    if (op === "human_chat") {
      const okRate = await checkProjectChatRateLimit(env, token, ip);
      if (!okRate) {
        if (bodyJson) return jsonResponse({ error: "rate_limited" }, 429);
        return redirectTo(projectPageUrl + "#chat-human");
      }
      const msgText = cleanInput(bodyJson?.message || form?.get("message") || "", 2000);
      if (!msgText) {
        if (bodyJson) return jsonResponse({ error: "empty_message" }, 400);
        return redirectTo(projectPageUrl + "#chat-human");
      }

      const chatKey = `project_chat:${token}`;
      const chatList = (await env.LEADS_KV.get(chatKey, { type: "json" })) || [];
      let translatedToEs = null;
      if (L !== "es" && env.GROQ_API_KEY) {
        try {
          translatedToEs = await translateMessageText(env, msgText, L, "es");
        } catch (e) {
          console.warn("translateMessageText to es failed:", e?.message);
        }
      }

      const msgId = randomHex(8);
      const newMsg = {
        id: msgId,
        sender: "client",
        text: msgText,
        date: new Date().toISOString(),
        ...(translatedToEs && translatedToEs !== msgText ? { translations: { es: translatedToEs } } : {}),
      };
      chatList.push(newMsg);
      const cappedHistory = chatList.slice(-100);
      await env.LEADS_KV.put(chatKey, JSON.stringify(cappedHistory));

      if (env.RESEND_API_KEY) {
        const studioUrl = await studioChatUrl(env, token);
        const quoteForStudio = translatedToEs && translatedToEs !== msgText
          ? `${translatedToEs}\n\n(original en ${L}: ${msgText})`
          : msgText;

        const emailTask = async () => {
          try {
            await resendSend(
              env,
              {
                to: ["hola@rebrandyourbrand.es"],
                reply_to: proj.clientEmail,
                  quote: quoteForStudio,
                ...renderEmail("es", {
                  paras: [
                    `el cliente de ${bold(proj.brand)} (${proj.clientEmail}) ha escrito un nuevo mensaje en el chat directo del proyecto:`,
                  ],
                  quote: quoteForStudio,
                  cta: { label: "responder al cliente", url: studioUrl },
                  secondaryLink: { label: "ver panel del proyecto", url: projectPageUrl },
                }),
              },
              `chat-studio-alert-${token}-${msgId}`
            );
          } catch (e) {
            console.error("chat studio alert failed:", e?.message);
          }

          const emChat = EM[L].chat;
          try {
            await resendSend(
              env,
              {
                to: [proj.clientEmail],
                reply_to: "hola@rebrandyourbrand.es",
                subject: emChat.confirmSubject(proj.brand),
                ...renderEmail(L, {
                  paras: [
                    emChat.hello,
                    emChat.confirmReceived(bold(proj.brand)),
                    emChat.confirmSoon,
                  ],
                  quote: msgText,
                  cta: { label: emChat.viewPortal, url: projectPageUrl + "#chat" },
                }),
              },
              `chat-client-confirm-${token}-${msgId}`
            );
          } catch (e) {
            console.error("chat client confirm failed:", e?.message);
          }
        };

        if (ctx?.waitUntil) {
          ctx.waitUntil(emailTask());
        } else {
          await emailTask();
        }
      }
      if (bodyJson) {
        return jsonResponse({ ok: true, message: newMsg }, 200);
      }
      return redirectTo(projectPageUrl + "?msg_sent=1#chat");
    }

    if (op === "pay") {
      if (proj.paid) return redirectTo(projectPageUrl);
      if (!env.STRIPE_SECRET_KEY) return paymentRetryPage(L);
      const checkout = await ensureStripeCheckout(env, proj);
      if (checkout?.paid) return redirectTo(projectPageUrl);
      if (checkout?.url) return redirectTo(checkout.url);
      return msgPage(L, "retry", 502, {
        form: true,
        footerUrl: projectPageUrl,
        footerLabel: PG[L].common.openTracker,
      });
    }

    if (op === "extra_work") {
      if (!allDone) return redirectTo(projectPageUrl);
      const notes = cleanNote(form?.get("notes") || bodyJson?.notes || "", 1500);
      if (!notes || notes.length < 5) {
        return htmlResponse(
          page(T.title, T.heading, T.extraWorkEmpty, {
            lang: L,
            eyebrow: T.extraWorkEyebrow,
            wide: true,
            html: `<p class="lead" style="color:#cf172f;">${esc(T.extraWorkEmpty)}</p><a class="btn" href="${esc(projectPageUrl)}">${esc(PG[L].common.openTracker)}</a>`,
            footerUrl: projectPageUrl,
            footerLabel: PG[L].common.openTracker,
          }),
          400
        );
      }
      proj.pendingExtraWork = { notes, date: Date.now() };
      await saveProject(env, token, proj);

      const qJoin = String.fromCharCode(38);
      const returnUrl = `${WORKER_URL}/proyecto?token=${token}${qJoin}rev_session_id={CHECKOUT_SESSION_ID}${qJoin}extra_done=1`;
      const cancelUrl = `${projectPageUrl}#extra-work`;
      const checkoutUrl = await createExtraRevisionCheckout(env, proj, "post_delivery", returnUrl, cancelUrl, notes);
      if (!checkoutUrl) {
        return msgPage(L, "retry", 502, { form: false, footerUrl: projectPageUrl, footerLabel: PG[L].common.openTracker });
      }
      return redirectTo(checkoutUrl);
    }

    if (op === "onboarding") {
      if (!proj.paid) return redirectTo(projectPageUrl);

      // Normalizar lista de materiales previa excluyendo ítems sintéticos sin contenido
      const existingMaterials = (Array.isArray(proj.materialsList) ? [...proj.materialsList] : []).filter((m) => {
        if (!m) return false;
        if (m.id === "init" && !m.url && !m.fileId && !m.fileUrl && !m.notes && !m.socials) {
          if (m.domain && !proj.domain) proj.domain = m.domain;
          return false;
        }
        return true;
      });
      proj.materialsList = existingMaterials;
      const isFirstSubmission = existingMaterials.length === 0;

      // Bloque 1 — Materiales del negocio:
      const submittedDomain = hasWeb ? cleanInput(form?.get("domain") ?? "", 200) : "";
      const defaultDomain = proj.domain || proj.onboarding?.domain || "";
      const domain = submittedDomain || (isFirstSubmission ? defaultDomain : "");

      if (hasWeb && isFirstSubmission && !domain) {
        return htmlResponse(
          page(T.obDomainMissing[0], T.obDomainMissing[1], T.obDomainMissing[2], {
            lang: L,
            eyebrow: T.obEyebrow,
            html: `<a class="btn" href="${esc(projectPageUrl)}">${esc(PG[L].common.openTracker)}</a>`,
            footerUrl: projectPageUrl,
            footerLabel: PG[L].common.openTracker,
          }),
          400
        );
      }
      if (hasWeb && domain) {
        proj.domain = domain;
        if (proj.onboarding) proj.onboarding.domain = domain;
      }
      const socials = cleanInput(form?.get("socials") ?? "", 250);
      const rawMaterialsUrl = String(form?.get("materials_url") ?? "").trim();
      const materialsUrl = cleanHttpsUrl(rawMaterialsUrl, 500);
      if (rawMaterialsUrl && !materialsUrl) {
        return htmlResponse(
          page(T.obInvalidUrlTitle || "enlace inválido", T.obInvalidUrlHeading || "revisa el enlace proporcionado", T.obInvalidUrlMsg || "los enlaces externos deben usar https://. vuelve atrás y corrígelo o déjalo vacío si subes un archivo directo.", {
            lang: L,
            eyebrow: T.obEyebrow,
            html: `<a class="btn" href="${esc(projectPageUrl)}">${esc(PG[L].common.openTracker)}</a>`,
            footerUrl: projectPageUrl,
            footerLabel: PG[L].common.openTracker,
          }),
          400
        );
      }
      const materialsNotes = cleanNote(form?.get("materials_notes") ?? form?.get("materials") ?? "", 1000);

      let materialsFileDownloadUrl = "";
      let materialsFilename = "";
      let materialsFileId = "";
      let materialsFileSize = 0;
      const matFile = form?.get("materials_file");
      if (
        matFile &&
        typeof matFile === "object" &&
        typeof matFile.arrayBuffer === "function" &&
        matFile.size > 0
      ) {
        if (matFile.size > 25 * 1024 * 1024) {
          return htmlResponse(
            page(T.fileTooLargeTitle || "archivo demasiado grande", T.fileTooLargeHeading || "tamaño de archivo superado", T.fileTooLarge || "el archivo supera el límite de 25 mb admitido para subida directa.", {
              lang: L,
              eyebrow: T.obEyebrow,
              html: `<a class="btn" href="${esc(projectPageUrl)}">${esc(PG[L].common.openTracker)}</a>`,
              footerUrl: projectPageUrl,
              footerLabel: PG[L].common.openTracker,
            }),
            400
          );
        }
        materialsFileId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
        const arrayBuf = await matFile.arrayBuffer();
        materialsFilename = safeFilename(matFile.name, "material-arranque");
        materialsFileSize = matFile.size;
        const contentType = cleanInput(matFile.type, 100) || "application/octet-stream";
        await env.LEADS_KV.put(`file:${token}:mat:${materialsFileId}`, arrayBuf, {
          metadata: {
            filename: materialsFilename,
            contentType,
            size: matFile.size,
            createdAt: new Date().toISOString(),
          },
        });
        materialsFileDownloadUrl = await fileDownloadUrl(env, token, "mat", materialsFileId);
      }

      // Bloque 2 — Referencias visuales:
      const rawRefUrl = String(form?.get("reference_url") ?? "").trim();
      const referenceUrl = cleanHttpsUrl(rawRefUrl, 500);
      if (rawRefUrl && !referenceUrl) {
        return htmlResponse(
          page(T.obInvalidUrlTitle || "enlace inválido", T.obInvalidUrlHeading || "revisa el enlace proporcionado", T.obInvalidUrlMsg || "los enlaces externos deben usar https://. vuelve atrás y corrígelo o déjalo vacío si subes un archivo directo.", {
            lang: L,
            eyebrow: T.obEyebrow,
            html: `<a class="btn" href="${esc(projectPageUrl)}">${esc(PG[L].common.openTracker)}</a>`,
            footerUrl: projectPageUrl,
            footerLabel: PG[L].common.openTracker,
          }),
          400
        );
      }
      const referenceNotes = cleanNote(form?.get("reference_notes") ?? "", 1000);

      let referenceFileDownloadUrl = "";
      let referenceFilename = "";
      let referenceFileId = "";
      let referenceFileSize = 0;
      const refFile = form?.get("reference_file");
      if (
        refFile &&
        typeof refFile === "object" &&
        typeof refFile.arrayBuffer === "function" &&
        refFile.size > 0
      ) {
        if (refFile.size > 25 * 1024 * 1024) {
          return htmlResponse(
            page(T.fileTooLargeTitle || "archivo demasiado grande", T.fileTooLargeHeading || "tamaño de archivo superado", T.fileTooLarge || "el archivo supera el límite de 25 mb admitido para subida directa.", {
              lang: L,
              eyebrow: T.obEyebrow,
              html: `<a class="btn" href="${esc(projectPageUrl)}">${esc(PG[L].common.openTracker)}</a>`,
              footerUrl: projectPageUrl,
              footerLabel: PG[L].common.openTracker,
            }),
            400
          );
        }
        referenceFileId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
        const arrayBuf = await refFile.arrayBuffer();
        referenceFilename = safeFilename(refFile.name, "referencia-visual");
        referenceFileSize = refFile.size;
        const contentType = cleanInput(refFile.type, 100) || "application/octet-stream";
        await env.LEADS_KV.put(`file:${token}:ref:${referenceFileId}`, arrayBuf, {
          metadata: {
            filename: referenceFilename,
            contentType,
            size: refFile.size,
            createdAt: new Date().toISOString(),
          },
        });
        referenceFileDownloadUrl = await fileDownloadUrl(env, token, "ref", referenceFileId);
      }

      const hasDomainChange = Boolean(hasWeb && submittedDomain && submittedDomain !== (defaultDomain || proj.domain));
      const hasRealMaterial = Boolean(hasDomainChange || socials || materialsUrl || materialsNotes || materialsFileDownloadUrl);
      const hasReference = Boolean(referenceUrl || referenceNotes || referenceFileDownloadUrl);

      if (!hasRealMaterial && !hasReference) {
        return htmlResponse(
          page(T.obMissing[0], T.obMissing[1], T.obMissing[2], {
            lang: L,
            eyebrow: T.obEyebrow,
            html: `<a class="btn" href="${esc(projectPageUrl)}">${esc(PG[L].common.openTracker)}</a>`,
            footerUrl: projectPageUrl,
            footerLabel: PG[L].common.openTracker,
          }),
          400
        );
      }

      // Migración retrocompatible de onboarding previo a materialsList si no existe:
      if (!Array.isArray(proj.materialsList)) {
        proj.materialsList = [];
        if (proj.onboarding) {
          const ob = proj.onboarding;
          const legacyUrl = cleanHttpsUrl(ob.materials || "", 500);
          proj.materialsList.push({
            id: "legacy",
            createdAt: ob.submittedAt || ob.receivedAt || proj.createdAt || new Date().toISOString(),
            domain: ob.domain || "",
            socials: ob.socials || "",
            notes: legacyUrl ? "" : (ob.materials || ""),
            url: legacyUrl || "",
            fileUrl: "",
            filename: "",
          });
        }
      }
      if (!Array.isArray(proj.referencesList)) {
        proj.referencesList = [];
      }

      const nowIso = new Date().toISOString();
      let createdMatItem = null;
      let createdRefItem = null;

      const hasMaterial = Boolean((hasWeb && (submittedDomain || isFirstSubmission)) || hasRealMaterial);

      if (hasMaterial) {
        createdMatItem = {
          id: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
          createdAt: nowIso,
          domain: submittedDomain || (isFirstSubmission ? domain : ""),
          socials,
          url: materialsUrl,
          notes: materialsNotes,
          fileUrl: materialsFileDownloadUrl,
          filename: materialsFilename,
          fileId: materialsFileId,
          fileSize: materialsFileSize,
        };
        proj.materialsList.push(createdMatItem);
        if (!proj.onboarding) {
          proj.onboarding = {
            domain: proj.domain || domain || "",
            socials: socials || "",
            materials: materialsUrl || materialsNotes || materialsFilename || "",
            submittedAt: nowIso,
          };
        }
      }

      if (hasReference) {
        createdRefItem = {
          id: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
          createdAt: nowIso,
          url: referenceUrl,
          notes: referenceNotes,
          fileUrl: referenceFileDownloadUrl,
          filename: referenceFilename,
          fileId: referenceFileId,
          fileSize: referenceFileSize,
        };
        proj.referencesList.push(createdRefItem);
      }

      proj.lastAdded = {
        matId: createdMatItem?.id || null,
        matFileId: createdMatItem?.fileId || null,
        refId: createdRefItem?.id || null,
        refFileId: createdRefItem?.fileId || null,
        timestamp: Date.now(),
      };
      proj.pendingMaterialsNotice = {
        matId: createdMatItem?.id || null,
        refId: createdRefItem?.id || null,
        timestamp: Date.now(),
      };
      delete proj.draft;
      if (hasMaterial || hasReference) {
        delete proj.abandonWarningSentAt;
      }

      await saveProject(env, token, proj);

      // Envío diferido: no se envía el correo al estudio hasta que expire el timer (60s) o el cliente pulse la X
      return redirectTo(buildUrl("/proyecto", { token, undo: "1" }));
    }

    if (op === "confirm_materials") {
      if (proj.pendingMaterialsNotice) {
        await flushPendingMaterialsNotice(env, token, proj);
      }
      proj.lastAdded = null;
      await saveProject(env, token, proj);
      const isJson = request.headers.get("Accept")?.includes("application/json") || request.headers.get("X-Requested-With");
      if (isJson) {
        return jsonResponse({ ok: true }, 200);
      }
      return redirectTo(projectPageUrl);
    }

    if (op === "undo_onboarding") {
      if (!proj.paid) return redirectTo(projectPageUrl);
      if (proj.lastAdded) {
        const { matId, matFileId, refId, refFileId } = proj.lastAdded;
        const undoneMat = Array.isArray(proj.materialsList) ? proj.materialsList.find((m) => m.id === matId) : null;
        const undoneRef = Array.isArray(proj.referencesList) ? proj.referencesList.find((r) => r.id === refId) : null;

        // Guardar borrador para restaurar en el formulario exactamente lo que el usuario tenía antes de enviar:
        proj.draft = {
          domain: undoneMat?.domain || proj.domain || "",
          socials: undoneMat?.socials || "",
          materials_url: undoneMat?.url || "",
          materials_notes: undoneMat?.notes || "",
          materials_filename: undoneMat?.filename || "",
          reference_url: undoneRef?.url || "",
          reference_notes: undoneRef?.notes || "",
          reference_filename: undoneRef?.filename || "",
        };

        if (matId && Array.isArray(proj.materialsList)) {
          proj.materialsList = proj.materialsList.filter((m) => m.id !== matId);
        }
        if (matFileId) {
          await env.LEADS_KV.delete(`file:${token}:mat:${matFileId}`).catch(() => {});
        }
        if (refId && Array.isArray(proj.referencesList)) {
          proj.referencesList = proj.referencesList.filter((r) => r.id !== refId);
        }
        if (refFileId) {
          await env.LEADS_KV.delete(`file:${token}:ref:${refFileId}`).catch(() => {});
        }
        if (proj.onboarding && (!Array.isArray(proj.materialsList) || proj.materialsList.length === 0)) {
          delete proj.onboarding;
        }
        delete proj.pendingMaterialsNotice;
        proj.lastAdded = null;
        await saveProject(env, token, proj);

        // Sin correo de cancelación: el estudio no fue notificado previamente, eliminando correos inútiles
      }
      return redirectTo(buildUrl("/proyecto", { token, undone: "1" }));
    }

    return redirectTo(projectPageUrl);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
  }

  const receiptCheckedAt = Number(proj.receiptCheckedAt) || 0;
  const shouldCheckReceipt = !proj.receiptUrl && (!receiptCheckedAt || (Date.now() - receiptCheckedAt > 10 * 60 * 1000));
  if (!proj.paid || !proj.emailsSent || shouldCheckReceipt) {
    const sid = url.searchParams.get("session_id") || proj.stripeSessionId;
    if (sid && /^cs_[A-Za-z0-9_]+$/.test(sid) && env.STRIPE_SECRET_KEY) {
      const session = await fetchStripeSession(env, sid);
      if (session && (session.metadata?.project_token || session.client_reference_id) === token) {
        await processPaidSession(env, session).catch((e) =>
          console.error("processPaidSession (fallback) failed:", e?.message)
        );
        const fresh = await env.LEADS_KV.get(`project:${token}`);
        if (fresh) proj = JSON.parse(fresh);
      }
      if (!proj.receiptUrl) {
        proj.receiptCheckedAt = Date.now();
        await saveProject(env, token, proj);
      }
    }
  }

  const revSessionId = url.searchParams.get("rev_session_id");
  if (revSessionId && /^cs_[A-Za-z0-9_]+$/.test(revSessionId)) {
    const stepParam = url.searchParams.get("step") || "post_delivery";
    await unlockExtraRevision(env, proj, stepParam, revSessionId);
    const freshProjRaw = await env.LEADS_KV.get(`project:${token}`);
    if (freshProjRaw) proj = JSON.parse(freshProjRaw);
  }

  const receiptRow =
    proj.paid && isStripeReceiptUrl(proj.receiptUrl)
      ? `<div class="phase-actions" style="margin-top:.85rem;"><a class="pill-link" href="${esc(proj.receiptUrl)}" target="_blank" rel="noopener noreferrer">${esc(T.receipt)}</a></div>`
      : "";

  const headerHtml = `
    <div class="box">
      <div class="kv">
        <div class="kv-row"><span>${esc(T.project)}</span><span class="kv-val">${esc(proj.brand)}</span></div>
        <div class="kv-row"><span>${esc(T.services)}</span><span class="kv-val">${esc(svcLabel(proj.services, L))}</span></div>
        <div class="kv-row"><span>${esc(proj.paid ? T.paid : T.due)}</span><span class="kv-val">${esc(eur(Number(proj.totalEur), L))}</span></div>
      </div>
      ${receiptRow}
    </div>`;

  if (!proj.paid) {
    const unpaidHtml = `
      ${headerHtml}
      <p class="lead">${esc(T.payIntro)}</p>
      <form method="POST">
        <input type="hidden" name="op" value="pay">
        <button type="submit">${esc(T.payBtn)}</button>
      </form>`;

    return htmlResponse(
      page(`${T.title} — ${proj.brand}`, T.heading, "", {
        lang: L,
        eyebrow: T.eyebrow,
        wide: true,
        html: unpaidHtml,
      }),
      200
    );
  }

  const extraDoneBanner =
    url.searchParams.get("extra_done") === "1"
      ? `<div class="banner-ok">${esc(T.extraWorkSuccess)}</div>`
      : "";

  const undoneBanner =
    url.searchParams.get("undone") === "1"
      ? `<div class="banner-ok">${esc(T.obUndoneBanner)}</div>`
      : extraDoneBanner;

  const bannerHtml =
    url.searchParams.get("ob") === "1"
      ? `<div class="banner-ok">${esc(T.obSentBanner)}</div>`
      : undoneBanner;

  const undoHtml =
    url.searchParams.get("undo") === "1" && proj.lastAdded && Date.now() - proj.lastAdded.timestamp < 60000
      ? `
      <div class="undo-bar-wrap" id="undo-bar">
        <div class="undo-bar-content">
          <form method="POST" id="undo-dismiss-form" style="margin:0;padding:0;display:inline;">
            <input type="hidden" name="op" value="confirm_materials">
            <button type="submit" class="btn-dismiss" id="undo-dismiss-btn" aria-label="${esc(T.obDismissBtn)}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </form>
          <div class="undo-bar-text">
            <svg class="undo-ring" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <circle class="undo-ring-bg" cx="12" cy="12" r="9" fill="none" stroke-width="2.5"></circle>
              <circle class="undo-ring-stroke" cx="12" cy="12" r="9" fill="none" stroke-width="2.5"></circle>
            </svg>
            <span>${esc(T.obUndoBanner)}</span>
          </div>
          <div class="undo-bar-actions">
            <form method="POST" style="margin:0;padding:0;display:inline;">
              <input type="hidden" name="op" value="undo_onboarding">
              <button type="submit" class="btn-undo">${esc(T.obUndoBtn)}</button>
            </form>
          </div>
        </div>
      </div>
      <script>
        (function(){
          var bar = document.getElementById("undo-bar");
          if (!bar) return;
          if (bar.parentElement !== document.body) {
            document.body.appendChild(bar);
          }
          var confirmed = false;
          var confirmAndDismiss = function(e){
            if (e && e.preventDefault) e.preventDefault();
            if (confirmed) return;
            confirmed = true;
            try {
              fetch("${esc(projectPageUrl)}", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
                body: "op=confirm_materials"
              }).catch(function(){});
            } catch(err){}
            bar.classList.add("is-dismissed");
            setTimeout(function(){
              if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
            }, 360);
          };

          var btn = document.getElementById("undo-dismiss-btn");
          if (btn) btn.addEventListener("click", confirmAndDismiss);
          window.addEventListener("keydown", function(e){
            if (e.key === "Escape" || e.keyCode === 27) confirmAndDismiss();
          });
          setTimeout(function(){
            confirmAndDismiss();
          }, 60000);
        })();
      </script>`
      : "";

  // allDone ya declarado arriba en handleProject

  // Normalizar lista de materiales y referencias (modo append-only, filtrando init vacíos)
  const materialsList = (Array.isArray(proj.materialsList) ? [...proj.materialsList] : []).filter((m) => {
    if (!m) return false;
    if (m.id === "init" && !m.url && !m.fileId && !m.fileUrl && !m.notes && !m.socials) {
      if (m.domain && !proj.domain) proj.domain = m.domain;
      return false;
    }
    return true;
  });
  if (proj.onboarding && materialsList.length === 0) {
    const ob = proj.onboarding;
    const legacyUrl = cleanHttpsUrl(ob.materials || "", 500);
    const hasRealContent = Boolean(legacyUrl || ob.socials || ob.materials || ob.notes);
    if (hasRealContent) {
      materialsList.push({
        id: "legacy",
        createdAt: ob.submittedAt || ob.receivedAt || proj.createdAt || "",
        domain: ob.domain || "",
        socials: ob.socials || "",
        notes: legacyUrl ? "" : (ob.materials || ""),
        url: legacyUrl || "",
        fileUrl: "",
        filename: "",
      });
    } else if (ob.domain && !proj.domain) {
      proj.domain = ob.domain;
    }
  }
  const referencesList = Array.isArray(proj.referencesList) ? [...proj.referencesList] : [];

  const materialsItemsHtml = await Promise.all(
    materialsList.map(async (m, i) => {
      const dateStr = m.createdAt ? fmtDate(m.createdAt, L) : "";
      const urlLink = cleanHttpsUrl(m.url || "", 500);
      let fileLink = "";
      if (m.fileId) {
        fileLink = await fileDownloadUrl(env, token, "mat", m.fileId);
      } else if (m.fileUrl) {
        fileLink = m.fileUrl;
      }
      return `
        <div class="history-item">
          <div class="history-head">
            <span style="font-size:.78rem;font-weight:600;color:#3D5A85;text-transform:lowercase;">${esc(T.obMaterialsHistory)} #${i + 1}</span>
            ${dateStr ? `<span style="font-size:.74rem;color:#58575E;">${esc(dateStr)}</span>` : ""}
          </div>
          <div class="kv" style="font-size:.82rem;">
            ${hasWeb && m.domain ? `<div class="kv-row"><span>${esc(T.obLblDomain)}</span><span class="kv-val">${esc(m.domain)}</span></div>` : ""}
            ${m.socials ? `<div class="kv-row"><span>${esc(T.obLblSocials)}</span><span class="kv-val">${esc(m.socials)}</span></div>` : ""}
            ${urlLink ? `<div class="kv-row"><span>${esc(T.obMaterialsUrl)}</span><span class="kv-val" style="word-break:break-all;"><a href="${esc(urlLink)}" target="_blank" rel="noopener noreferrer" style="color:#3D5A85;text-decoration:underline;">${esc(urlLink)}</a></span></div>` : ""}
            ${fileLink ? `<div class="kv-row"><span>${esc(T.obMaterialsFile)}</span><span class="kv-val"><a class="pill-link" href="${esc(fileLink)}" target="_blank" rel="noopener noreferrer">${esc(m.filename || T.obFileDownload)}</a></span></div>` : ""}
          </div>
          ${m.notes ? `<div class="phase-note" style="margin-top:.55rem;">${esc(m.notes)}</div>` : ""}
        </div>`;
    })
  );

  const referencesItemsHtml = await Promise.all(
    referencesList.map(async (r, i) => {
      const dateStr = r.createdAt ? fmtDate(r.createdAt, L) : "";
      const urlLink = cleanHttpsUrl(r.url || "", 500);
      let fileLink = "";
      if (r.fileId) {
        fileLink = await fileDownloadUrl(env, token, "ref", r.fileId);
      } else if (r.fileUrl) {
        fileLink = r.fileUrl;
      }
      return `
        <div class="history-item">
          <div class="history-head">
            <span style="font-size:.78rem;font-weight:600;color:#825008;text-transform:lowercase;">${esc(T.obReferencesHistory)} #${i + 1}</span>
            ${dateStr ? `<span style="font-size:.74rem;color:#58575E;">${esc(dateStr)}</span>` : ""}
          </div>
          <div class="kv" style="font-size:.82rem;">
            ${urlLink ? `<div class="kv-row"><span>${esc(T.obRefUrl)}</span><span class="kv-val" style="word-break:break-all;"><a href="${esc(urlLink)}" target="_blank" rel="noopener noreferrer" style="color:#3D5A85;text-decoration:underline;">${esc(urlLink)}</a></span></div>` : ""}
            ${fileLink ? `<div class="kv-row"><span>${esc(T.obRefFile)}</span><span class="kv-val"><a class="pill-link" href="${esc(fileLink)}" target="_blank" rel="noopener noreferrer">${esc(r.filename || T.obFileDownload)}</a></span></div>` : ""}
          </div>
          ${r.notes ? `<div class="phase-note" style="margin-top:.55rem;">${esc(r.notes)}</div>` : ""}
        </div>`;
    })
  );

  const materialsBox = materialsItemsHtml.length
    ? `<div class="box">
        <span class="eyebrow">${esc(T.obMaterialsHistory)}</span>
        ${materialsItemsHtml.join("")}
      </div>`
    : "";

  const referencesBox = referencesItemsHtml.length
    ? `<div class="box">
        <span class="eyebrow">${esc(T.obReferencesHistory)}</span>
        ${referencesItemsHtml.join("")}
      </div>`
    : "";

  let addFormHtml = "";
  if (!allDone) {
    const isFirstSubmission = materialsList.length === 0;
    const defaultDomain = proj.domain || proj.onboarding?.domain || (materialsList.find((m) => m?.domain)?.domain) || "";
    const draft = proj.draft || null;
    const hasDraft = Boolean(draft);

    const domainRequired = hasWeb && isFirstSubmission;
    const domainInputValue = draft?.domain || (isFirstSubmission ? defaultDomain : "");
    const domainPlaceholder = defaultDomain || T.obDomainPh;

    const socialsValue = draft?.socials || "";
    const matUrlValue = draft?.materials_url || "";
    const matNotesValue = draft?.materials_notes || "";
    const refUrlValue = draft?.reference_url || "";
    const refNotesValue = draft?.reference_notes || "";

    const matPrevFileNote = draft?.materials_filename && typeof T.obPrevFile === "function"
      ? `<span class="file-note" style="color:#825008;margin-bottom:.35rem;display:block;">${esc(T.obPrevFile(draft.materials_filename))}</span>`
      : "";
    const refPrevFileNote = draft?.reference_filename && typeof T.obPrevRef === "function"
      ? `<span class="file-note" style="color:#825008;margin-bottom:.35rem;display:block;">${esc(T.obPrevRef(draft.reference_filename))}</span>`
      : "";

    const formFields = `
      <form method="POST" enctype="multipart/form-data" style="text-align:left;">
        <input type="hidden" name="op" value="onboarding">

        <div class="section-subheading">${esc(T.blockAMaterials)}</div>
        ${hasWeb ? `
        <label for="domain">${esc(T.obDomain)}${domainRequired ? ` <span style="color:#cf172f;font-weight:600;">(${esc(T.obDomainRequired)})</span>` : ""}</label>
        <input id="domain" name="domain" type="text" maxlength="200" value="${esc(domainInputValue)}" placeholder="${esc(domainPlaceholder)}" ${domainRequired ? "required" : ""}>` : ""}

        <label for="socials">${esc(T.obSocials)}</label>
        <input id="socials" name="socials" type="text" maxlength="250" value="${esc(socialsValue)}" placeholder="${esc(T.obSocialsPh)}">

        <label for="materials_url">${esc(T.obMaterialsUrl)}</label>
        <input id="materials_url" name="materials_url" type="url" maxlength="500" value="${esc(matUrlValue)}" placeholder="${esc(T.obMaterialsUrlPh)}">

        <label for="materials_file">${esc(T.obMaterialsFile)}</label>
        ${matPrevFileNote}
        <input id="materials_file" name="materials_file" type="file">
        <span class="file-note">${esc(T.obMaterialsFileNote)}</span>

        <label for="materials_notes">${esc(T.obMaterialsNotes)}</label>
        <textarea id="materials_notes" name="materials_notes" rows="3" maxlength="1000" placeholder="${esc(T.obMaterialsNotesPh)}">${esc(matNotesValue)}</textarea>

        <div class="section-subheading">${esc(T.blockBRefs)}</div>

        <label for="reference_url">${esc(T.obRefUrl)}</label>
        <input id="reference_url" name="reference_url" type="url" maxlength="500" value="${esc(refUrlValue)}" placeholder="${esc(T.obRefUrlPh)}">

        <label for="reference_file">${esc(T.obRefFile)}</label>
        ${refPrevFileNote}
        <input id="reference_file" name="reference_file" type="file">
        <span class="file-note">${esc(T.obMaterialsFileNote)}</span>

        <label for="reference_notes">${esc(T.obRefNotes)}</label>
        <textarea id="reference_notes" name="reference_notes" rows="3" maxlength="1000" placeholder="${esc(T.obRefNotesPh)}">${esc(refNotesValue)}</textarea>

        <button type="submit">${esc(T.obSubmit)}</button>
      </form>`;

    if (!isFirstSubmission) {
      addFormHtml = `
        <details class="add-materials-slider"${hasDraft ? " open" : ""}>
          <summary class="slider-summary">${esc(T.obAccordionTitle)}</summary>
          <div class="slider-body">
            <div class="slider-warning"><p>${esc(T.obDelayWarning)}</p></div>
            ${formFields}
          </div>
        </details>`;
    } else {
      addFormHtml = `
        <div class="box accent">
          <span class="eyebrow">${esc(T.obEyebrow)}</span>
          <h2>${esc(T.obTitle)}</h2>
          <p class="lead" style="margin-bottom:1.15rem;font-size:.85rem;">${esc(T.obIntro)}</p>
          ${formFields}
        </div>`;
    }
  }

  const phaseCards = await Promise.all(
    (proj.phases || []).map(async (ph) => {
      const isDone = ph.status === "done";
      const isReview = ph.status === "review";
      const isActive = ph.status === "active";
      const cls = isDone ? " is-done" : isReview ? " is-review" : isActive ? " is-active" : "";
      const dot = isDone ? "✓" : String(Number(ph.step));

      let meta = T.todo;
      if (isDone) {
        const parts = [T.done];
        if (ph.date) parts.push(fmtDate(ph.date, L));
        if (ph.approvedBy === "client") parts.push(T.doneClient);
        else if (ph.approvedBy === "tacit") parts.push(T.doneTacit);
        meta = parts.join(" — ");
      } else if (isReview) {
        meta = T.review;
      } else if (isActive) {
        const maxR = ph.maxRevisions || MAX_PHASE_REVISIONS;
        const rUsed = Math.min(maxR, Math.max(0, Number(ph.revisionsUsed) || 0));
        meta = rUsed > 0 ? T.activeRev(rUsed, maxR) : T.active;
      }

      const safeDeliv = cleanHttpsUrl(ph.deliverableUrl || "", 500);
      const noteHtml = ph.note
        ? `<div class="phase-note"><strong>${esc(T.studioNote)}:</strong> ${esc(ph.note)}</div>`
        : "";

      const actions = [];
      if (safeDeliv) {
        const delivLabel = ph.deliverableFilename
          ? `${esc(T.deliverable)} (${esc(ph.deliverableFilename)})`
          : esc(T.deliverable);
        actions.push(
          `<a class="pill-link" href="${esc(safeDeliv)}" target="_blank" rel="noopener noreferrer">${delivLabel}</a>`
        );
      }
      if (isReview) {
        const appUrl = await approvePhaseUrl(env, token, ph.step);
        actions.push(`<a class="btn btn-inline" href="${esc(appUrl)}">${esc(T.reviewAction)}</a>`);
      }
      const actionsHtml = actions.length ? `<div class="phase-actions">${actions.join("")}</div>` : "";

      return `<div class="phase-card${cls}">
        <span class="phase-dot">${dot}</span>
        <div class="phase-body">
          <span class="phase-title">${esc(T.step)} ${Number(ph.step)} — ${esc(phaseTitle(ph, L))}</span>
          <span class="phase-meta">${esc(meta)}</span>
          ${noteHtml}
          ${actionsHtml}
        </div>
      </div>`;
    })
  );

  let postDeliveryHtml = "";
  if (allDone) {
    const workItems = Array.isArray(proj.extraWork) ? proj.extraWork : [];
    const workHistoryHtml = workItems.length
      ? `<div style="margin-top:1rem;border-top:1px solid #E4DED0;padding-top:.85rem;">
          <span style="font-size:11px;font-family:ui-monospace,monospace;letter-spacing:.05em;color:#58575E;text-transform:lowercase;display:block;margin-bottom:.5rem;">${esc(T.extraWorkHistory)}</span>
          ${workItems.map((w) => `
            <div style="background:rgba(255,255,255,.7);border:1px solid #E4DED0;border-radius:10px;padding:.75rem .9rem;margin-bottom:.5rem;font-size:13px;">
              <div style="display:flex;justify-content:space-between;color:#58575E;font-size:11px;margin-bottom:.25rem;">
                <span>${esc(fmtDate(w.date, L))}</span>
                <span style="color:#3D5A85;font-weight:600;">${esc(T.extraWorkStatusReceived)}</span>
              </div>
              <div style="color:#17171A;white-space:pre-wrap;">${esc(w.notes)}</div>
            </div>
          `).join("")}
        </div>`
      : "";

    postDeliveryHtml = `
      <div id="extra-work" class="box" style="margin-top:1.25rem;">
        <span class="eyebrow">${esc(T.extraWorkEyebrow)}</span>
        <h2>${esc(T.extraWorkTitle)}</h2>
        <p class="lead" style="margin-bottom:1rem;font-size:.85rem;">${esc(T.extraWorkDesc)}</p>
        <form method="POST" action="${esc(projectPageUrl)}#extra-work">
          <input type="hidden" name="op" value="extra_work">
          <label for="extra-notes" style="display:block;font-size:12px;color:#58575E;margin-bottom:.4rem;text-transform:lowercase;">${esc(T.extraWorkPh)}</label>
          <textarea id="extra-notes" name="notes" rows="3" maxlength="1500" required placeholder="${esc(T.extraWorkPh)}" style="width:100%;margin-bottom:.75rem;padding:.75rem;border-radius:10px;border:1px solid #E4DED0;background:rgba(255,255,255,.9);font-family:inherit;font-size:13px;"></textarea>
          <button type="submit" class="btn">${esc(T.extraWorkBtn)}</button>
        </form>
        ${workHistoryHtml}
      </div>`;
  }

  let reviewCardHtml = "";
  if (allDone && !proj.reviewSubmitted) {
    const revUrl = await reviewUrl(env, token);
    if (revUrl) {
      reviewCardHtml = `
        <div class="box accent" style="margin-top:1.25rem;">
          <span class="eyebrow">${esc(PG[L].rv?.eyebrow || "opinión verificada")}</span>
          <h2>${esc(PG[L].rv?.heading || "cuéntanos qué tal ha ido")}</h2>
          <p class="lead" style="margin-bottom:1.15rem;font-size:.85rem;">${esc(PG[L].rv?.intro || "gracias por confiar en nosotros.")}</p>
          <a class="btn" href="${esc(revUrl)}">${esc(PG[L].common?.openReview || "dejar valoración del proyecto")}</a>
        </div>`;
    }
  }

  // ── SISTEMA DE CHAT HÍBRIDO (BRANDI IA + EQUIPO HUMANO) ──
  const chatKey = `project_chat:${token}`;
  const humanChatHistory = (await env.LEADS_KV.get(chatKey, { type: "json" })) || [];

  if (L !== "es" && humanChatHistory.length && env.GROQ_API_KEY) {
    const pendingStudio = humanChatHistory
      .filter((m) => m && m.sender === "studio" && m.text && (!m.translations || !m.translations[L]))
      .slice(-2);

    if (pendingStudio.length > 0) {
      let anyUpdated = false;
      await Promise.all(
        pendingStudio.map(async (m) => {
          const tr = await translateMessageText(env, m.text, "es", L);
          m.translations = m.translations || {};
          m.translations[L] = tr || m.text;
          anyUpdated = true;
        })
      );
      if (anyUpdated) {
        await env.LEADS_KV.put(chatKey, JSON.stringify(humanChatHistory.slice(-100))).catch(() => {});
      }
    }
  }
  const humanMessagesHtml = humanChatHistory.length
    ? humanChatHistory
        .map((m) => {
          const isClient = m.sender === "client";
          const author = isClient ? T.chatYou : T.chatStudio;
          const cls = isClient ? "is-client" : "is-studio";
          const hasTrans = !isClient && L !== "es" && m.translations && m.translations[L] && m.translations[L] !== m.text;
          const displayText = hasTrans ? m.translations[L] : m.text;
          const toggleHtml = hasTrans
            ? `<div class="chat-trans-wrap">
                <button type="button" class="chat-trans-toggle" data-orig="${esc(m.text)}" data-trans="${esc(m.translations[L])}" data-showing="trans">
                  <svg class="chat-trans-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>
                  <span class="chat-trans-label">${esc(T.chatTransIndicator)}</span>
                </button>
              </div>`
            : "";
          return `<div class="chat-msg-row ${cls}">
            <div class="chat-msg-bubble">
              <div class="chat-msg-head">
                <span class="chat-msg-author">${esc(author)}</span>
                <span class="chat-msg-date">${esc(fmtDate(m.date, L))}</span>
              </div>
              <div class="chat-msg-text">${esc(displayText)}</div>
              ${toggleHtml}
            </div>
          </div>`;
        })
        .join("")
    : `<div class="chat-empty" id="human-empty-msg">${esc(T.chatNoMessages)}</div>`;

  const brandiWelcomeMsg = T.brandiWelcome(proj.brand);

  const msgSentBanner = url.searchParams.get("msg_sent") === "1"
    ? `<div class="banner-ok" style="margin-bottom:1rem;"><p>${esc(T.humanSentSuccess)}</p></div>`
    : "";

  const chatSectionHtml = `
    <section id="chat" class="chat-section">
      <div class="chat-header">
        <div class="chat-header-info">
          <span class="eyebrow" style="margin-bottom:.2rem;">${esc(T.chatEyebrow)}</span>
          <h3 style="margin-bottom:0;">${esc(T.chatHeading)}</h3>
        </div>
        <div class="chat-mode-tabs" role="tablist">
          <button type="button" class="chat-tab-btn is-active" id="tab-brandi" role="tab" aria-selected="true" aria-controls="panel-brandi" data-chat-tab="brandi">
            <span class="tab-dot ai"></span>
            <span>${esc(T.chatTabBrandi)}</span>
          </button>
          <button type="button" class="chat-tab-btn" id="tab-human" role="tab" aria-selected="false" aria-controls="panel-human" data-chat-tab="human">
            <span class="tab-dot human"></span>
            <span>${esc(T.chatTabHuman)}</span>
          </button>
        </div>
      </div>

      <div id="panel-brandi" class="chat-panel is-active" role="tabpanel" aria-labelledby="tab-brandi">
        <div class="chat-intro-banner">
          <p>${esc(T.brandiIntro)}</p>
          <button type="button" class="btn-switch-human" id="btn-switch-human">${esc(T.switchToHuman)} →</button>
        </div>
        <div class="chat-msg-list" id="brandi-msg-list">
          <div class="chat-msg-row is-ai">
            <div class="chat-msg-bubble">
              <div class="chat-msg-head">
                <span class="chat-msg-author">${esc(T.chatBrandi)}</span>
              </div>
              <div class="chat-msg-text">${esc(brandiWelcomeMsg)}</div>
            </div>
          </div>
        </div>
        <form id="brandi-chat-form" method="POST" action="${esc(projectPageUrl)}#chat">
          <input type="hidden" name="op" value="brandi_chat">
          <div class="chat-input-wrap">
            <textarea name="message" id="brandi-input" placeholder="${esc(T.brandiPlaceholder)}" maxlength="1000" rows="1" required></textarea>
            <button type="submit" class="chat-send-btn btn-ai" aria-label="${esc(T.sendBtn)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            </button>
          </div>
        </form>
      </div>

      <div id="panel-human" class="chat-panel" role="tabpanel" aria-labelledby="tab-human">
        <div class="chat-intro-banner human-banner">
          <p>${esc(T.humanIntro)}</p>
        </div>
        ${msgSentBanner}
        <div class="chat-msg-list" id="human-msg-list">
          ${humanMessagesHtml}
        </div>
        <form id="human-chat-form" method="POST" action="${esc(projectPageUrl)}#chat">
          <input type="hidden" name="op" value="human_chat">
          <div class="chat-input-wrap">
            <textarea name="message" id="human-input" placeholder="${esc(T.humanPlaceholder)}" maxlength="2000" rows="2" required></textarea>
            <button type="submit" class="chat-send-btn" aria-label="${esc(T.sendBtn)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            </button>
          </div>
        </form>
      </div>
    </section>

    <script>
      (function(){
        var tabBrandi = document.getElementById("tab-brandi");
        var tabHuman = document.getElementById("tab-human");
        var panelBrandi = document.getElementById("panel-brandi");
        var panelHuman = document.getElementById("panel-human");
        var switchBtn = document.getElementById("btn-switch-human");
        var brandiForm = document.getElementById("brandi-chat-form");
        var humanForm = document.getElementById("human-chat-form");
        var brandiInput = document.getElementById("brandi-input");
        var humanInput = document.getElementById("human-input");
        var brandiList = document.getElementById("brandi-msg-list");
        var humanList = document.getElementById("human-msg-list");

        var brandiHistory = [];

        function activateTab(tab) {
          if (tab === "human") {
            tabBrandi.classList.remove("is-active");
            tabBrandi.setAttribute("aria-selected", "false");
            tabHuman.classList.add("is-active");
            tabHuman.setAttribute("aria-selected", "true");
            panelBrandi.classList.remove("is-active");
            panelHuman.classList.add("is-active");
            if (humanList) humanList.scrollTop = humanList.scrollHeight;
            if (humanInput) humanInput.focus();
          } else {
            tabHuman.classList.remove("is-active");
            tabHuman.setAttribute("aria-selected", "false");
            tabBrandi.classList.add("is-active");
            tabBrandi.setAttribute("aria-selected", "true");
            panelHuman.classList.remove("is-active");
            panelBrandi.classList.add("is-active");
            if (brandiList) brandiList.scrollTop = brandiList.scrollHeight;
            if (brandiInput) brandiInput.focus();
          }
        }

        if (tabBrandi) tabBrandi.addEventListener("click", function(){ activateTab("brandi"); });
        if (tabHuman) tabHuman.addEventListener("click", function(){ activateTab("human"); });
        if (switchBtn) switchBtn.addEventListener("click", function(){ activateTab("human"); });

        if (window.location.search.indexOf("msg_sent=1") !== -1 || window.location.hash === "#chat-human") {
          activateTab("human");
        }

        function createMsgRow(authorText, text, cls, dateText) {
          var row = document.createElement("div");
          row.className = "chat-msg-row " + cls;
          var bubble = document.createElement("div");
          bubble.className = "chat-msg-bubble";
          var head = document.createElement("div");
          head.className = "chat-msg-head";
          var authorSpan = document.createElement("span");
          authorSpan.className = "chat-msg-author";
          authorSpan.textContent = authorText;
          head.appendChild(authorSpan);
          if (dateText) {
            var dateSpan = document.createElement("span");
            dateSpan.className = "chat-msg-date";
            dateSpan.textContent = dateText;
            head.appendChild(dateSpan);
          }
          var textDiv = document.createElement("div");
          textDiv.className = "chat-msg-text";
          textDiv.textContent = text;
          bubble.appendChild(head);
          bubble.appendChild(textDiv);
          row.appendChild(bubble);
          return row;
        }

        var youLabel = ${JSON.stringify(T.chatYou)};
        var brandiLabel = ${JSON.stringify(T.chatBrandi)};
        var chatErrMsg = ${JSON.stringify(T.chatErr)};

        if (brandiForm) {
          brandiForm.addEventListener("submit", function(e){
            var text = (brandiInput.value || "").trim();
            if (!text) return;
            if (!window.fetch) return;
            e.preventDefault();

            var userRow = createMsgRow(youLabel, text, "is-client");
            brandiList.appendChild(userRow);
            brandiInput.value = "";
            brandiList.scrollTop = brandiList.scrollHeight;

            var typingRow = document.createElement("div");
            typingRow.className = "chat-msg-row is-ai";
            var typingBubble = document.createElement("div");
            typingBubble.className = "chat-msg-bubble";
            var typingDiv = document.createElement("div");
            typingDiv.className = "chat-typing";
            typingDiv.appendChild(document.createElement("span"));
            typingDiv.appendChild(document.createElement("span"));
            typingDiv.appendChild(document.createElement("span"));
            typingBubble.appendChild(typingDiv);
            typingRow.appendChild(typingBubble);
            brandiList.appendChild(typingRow);
            brandiList.scrollTop = brandiList.scrollHeight;

            brandiHistory.push({ role: "user", text: text });

            fetch(window.location.href, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Accept": "application/json" },
              body: JSON.stringify({ op: "brandi_chat", message: text, history: brandiHistory })
            })
            .then(function(r){
              if (!r.ok) throw new Error("status " + r.status);
              return r.json();
            })
            .then(function(res){
              if (typingRow && typingRow.parentNode) typingRow.parentNode.removeChild(typingRow);
              var replyText = res && res.reply ? res.reply : "no se ha podido procesar la respuesta.";
              brandiHistory.push({ role: "assistant", text: replyText, sig: res && res.sig ? res.sig : "" });

              var aiRow = createMsgRow(brandiLabel, replyText, "is-ai");
              brandiList.appendChild(aiRow);
              brandiList.scrollTop = brandiList.scrollHeight;
            })
            .catch(function(err){
              if (typingRow && typingRow.parentNode) typingRow.parentNode.removeChild(typingRow);
              if (userRow && userRow.parentNode) userRow.parentNode.removeChild(userRow);
              brandiHistory.pop();
              brandiInput.value = text;
              var errRow = createMsgRow(brandiLabel, chatErrMsg, "is-ai");
              brandiList.appendChild(errRow);
              brandiList.scrollTop = brandiList.scrollHeight;
            });
          });
        }

        if (humanForm) {
          humanForm.addEventListener("submit", function(e){
            var text = (humanInput.value || "").trim();
            if (!text) return;
            if (!window.fetch) return;
            e.preventDefault();

            var emptyMsg = document.getElementById("human-empty-msg");
            if (emptyMsg) emptyMsg.style.display = "none";

            var nowStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            var userRow = createMsgRow(youLabel, text, "is-client", nowStr);
            humanList.appendChild(userRow);
            humanInput.value = "";
            humanList.scrollTop = humanList.scrollHeight;

            fetch(window.location.href, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Accept": "application/json" },
              body: JSON.stringify({ op: "human_chat", message: text })
            })
            .then(function(r){
              if (!r.ok) throw new Error("status " + r.status);
              return r.json();
            })
            .catch(function(err){
              console.error("human chat error:", err);
              if (userRow && userRow.parentNode) userRow.parentNode.removeChild(userRow);
              humanInput.value = text;
              var errMsg = document.createElement("div");
              errMsg.className = "chat-intro-banner human-banner";
              errMsg.style.borderColor = "#E8A33D";
              var pErr = document.createElement("p");
              pErr.style.color = "#E8A33D";
              pErr.textContent = chatErrMsg;
              errMsg.appendChild(pErr);
              humanList.appendChild(errMsg);
              humanList.scrollTop = humanList.scrollHeight;
            });
          });
        }

        document.addEventListener("click", function(e){
          var btn = e.target.closest(".chat-trans-toggle");
          if (!btn) return;
          var bubble = btn.closest(".chat-msg-bubble");
          if (!bubble) return;
          var textEl = bubble.querySelector(".chat-msg-text");
          var labelEl = btn.querySelector(".chat-trans-label");
          if (!textEl) return;
          var orig = btn.getAttribute("data-orig") || "";
          var trans = btn.getAttribute("data-trans") || "";
          var showing = btn.getAttribute("data-showing") || "trans";
          if (showing === "trans") {
            textEl.textContent = orig;
            btn.setAttribute("data-showing", "orig");
            if (labelEl) labelEl.textContent = ${JSON.stringify(T.chatViewTrans)};
          } else {
            textEl.textContent = trans;
            btn.setAttribute("data-showing", "trans");
            if (labelEl) labelEl.textContent = ${JSON.stringify(T.chatTransIndicator)};
          }
        });
      })();
    </script>
  `;

  const fullHtml = `
    ${bannerHtml}
    ${headerHtml}
    <h3>${esc(T.state)}</h3>
    <div class="timeline">${phaseCards.join("")}</div>
    ${postDeliveryHtml}
    ${chatSectionHtml}
    ${reviewCardHtml}
    ${materialsBox}
    ${referencesBox}
    ${addFormHtml}`;

  return htmlResponse(
    page(`${T.title} — ${proj.brand}`, T.heading, "", {
      lang: L,
      eyebrow: T.eyebrow,
      wide: true,
      html: fullHtml,
      overlay: undoHtml,
    }),
    200
  );
}

// ── GESTIÓN Y RESPUESTA DE CHAT DEL ESTUDIO (/responder-chat) ──
async function handleStudioChat(request, env, ctx, url) {
  if (ctx instanceof URL || (ctx && typeof ctx.searchParams === "object")) {
    url = ctx;
    ctx = null;
  }
  if (!env.LEADS_KV || !env.RESEND_API_KEY) {
    return htmlResponse(page("configuración", "error de configuración", "faltan variables en el servidor."), 500);
  }

  const p = url.searchParams.get("p");
  const t = url.searchParams.get("t");
  if (!p || !/^[a-f0-9]{64}$/.test(p) || !t || !/^[a-f0-9]{64}$/.test(t)) {
    return htmlResponse(page("enlace inválido", "enlace inválido", "el enlace de gestión del chat no es válido."), 400);
  }

  const key = await getKey(env);
  const ok = await verifyRaw(key, `adminchat|${p}`, t);
  if (!ok) {
    return htmlResponse(page("no autorizado", "enlace caducado o alterado", "el token de seguridad no coincide."), 403);
  }

  const rawProj = await env.LEADS_KV.get(`project:${p}`);
  if (!rawProj) {
    return htmlResponse(page("no encontrado", "proyecto no encontrado", "no hemos encontrado este proyecto."), 404);
  }
  const proj = JSON.parse(rawProj);
  const projectPageUrl = buildUrl("/proyecto", { token: p });
  const chatKey = `project_chat:${p}`;
  const chatHistory = (await env.LEADS_KV.get(chatKey, { type: "json" })) || [];

  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    const replyText = cleanInput(form?.get("reply") || "", 2500);
    if (!replyText) {
      return htmlResponse(
        page("mensaje vacío", "falta el texto de la respuesta", "escribe un mensaje para enviar al cliente.", {
          eyebrow: "panel interno del estudio",
          footerUrl: url.href,
          footerLabel: "volver al chat",
        }),
        400
      );
    }

    const lang = pickLang(proj.lang);
    let translatedToClient = null;
    if (lang !== "es" && env.GROQ_API_KEY) {
      try {
        translatedToClient = await translateMessageText(env, replyText, "es", lang);
      } catch (e) {
        console.warn("translateMessageText to client failed:", e?.message);
      }
    }

    const msgId = randomHex(8);
    const newMsg = {
      id: msgId,
      sender: "studio",
      text: replyText,
      date: new Date().toISOString(),
      ...(translatedToClient && translatedToClient !== replyText ? { translations: { [lang]: translatedToClient } } : {}),
    };
    chatHistory.push(newMsg);
    await env.LEADS_KV.put(chatKey, JSON.stringify(chatHistory.slice(-100)));

    const emChat = EM[lang].chat;
    const clientQuote = translatedToClient && translatedToClient !== replyText
      ? translatedToClient
      : replyText;
    const clientNote = translatedToClient && translatedToClient !== replyText
      ? `${emChat.autoTranslatedNotice}. ${emChat.confirmSoon}`
      : emChat.confirmSoon;

    const sendReplyTask = async () => {
      try {
        await resendSend(
          env,
          {
            to: [proj.clientEmail],
            reply_to: "hola@rebrandyourbrand.es",
            subject: emChat.replySubject(proj.brand),
            ...renderEmail(lang, {
              paras: [
                emChat.hello,
                emChat.replyIntro(bold(proj.brand)),
              ],
              quote: clientQuote,
              cta: { label: emChat.viewPortal, url: projectPageUrl + "#chat-human" },
              note: clientNote,
            }),
          },
          `chat-reply-${p}-${msgId}`
        );
      } catch (e) {
        console.error("error sending studio chat reply email:", e?.message);
      }
    };

    if (ctx?.waitUntil) {
      ctx.waitUntil(sendReplyTask());
    } else {
      await sendReplyTask();
    }
    return redirectTo(buildUrl("/responder-chat", { p, t, sent: "1" }));
  }

  const sentNotice = url.searchParams.get("sent") === "1"
    ? `<div class="banner-ok" style="margin-bottom:1.25rem;"><p>respuesta enviada con éxito a ${esc(proj.clientEmail)}. el cliente ha recibido la notificación por correo y el mensaje se ha guardado en su panel.</p></div>`
    : "";

  if (proj.lang !== "es" && chatHistory.length && env.GROQ_API_KEY) {
    const pendingClient = chatHistory
      .filter((m) => m && m.sender === "client" && m.text && (!m.translations || !m.translations.es))
      .slice(-2);

    if (pendingClient.length > 0) {
      let anyUpdated = false;
      await Promise.all(
        pendingClient.map(async (m) => {
          const tr = await translateMessageText(env, m.text, proj.lang, "es");
          m.translations = m.translations || {};
          m.translations.es = tr || m.text;
          anyUpdated = true;
        })
      );
      if (anyUpdated) {
        await env.LEADS_KV.put(chatKey, JSON.stringify(chatHistory.slice(-100))).catch(() => {});
      }
    }
  }
  if (proj.lang !== "es" && chatHistory.length && env.GROQ_API_KEY) {
    let missingTrans = false;
    for (const m of chatHistory) {
      if (m && m.sender === "client" && m.text && (!m.translations || !m.translations.es)) {
        missingTrans = true;
        break;
      }
    }
    if (missingTrans) {
      await Promise.all(
        chatHistory.map(async (m) => {
          if (m && m.sender === "client" && m.text && (!m.translations || !m.translations.es)) {
            const tr = await translateMessageText(env, m.text, proj.lang, "es");
            if (tr && tr !== m.text) {
              m.translations = m.translations || {};
              m.translations.es = tr;
            }
          }
        })
      );
      await env.LEADS_KV.put(chatKey, JSON.stringify(chatHistory.slice(-100))).catch(() => {});
    }
  }

  const historyHtml = chatHistory.length
    ? chatHistory
        .map((m) => {
          const isStudio = m.sender === "studio";
          const author = isStudio ? "estudio (gael y bernat)" : `cliente (${proj.brand})`;
          const cls = isStudio ? "is-studio" : "is-client";
          const hasTrans = !isStudio && proj.lang !== "es" && m.translations && m.translations.es && m.translations.es !== m.text;
          const displayText = hasTrans ? m.translations.es : m.text;
          const toggleHtml = hasTrans
            ? `<div class="chat-trans-wrap">
                <button type="button" class="chat-trans-toggle" data-orig="${esc(m.text)}" data-trans="${esc(m.translations.es)}" data-showing="trans">
                  <svg class="chat-trans-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>
                  <span class="chat-trans-label">traducido automáticamente, haz clic para ver el mensaje original</span>
                </button>
              </div>`
            : "";
          return `<div class="chat-msg-row ${cls}" style="margin-bottom:.75rem;">
            <div class="chat-msg-bubble">
              <div class="chat-msg-head">
                <span class="chat-msg-author">${esc(author)}</span>
                <span class="chat-msg-date">${esc(fmtDate(m.date, "es"))}</span>
              </div>
              <div class="chat-msg-text">${esc(displayText)}</div>
              ${toggleHtml}
            </div>
          </div>`;
        })
        .join("")
    : `<div class="chat-empty">no hay mensajes en el historial todavía.</div>`;
  const html = `
    ${sentNotice}
    <div class="box" style="margin-bottom:1.5rem;">
      <div class="kv">
        <div class="kv-row"><span>marca</span><span class="kv-val">${esc(proj.brand)}</span></div>
        <div class="kv-row"><span>correo del cliente</span><span class="kv-val">${esc(proj.clientEmail)}</span></div>
        <div class="kv-row"><span>servicios</span><span class="kv-val">${esc(svcLabel(proj.services, "es"))}</span></div>
        <div class="kv-row"><span>estado</span><span class="kv-val">${esc(proj.status)}</span></div>
      </div>
    </div>
    <h3>conversación con el cliente</h3>
    <div class="chat-msg-list" style="margin-bottom:1.5rem;background:rgba(255,255,255,.5);padding:1rem;border-radius:14px;border:1px solid rgba(228,222,208,.8);">
      ${historyHtml}
    </div>
    <form method="POST">
      <label for="reply-input">responder a ${esc(proj.brand)}:</label>
      <textarea id="reply-input" name="reply" rows="4" placeholder="escribe tu respuesta para el cliente..." required></textarea>
      <button type="submit">enviar respuesta al cliente</button>
    </form>
    <script>
      (function(){
        document.addEventListener("click", function(e){
          var btn = e.target.closest(".chat-trans-toggle");
          if (!btn) return;
          var bubble = btn.closest(".chat-msg-bubble");
          if (!bubble) return;
          var textEl = bubble.querySelector(".chat-msg-text");
          var labelEl = btn.querySelector(".chat-trans-label");
          if (!textEl) return;
          var orig = btn.getAttribute("data-orig") || "";
          var trans = btn.getAttribute("data-trans") || "";
          var showing = btn.getAttribute("data-showing") || "trans";
          if (showing === "trans") {
            textEl.textContent = orig;
            btn.setAttribute("data-showing", "orig");
            if (labelEl) labelEl.textContent = "ver traducción automática";
          } else {
            textEl.textContent = trans;
            btn.setAttribute("data-showing", "trans");
            if (labelEl) labelEl.textContent = "traducido automáticamente, haz clic para ver el mensaje original";
          }
        });
      })();
    </script>
  `;

  return htmlResponse(
    page(`chat con ${proj.brand}`, `chat — ${proj.brand}`, "historial y respuesta directa al cliente.", {
      eyebrow: "panel interno del estudio",
      wide: true,
      html,
      footerUrl: projectPageUrl,
      footerLabel: "ver panel público del cliente",
    }),
    200
  );
}

// ── VALORACIÓN VERIFICADA (/valorar) ──
async function handleReview(request, env, ctx, url) {
  if (ctx instanceof URL || (ctx && typeof ctx.searchParams === "object")) {
    url = ctx;
    ctx = null;
  }
  let L = langFromRequest(request);
  const p = url.searchParams.get("p");
  const t = url.searchParams.get("t");
  if (!p || !/^[a-f0-9]{64}$/.test(p) || !t || !/^[a-f0-9]{64}$/.test(t)) return msgPage(L, "invalid", 400);
  if (!env.LEADS_KV || !env.RESEND_API_KEY) return msgPage(L, "config", 500);

  const key = await getKey(env);
  if (!(await verifyRaw(key, `review|${p}`, t))) return msgPage(L, "invalid", 400);

  const raw = await env.LEADS_KV.get(`project:${p}`);
  if (!raw) return msgPage(L, "trackMissing", 404);
  const proj = JSON.parse(raw);
  L = pickLang(proj.lang);
  const trackingUrl = buildUrl("/proyecto", { token: p });

  let finished =
    proj.paid &&
    Array.isArray(proj.phases) &&
    proj.phases.length > 0 &&
    proj.phases.every((ph) => ph.status === "done");
  if (!finished) {
    if (checkAllServicesApproved(proj)) {
      await finalizeProjectClosure(env, proj, p);
      finished = true;
    } else {
      return msgPage(L, "rvNotReady", 403, { footerUrl: trackingUrl, footerLabel: PG[L].common.openTracker });
    }
  }
  if (proj.reviewSubmitted) return msgPage(L, "rvDone", 200, { footerUrl: trackingUrl, footerLabel: PG[L].common.openTracker });

  const R = PG[L].rv;
  if (request.method === "GET" || request.method === "HEAD") {
    const stars5 = [5, 4, 3, 2, 1]
      .map((n) => `<option value="${n}">${"★".repeat(n)}${"☆".repeat(5 - n)} (${n}/5)</option>`)
      .join("");
    const formHtml = `<form method="POST" style="text-align:left;">
      <label>${esc(R.business)}</label><input type="text" value="${esc(proj.brand)}" readonly>
      <label for="name">${esc(R.name)}</label><input id="name" name="name" type="text" required maxlength="80" autocomplete="name">
      <label for="rating">${esc(R.rating)}</label><select id="rating" name="rating">${stars5}</select>
      <label for="comment">${esc(R.comment)}</label><textarea id="comment" name="comment" required rows="4" maxlength="300"></textarea>
      <button type="submit">${esc(R.submit)}</button>
    </form>`;
    return htmlResponse(
      page(R.title, R.heading, R.intro, {
        lang: L,
        eyebrow: R.eyebrow,
        html: formHtml,
        footerUrl: trackingUrl,
        footerLabel: PG[L].common.openTracker,
      }),
      200
    );
  }
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
  }

  const form = await request.formData().catch(() => null);
  const name = cleanInput(form?.get("name") ?? "", 80);
  const comment = cleanNote(form?.get("comment") ?? "", 300);
  const rating = Math.min(5, Math.max(1, parseInt(form?.get("rating"), 10) || 5));
  if (!name || !comment) return msgPage(L, "rvMissing", 400);

  const business = cleanInput(proj.brand ?? "", 80);
  const token = randomHex(32);
  const review = {
    id: token.slice(0, 16),
    name,
    business,
    rating,
    comment,
    date: new Date().toISOString(),
    verified: true,
  };
  await env.LEADS_KV.put(`testimonial:${token}`, JSON.stringify(review), {
    expirationTtl: TESTIMONIAL_TTL_SECONDS,
  });

  try {
    await resendSend(
      env,
      {
        to: ["hola@rebrandyourbrand.es"],
        subject: `nueva reseña pendiente de ${business} (${rating}/5)`,
        ...renderEmail("es", {
          paras: [
            "nueva valoración de un cliente verificado (proyecto finalizado):",
            lines(
              `— nombre: ${bold(name)}`,
              `— negocio: ${bold(business)}`,
              `— servicios: ${bold(svcLabel(proj.services, "es"))}`,
              `— valoración: ${bold(`${rating}/5`)}`
            ),
            "comentario:",
          ],
          quote: comment,
          cta: { label: "aprobar o rechazar reseña", url: buildUrl("/testimonial", { token }) },
        }),
      },
      `testimonial-${token}`
    );
  } catch (e) {
    console.error("Testimonial email failed:", e?.message);
    await env.LEADS_KV.delete(`testimonial:${token}`).catch(() => {});
    return msgPage(L, "error", 502);
  }

  proj.reviewSubmitted = true;
  await saveProject(env, p, proj);
  return msgPage(L, "rvThanks", 200, {
    footerUrl: trackingUrl,
    footerLabel: PG[L].common.openTracker,
  });
}

// ── MODERACIÓN DE RESEÑA (/testimonial) ──
async function handleTestimonialReview(request, env, ctx, url) {
  if (ctx instanceof URL || (ctx && typeof ctx.searchParams === "object")) {
    url = ctx;
    ctx = null;
  }
  const token = url.searchParams.get("token");
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return htmlResponse(page("inválido", "enlace inválido", "el enlace no es válido."), 400);
  }
  if (!env.LEADS_KV) {
    return htmlResponse(page("error", "error de configuración", "falta el kv."), 500);
  }

  const raw = await env.LEADS_KV.get(`testimonial:${token}`);
  if (!raw) {
    return htmlResponse(
      page("expirado", "reseña ya gestionada", "esta reseña ya fue aprobada, rechazada o ha caducado."),
      400
    );
  }
  const review = JSON.parse(raw);

  if (request.method === "GET" || request.method === "HEAD") {
    const buttons = `<blockquote>${esc(review.comment)}</blockquote>
      <form method="POST"><button type="submit" name="decision" value="approve">aprobar y publicar</button><button type="submit" name="decision" value="reject" class="no">rechazar</button></form>`;
    return htmlResponse(
      page(
        "moderar reseña",
        "nueva reseña verificada",
        `${review.business} — ${review.name} — ${stars(review.rating)}`,
        { eyebrow: "moderación interna", html: buttons }
      ),
      200
    );
  }
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
  }

  const decision = (await request.formData().catch(() => null))?.get("decision");

  if (decision === "approve") {
    const approved = (await env.LEADS_KV.get(APPROVED_KEY, { type: "json" })) || [];
    approved.unshift(review);
    await env.LEADS_KV.put(APPROVED_KEY, JSON.stringify(approved.slice(0, MAX_APPROVED_TESTIMONIALS)));
    await env.LEADS_KV.delete(`testimonial:${token}`);

    try {
      const key = await getKey(env);
      const deleteToken = await testimonialDeleteToken(key, review.id);
      const deleteUrl = buildUrl("/testimonial-delete", { token: deleteToken, id: review.id });
      await resendSend(
        env,
        {
          to: ["hola@rebrandyourbrand.es"],
          subject: `reseña publicada de ${review.business} (${review.rating}/5) — enlace para eliminar`,
          ...renderEmail("es", {
            paras: [
              "hola,",
              `la reseña de ${bold(review.business)} (${esc(review.name)}, ${review.rating}/5) ya está publicada en la web.`,
              "comentario:",
            ],
            quote: review.comment,
            cta: { label: "eliminar reseña", url: deleteUrl },
            note: "si necesitas retirarla más adelante, usa este botón y te pediremos confirmación antes de borrarla.",
          }),
        },
        `approved-${review.id}`
      );
    } catch (e) {
      console.error("approved testimonial email failed:", e?.message);
    }
    return htmlResponse(
      page(
        "publicada",
        "reseña publicada",
        "ya aparece en la web. te hemos enviado un correo con un botón por si quieres eliminarla más adelante.",
        { eyebrow: "moderación interna" }
      ),
      200
    );
  }

  if (decision === "reject") {
    await env.LEADS_KV.delete(`testimonial:${token}`);
    return htmlResponse(
      page("rechazada", "reseña rechazada", "se ha descartado y no se publicará.", {
        eyebrow: "moderación interna",
      }),
      200
    );
  }

  return htmlResponse(page("error", "acción no válida", "vuelve a abrir el enlace del correo."), 400);
}

// ── ELIMINAR UNA RESEÑA YA PUBLICADA (/testimonial-delete) ──
async function handleTestimonialDelete(request, env, ctx, url) {
  if (ctx instanceof URL || (ctx && typeof ctx.searchParams === "object")) {
    url = ctx;
    ctx = null;
  }
  const token = url.searchParams.get("token");
  const id = url.searchParams.get("id");
  if (!token || !/^[a-f0-9]{64}$/.test(token) || !id || !/^[a-f0-9]{16}$/.test(id)) {
    return htmlResponse(page("inválido", "enlace inválido", "el enlace no es válido."), 400);
  }
  if (!env.LEADS_KV) return htmlResponse(page("error", "error de configuración", "falta el kv."), 500);

  const key = await getKey(env);
  if (!(await verifyRaw(key, `tdel|${id}`, token))) {
    return htmlResponse(page("inválido", "enlace inválido", "el enlace no es válido."), 400);
  }

  const approved = (await env.LEADS_KV.get(APPROVED_KEY, { type: "json" })) || [];
  const review = approved.find((r) => r.id === id);
  if (!review) {
    return htmlResponse(
      page("no encontrada", "reseña no encontrada", "esta reseña ya se eliminó o ya no está publicada."),
      404
    );
  }

  if (request.method === "GET" || request.method === "HEAD") {
    const html = `<blockquote>${esc(review.comment)}</blockquote>
      <form method="POST"><button type="submit">eliminar definitivamente</button></form>`;
    return htmlResponse(
      page(
        "eliminar reseña",
        "eliminar reseña",
        `${review.business} — ${review.name} — ${stars(review.rating)}`,
        { eyebrow: "moderación interna", html }
      ),
      200
    );
  }
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
  }

  await env.LEADS_KV.put(APPROVED_KEY, JSON.stringify(approved.filter((r) => r.id !== id)));
  return htmlResponse(
    page(
      "eliminada",
      "reseña eliminada",
      "ya no aparecerá en la web (la lista pública puede tardar un minuto en actualizarse).",
      { eyebrow: "moderación interna" }
    ),
    200
  );
}

// ── FORMULARIO OPCIONAL POR CORREO (/webhook/email) ──
async function handleEmailForm(request, env, originOk, o) {
  if (!ENABLE_EMAIL_FORM) return jsonResponse({ error: "not_found" }, 404, null);
  if (!originOk) return jsonResponse({ error: "forbidden_origin" }, 403, null);
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405, o, { Allow: "POST, OPTIONS" });
  }
  if (!env.LEADS_KV || !env.RESEND_API_KEY || !env.CHAT_LIMITER || !env.TURNSTILE_SECRET_KEY) {
    return jsonResponse({ error: "misconfigured" }, 500, o);
  }

  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_BODY_BYTES) return jsonResponse({ error: "payload_too_large" }, 413, o);
  const raw = await request.text();
  if (enc.encode(raw).byteLength > MAX_BODY_BYTES) return jsonResponse({ error: "payload_too_large" }, 413, o);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400, o);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "invalid_json" }, 400, o);
  }

  try {
    const ip = request.headers.get("CF-Connecting-IP") ?? "";
    if (env.CHAT_LIMITER) {
      const { success } = await env.CHAT_LIMITER.limit({ key: `e:${ipKey(ip)}` });
      if (!success) throw new HttpError(429, "rate_limited", { "Retry-After": "60" });
    }
    if (env.VERIFY_LIMITER) {
      const { success: okV } = await env.VERIFY_LIMITER.limit({ key: `v:${ipKey(ip)}` });
      if (!okV) throw new HttpError(429, "rate_limited", { "Retry-After": "60" });
    }
    await verifyTurnstile(env, body.token, ip, "email-form");

    const clientEmail = String(body.email ?? "").toLowerCase().trim();
    const brand = cleanBrand(body.brand);
    if (clientEmail.length > 254 || !EMAIL_RE.test(clientEmail) || !brand) {
      throw new HttpError(400, "missing_fields");
    }

    const plan = normalizeServices(body.services);
    if (!plan) throw new HttpError(400, "plan_required");

    const lang = LANG_ORDER.includes(body.lang) ? body.lang : "es";
    const description = cleanText(body.description, 500) || "sin descripción";

    await startVerification(env, {
      lang,
      messages: [{ role: "user", text: `Solicitud por formulario. Descripción: ${description}` }],
      plan,
      clientEmail,
      brand,
    });
    return jsonResponse({ success: true }, 200, o);
  } catch (err) {
    if (err instanceof HttpError) return jsonResponse({ error: err.code }, err.status, o, err.headers);
    console.error("email form unhandled:", err?.message);
    return jsonResponse({ error: "internal_error" }, 500, o);
  }
}

// ══ chat.js — Chat con Brandi: sesión de Turnstile, resumen instantáneo, confirmación y estado. ══

// Verificación pendiente: estado / reenviar / empezar de nuevo.
// El token firmado de reanudación hace de credencial, así quien vuelve no repite el captcha.

async function handlePendingAction(env, body, ip, o) {
  if (!env.LEADS_KV || !env.RESEND_API_KEY) throw new HttpError(500, "misconfigured");
  if (env.CHAT_LIMITER) {
    const { success } = await env.CHAT_LIMITER.limit({ key: `p:${ipKey(ip)}` });
    if (!success) throw new HttpError(429, "rate_limited", { "Retry-After": "60" });
  }

  const vt = await parseResume(await getKey(env), body.resume);
  if (!vt) throw new HttpError(400, "invalid_resume");

  const okTok = await checkRateLimit(env, `pending_tok:${vt.slice(0, 24)}`, 4, 3600);
  if (!okTok) throw new HttpError(429, "rate_limited", { "Retry-After": "60" });

  const pendingKey = `pending:${vt}`;
  const raw = await env.LEADS_KV.get(pendingKey);
  if (!raw) throw new HttpError(410, "expired");
  const data = JSON.parse(raw);

  const hasProject = typeof data.projectToken === "string" && /^[a-f0-9]{64}$/.test(data.projectToken);
  const projectUrl = hasProject ? buildUrl("/proyecto", { token: data.projectToken }) : "";
  const verified = !!data.leadDelivered || hasProject || isStripeUrl(data.checkoutUrl);
  const email = maskEmail(data.clientEmail);

  if (body.op === "status") {
    return jsonResponse(
      { state: verified ? "verified" : "pending", email, ...(projectUrl ? { projectUrl } : {}) },
      200,
      o
    );
  }

  if (body.op === "restart") {
    if (!verified) {
      await Promise.all([
        env.LEADS_KV.delete(pendingKey),
        env.LEADS_KV.delete(`cooldown:${data.clientEmail}`),
      ]);
    }
    return jsonResponse({ ok: true }, 200, o);
  }

  if (body.op === "resend") {
    if (verified) {
      return jsonResponse({ state: "verified", email, ...(projectUrl ? { projectUrl } : {}) }, 200, o);
    }
    const used = data.resends || 0;
    if (used >= MAX_RESENDS) throw new HttpError(429, "resend_limit");
    const cdKey = `resend-cd:${vt}`;
    if (await env.LEADS_KV.get(cdKey)) {
      throw new HttpError(429, "email_cooldown", { "Retry-After": String(RESEND_COOLDOWN_SECONDS) });
    }
    await env.LEADS_KV.put(cdKey, "1", { expirationTtl: RESEND_COOLDOWN_SECONDS });
    try {
      await sendVerifyEmail(env, data, vt, used + 1);
    } catch (e) {
      await env.LEADS_KV.delete(cdKey).catch(() => {});
      console.error("resend verification failed:", e?.message);
      throw new HttpError(502, "email_error");
    }
    data.resends = used + 1;
    await env.LEADS_KV.put(pendingKey, JSON.stringify(data), { expirationTtl: PENDING_VERIFY_TTL_SECONDS });
    return jsonResponse({ state: "pending", email, left: MAX_RESENDS - data.resends }, 200, o);
  }

  throw new HttpError(400, "invalid_op");
}

const CHANGE_INTENT_RE =
  /\b(?:pero|cambiar|cambio|añad\w*|quit\w*|mejor|però|canvi\w*|afeg\w*|treu\w*|baina|aldatu|gehitu|kendu|but|change|add|remove|instead)\b/iu;

const SERVICE_MENTION_RE = /\b(?:logo\w*|palet\w*|color\w*|kolore\w*|web\w*)\b/iu;

async function handleChatPost(request, env, body, o, ctx) {
  try {
    const ip = request.headers.get("CF-Connecting-IP") ?? "";

    // ── SESIÓN DE CHAT: Turnstile una sola vez al empezar la conversación ──
    if (body.action === "session") {
      if (!env.TURNSTILE_SECRET_KEY) throw new HttpError(500, "misconfigured");
      if (env.CHAT_LIMITER) {
        const { success } = await env.CHAT_LIMITER.limit({ key: `s:${ipKey(ip)}` });
        if (!success) throw new HttpError(429, "rate_limited", { "Retry-After": "60" });
      }
      await verifyTurnstile(env, body.token, ip, "brandi-chat");
      return jsonResponse({ session: await makeSession(await getKey(env), ip) }, 200, o);
    }

    // ── VERIFICACIÓN PENDIENTE (estado, reenviar, empezar de nuevo) ──
    if (body.action === "pending") return await handlePendingAction(env, body, ip, o);

    // ── CHAT CON BRANDI ──
    if (!env.GROQ_API_KEY || !env.TURNSTILE_SECRET_KEY) {
      throw new HttpError(500, "misconfigured");
    }
    if (env.CHAT_LIMITER) {
      const { success } = await env.CHAT_LIMITER.limit({ key: ipKey(ip) });
      if (!success) throw new HttpError(429, "rate_limited", { "Retry-After": "60" });
    }

    const lang = LANG_ORDER.includes(body.lang) ? body.lang : "es";
    const key = await getKey(env);
    const rawAllMessages = Array.isArray(body.messages)
      ? body.messages
          .slice(-60)
          .filter((m) => m && m.role === "user" && typeof m.text === "string")
          .map((m) => ({ role: "user", text: m.text.slice(0, 500) }))
      : [];
    const fullEmail = findEmail(rawAllMessages);
    const fullDomain = findDomain(rawAllMessages);

    const chatMessages = await normalizeMessages(key, body.messages);
    if (!chatMessages.length || chatMessages.at(-1).role !== "user") {
      throw new HttpError(400, "invalid_messages");
    }

    const plan0 = normalizeServices(body.services);

    if (!(await verifySession(key, body.session, ip))) throw new HttpError(403, "session_invalid");

    const email = findEmail(chatMessages) || fullEmail;
    const brand0 = cleanBrand(body.brand);
    const domain0 = cleanInput(body.domain, 200) || findDomain(chatMessages) || fullDomain;
    const confirmSigIn = typeof body.confirmSig === "string" ? body.confirmSig : "";
    const isShown = async (p, b, d) =>
      !!(email && b && p && (!p.ids.includes("web") || d)) &&
      (await verifyRaw(key, confirmPayload(email, b, p, d), confirmSigIn));

    const confirmAndSend = async (plan, brand, domain) => {
      if (!env.RESEND_API_KEY) throw new HttpError(500, "misconfigured");
      if (!plan) throw new HttpError(400, "plan_required");
      if (!brand) throw new HttpError(400, "brand_required");
      if (!(await isShown(plan, brand, domain))) throw new HttpError(400, "invalid_confirmation");

      if (env.VERIFY_LIMITER) {
        const { success: okV } = await env.VERIFY_LIMITER.limit({ key: `v:${ipKey(ip)}` });
        if (!okV) throw new HttpError(429, "rate_limited", { "Retry-After": "60" });
      }

      const verifyToken = await startVerification(env, {
        lang,
        messages: chatMessages,
        plan,
        clientEmail: email,
        brand,
        domain,
      });
      const reply = MSG[lang].sent;
      return jsonResponse(
        {
          reply,
          sig: await signMsg(key, reply),
          leadClosed: true,
          canConfirm: false,
          confirmSig: "",
          brand,
          domain: domain || undefined,
          services: planOut(plan),
          resume: `${verifyToken}.${await resumeSig(key, verifyToken)}`,
          emailHint: maskEmail(email),
        },
        200,
        o
      );
    };

    if (body.confirm === true) {
      return await confirmAndSend(plan0, brand0, domain0);
    }

    const lastText = chatMessages.at(-1)?.text || "";
    const userDenied = DENY_RE.test(lastText);
    const userAgreed =
      lastText.length <= 60 && AGREE_RE.test(lastText) && !userDenied && !CHANGE_INTENT_RE.test(lastText);

    const summaryResponse = async (plan, brand, domain) => {
      const reply = buildSummary(lang, { brand, email, plan, domain });
      const confirmSig = await signRaw(key, confirmPayload(email, brand, plan, domain));
      return jsonResponse(
        {
          reply,
          sig: await signMsg(key, reply),
          leadClosed: false,
          canConfirm: true,
          confirmSig,
          brand,
          domain: domain || undefined,
          services: planOut(plan),
        },
        200,
        o
      );
    };

    const wasShown = await isShown(plan0, brand0, domain0);

    // Si el resumen ya estaba en pantalla y el cliente escribe "sí"/"vale"/"ok"/"bai", confirmamos sin bucle
    if (wasShown && userAgreed) {
      return await confirmAndSend(plan0, brand0, domain0);
    }

    // Si el cliente acaba de dar el último dato que faltaba sin pedir cambios, devolvemos el resumen al instante sin llamar a Groq
    const missing0 = missingOf(brand0, email, plan0, domain0);
    const textWithoutEmail = lastText.replace(EMAIL_FIND, "").trim();
    if (
      !missing0.length &&
      !wasShown &&
      !userDenied &&
      !CHANGE_INTENT_RE.test(textWithoutEmail) &&
      !SERVICE_MENTION_RE.test(textWithoutEmail)
    ) {
      return await summaryResponse(plan0, brand0, domain0);
    }

    const out = await askGroq(
      env,
      lang,
      { plan: plan0, brand: brand0, email, domain: domain0, denied: wasShown && userDenied },
      chatMessages
    );

    const plan = mergeServices(plan0, out);
    const brand = cleanBrand(out.brand) || brand0;
    const domain = cleanInput(out.domain, 200) || domain0 || findDomain(chatMessages);
    const missing = missingOf(brand, email, plan, domain);

    if (!missing.length) {
      const shownNow = await isShown(plan, brand, domain);
      if (!shownNow) return await summaryResponse(plan, brand, domain);
    }

    let reply = String(out.reply ?? "").trim().slice(0, 2000);
    if (!reply || hasUnknownPrice(reply) || hasUnknownPercent(reply)) {
      reply = missing.length ? ASK[lang][missing[0]] : MSG[lang].fallback;
    }

    const keepSig = !missing.length ? confirmSigIn : "";
    return jsonResponse(
      {
        reply,
        sig: await signMsg(key, reply),
        leadClosed: false,
        canConfirm: false,
        confirmSig: keepSig,
        brand,
        domain: domain || undefined,
        services: planOut(plan),
      },
      200,
      o
    );
  } catch (err) {
    if (err instanceof HttpError) return jsonResponse({ error: err.code }, err.status, o, err.headers);
    console.error("unhandled", err?.message);
    return jsonResponse({ error: "internal_error" }, 500, o);
  }
}

// ══ cron.js — Tareas programadas (Cron Trigger): recordatorios de revisión y renovaciones anuales. ══

async function inspectProjectDeadlines(env, keyName, nowMs) {
  const raw = await env.LEADS_KV.get(keyName);
  if (!raw) return;

  let proj;
  try {
    proj = JSON.parse(raw);
  } catch {
    return;
  }
  if (!proj || !proj.paid) return;

  const projectToken = proj.token || keyName.replace(/^project:/, "");
  if (!/^[a-f0-9]{64}$/.test(projectToken)) return;

  const lang = pickLang(proj.lang);
  const nowIso = new Date(nowMs).toISOString();
  let changed = false;

  // Envío diferido de materiales si expiró el tiempo de 60s sin deshacer
  if (proj.pendingMaterialsNotice && nowMs - (Number(proj.pendingMaterialsNotice.timestamp) || 0) >= 60000) {
    await flushPendingMaterialsNotice(env, projectToken, proj);
    changed = true;
  }

  // 0. Cierre automático y rescate si todos los servicios contratados están aprobados
  if (Array.isArray(proj.phases) && proj.phases.length > 0 && proj.phases.every((ph) => ph.status === "done") && (!proj.finishedAt || !proj.reviewInvited || proj.status !== "done")) {
    await finalizeProjectClosure(env, proj, projectToken);
    changed = true;
  }

  // 1. Cláusula 3.3 — Recordatorio amistoso a los 15 días si la fase sigue en espera de validación (el proyecto avanza al ritmo del cliente)
  if (Array.isArray(proj.phases)) {
    for (const ph of proj.phases) {
      if (ph.status !== "review" || !ph.reviewSentAt) continue;
      const sentMs = new Date(ph.reviewSentAt).getTime();
      if (Number.isNaN(sentMs)) continue;
      const daysElapsed = (nowMs - sentMs) / DAY_MS;

      if (daysElapsed >= CLIENT_PAUSE_REMINDER_DAYS && !ph.reminderSentAt) {
        const t = EM[lang].tacitReminder;
        const phName = phaseTitle(ph, lang);
        const appUrl = await approvePhaseUrl(env, projectToken, ph.step);
        const trackingUrl = buildUrl("/proyecto", { token: projectToken });
        try {
          await resendSend(
            env,
            {
              to: [proj.clientEmail],
              reply_to: "hola@rebrandyourbrand.es",
              subject: t.subject(proj.brand, phName),
              ...renderEmail(lang, {
                paras: [t.hello, t.intro(bold(proj.brand), bold(phName)), t.body],
                cta: { label: t.cta, url: appUrl },
                secondaryLink: {
                  label: ph.deliverableUrl ? EM[lang].proposal.openDeliverable : EM[lang].phase.cta,
                  url: ph.deliverableUrl || trackingUrl,
                },
                note: t.note,
              }),
            },
            `pause-15d-${projectToken}-${ph.step}-${ph.reviewSentAt.slice(0, 10)}`
          );
          ph.reminderSentAt = nowIso;
          changed = true;
        } catch (e) {
          console.error("pause 15d reminder failed:", e?.message);
        }
      }
    }
  }

  // 2. Cláusula 3.2 — Preaviso a los 30 días y rescisión por abandono a los 37 días sin actividad
  if (proj.status === "active" || proj.status === "in_progress") {
    const hasMaterials =
      (Array.isArray(proj.materialsList) &&
        proj.materialsList.some((m) => m && (m.id !== "init" || m.url || m.fileId || m.fileUrl || m.notes || m.socials))) ||
      Boolean(proj.onboarding && (proj.onboarding.materials || proj.onboarding.socials || proj.onboarding.url || proj.onboarding.notes));
    const currentStep = Number(proj.currentPhase || 0);
    const isFirstPhase = currentStep <= 1;
    const currentPhaseObj = Array.isArray(proj.phases)
      ? proj.phases.find((ph) => ph.step === currentStep || ph.status === "active" || ph.status === "review")
      : null;
    const waitingMaterials = Boolean(
      isFirstPhase &&
      !currentPhaseObj?.deliverableUrl &&
      !proj.onboardingDone &&
      !proj.onboardingSubmittedAt &&
      !proj.materialsReceivedAt &&
      !hasMaterials
    );
    const reviewPhase = Array.isArray(proj.phases)
      ? proj.phases.find((ph) => ph.status === "review" && ph.reviewSentAt)
      : null;
    const waitingReview = Boolean(reviewPhase);
    const waitingForClient = waitingMaterials || waitingReview;

    if (waitingForClient) {
      const inactiveStart = waitingMaterials
        ? (proj.paidAt || proj.createdAt)
        : (reviewPhase.reviewSentAt || proj.lastClientActivityAt);
      const inactiveMs = new Date(inactiveStart).getTime();
      if (!Number.isNaN(inactiveMs)) {
        const daysInactive = (nowMs - inactiveMs) / DAY_MS;
        if (daysInactive >= ABANDON_WARNING_DAYS) {
          const trackingUrl = buildUrl("/proyecto", { token: projectToken });
          if (!proj.abandonWarningSentAt) {
            const tWarn = EM[lang].abandonWarning;
            try {
              await resendSend(
                env,
                {
                  to: [proj.clientEmail],
                  reply_to: "hola@rebrandyourbrand.es",
                  subject: tWarn.subject(proj.brand),
                  ...renderEmail(lang, {
                    paras: [tWarn.hello, tWarn.intro(proj.brand), tWarn.body],
                    cta: { label: tWarn.cta, url: trackingUrl },
                    note: tWarn.note,
                  }),
                },
                `abandon-warn-${projectToken}-${nowIso.slice(0, 10)}`
              );
              proj.abandonWarningSentAt = nowIso;
              changed = true;
            } catch (e) {
              console.error("abandon warning email failed:", e?.message);
            }
          } else {
            const warnMs = new Date(proj.abandonWarningSentAt).getTime();
            if (!Number.isNaN(warnMs)) {
              const daysSinceWarn = (nowMs - warnMs) / DAY_MS;
              if (daysSinceWarn >= ABANDON_GRACE_DAYS) {
                proj.status = "abandoned";
                proj.abandonedAt = nowIso;
                const tAb = EM[lang].abandoned;
                try {
                  await resendSend(
                    env,
                    {
                      to: [proj.clientEmail],
                      reply_to: "hola@rebrandyourbrand.es",
                      subject: tAb.subject(proj.brand),
                      ...renderEmail(lang, {
                        paras: [tAb.hello, tAb.intro(proj.brand), tAb.body],
                        cta: { label: tAb.cta, url: trackingUrl },
                        note: tAb.note,
                      }),
                    },
                    `abandon-client-${projectToken}-${nowIso.slice(0, 10)}`
                  );

                  await resendSend(
                    env,
                    {
                      to: ["hola@rebrandyourbrand.es"],
                      reply_to: proj.clientEmail,
                      subject: `expediente cerrado por abandono (cláusula 3.2) — ${proj.brand}`,
                      ...renderEmail("es", {
                        paras: [
                          `el expediente de ${bold(proj.brand)} ha sido cerrado definitivamente por abandono tras superar 37 días naturales sin actividad.`,
                          lines(
                            `— cliente: ${bold(proj.clientEmail)}`,
                            `— proyecto: ${bold(proj.brand)}`,
                            `— fecha de aviso inicial (30d): ${bold(fmtDate(proj.abandonWarningSentAt, "es"))}`,
                            `— fecha de rescisión (37d): ${bold(fmtDate(nowIso, "es"))}`
                          ),
                          "conforme a la cláusula 3.2, el importe abonado se conserva en compensación por los costes y la reserva de agenda.",
                        ],
                        cta: { label: "ver ficha del proyecto", url: trackingUrl },
                      }),
                    },
                    `abandon-admin-${projectToken}-${nowIso.slice(0, 10)}`
                  );
                  changed = true;
                } catch (e) {
                  console.error("abandon termination email failed:", e?.message);
                }
              }
            }
          }
        }
      }
    } else if (proj.abandonWarningSentAt) {
      delete proj.abandonWarningSentAt;
      changed = true;
    }
  }

  // 3. Cláusula 3.1 — Preaviso de 30 días para renovación anual de infraestructura web
  if (
    Array.isArray(proj.services) &&
    proj.services.includes("web") &&
    proj.nextRenewalAt &&
    !proj.renewalCanceled &&
    proj.renewalRemindedFor !== proj.nextRenewalAt
  ) {
    const dueMs = new Date(proj.nextRenewalAt).getTime();
    if (!Number.isNaN(dueMs)) {
      const daysUntil = (dueMs - nowMs) / DAY_MS;
      if (daysUntil <= RENEWAL_NOTICE_DAYS && daysUntil >= -7) {
        const cancelUrl = await cancelRenewalUrl(env, projectToken, proj.nextRenewalAt);
        const rawRenewal =
          env.WEB_RENEWAL_EUR !== undefined && String(env.WEB_RENEWAL_EUR).trim() !== ""
            ? Number(env.WEB_RENEWAL_EUR)
            : WEB_RENEWAL_EUR;
        const renewalEur = Number.isFinite(rawRenewal) && rawRenewal >= 0 ? rawRenewal : WEB_RENEWAL_EUR;

        const canPay = Boolean(
          renewalEur > 0 &&
          env.STRIPE_SECRET_KEY &&
          (env.CHAT_SIGNING_SECRET || env.APP_SECRET_TOKEN)
        );
        const payUrl = canPay ? await renewalActionUrl(env, projectToken) : "";

        if (payUrl) {
          const tr = EM[lang].renewal;
          const dueStr = fmtDate(proj.nextRenewalAt, lang);
          try {
            await resendSend(
              env,
              {
                to: [proj.clientEmail],
                reply_to: "hola@rebrandyourbrand.es",
                subject: tr.subject(proj.brand),
                ...renderEmail(lang, {
                  paras: [tr.hello, tr.intro(bold(proj.brand), bold(dueStr)), tr.body(bold(eur(renewalEur, lang)))],
                  cta: { label: tr.ctaPay, url: payUrl },
                  secondaryLink: { label: tr.cancelLine, url: cancelUrl },
                  note: tr.note,
                }),
              },
              `renewal-client-${projectToken}-${proj.nextRenewalAt.slice(0, 10)}`
            );
            await alertAdmin(
              env,
              `preaviso automático de renovación enviado — ${proj.brand}`,
              `cliente: ${proj.clientEmail}\nvencimiento: ${fmtDate(proj.nextRenewalAt, "es")}\nimporte: ${renewalEur} €`
            );
            proj.renewalPaid = false;
            proj.renewalRemindedFor = proj.nextRenewalAt;
            proj.renewalReminderSentAt = nowIso;
            changed = true;
          } catch (e) {
            console.error("renewal client email failed:", e?.message);
          }
        } else {
          try {
            await resendSend(
              env,
              {
                to: ["hola@rebrandyourbrand.es"],
                reply_to: proj.clientEmail,
                subject: `preaviso de 30 días — renovación web de ${proj.brand}`,
                ...renderEmail("es", {
                  paras: [
                    `faltan menos de 30 días para el vencimiento anual de la infraestructura web de ${bold(proj.brand)}.`,
                    lines(
                      `— cliente: ${bold(proj.clientEmail)}`,
                      `— idioma del cliente: ${bold(lang)}`,
                      `— fecha de vencimiento: ${bold(fmtDate(proj.nextRenewalAt, "es"))}`
                    ),
                    "envía al cliente el importe actualizado del proveedor según la cláusula 3.1 (o configura la variable web_renewal_eur en el worker para automatizar el cobro en stripe). abajo tienes listo el enlace firmado de baja en un clic para incluirlo en el aviso:",
                  ],
                  cta: { label: "enlace firmado de baja en un clic", url: cancelUrl },
                }),
              },
              `renewal-admin-${projectToken}-${proj.nextRenewalAt.slice(0, 10)}`
            );
            proj.renewalPaid = false;
            proj.renewalRemindedFor = proj.nextRenewalAt;
            proj.renewalReminderSentAt = nowIso;
            changed = true;
          } catch (e) {
            console.error("renewal admin reminder failed:", e?.message);
          }
        }
      }
    }
  }

  // 4. Alerta interna de renovación anual vencida sin pago ni cancelación
  const renewalDueDate = proj.renewalDueAt || proj.nextRenewalAt;
  if (
    Array.isArray(proj.services) &&
    proj.services.includes("web") &&
    renewalDueDate &&
    !proj.renewalCanceled &&
    !proj.renewalPaid &&
    !proj.renewalOverdueAlertSentAt
  ) {
    const dueMs = new Date(renewalDueDate).getTime();
    if (!Number.isNaN(dueMs) && nowMs > dueMs) {
      const trackingUrl = buildUrl("/proyecto", { token: projectToken });
      try {
        await resendSend(
          env,
          {
            to: ["hola@rebrandyourbrand.es"],
            reply_to: proj.clientEmail,
            subject: `alerta de vencimiento de renovación web — ${proj.brand}`,
            ...renderEmail("es", {
              paras: [
                `la infraestructura técnica web de ${bold(proj.brand)} ha superado su fecha de vencimiento sin haberse renovado ni cancelado.`,
                lines(
                  `— cliente: ${bold(proj.clientEmail)}`,
                  `— proyecto: ${bold(proj.brand)}`,
                  `— fecha de vencimiento: ${bold(fmtDate(renewalDueDate, "es"))}`,
                  `— estado actual: pendiente de revisión manual`
                ),
                "revisa el estado del dominio y servidor para gestionar la renovación o baja según corresponda.",
              ],
              cta: { label: "ver ficha del proyecto", url: trackingUrl },
            }),
          },
          `renewal-overdue-${projectToken}-${String(renewalDueDate).slice(0, 10)}`
        );
        proj.renewalOverdueAlertSentAt = nowIso;
        changed = true;
      } catch (e) {
        console.error("renewal overdue alert failed:", e?.message);
      }
    }
  }

  if (changed) {
    await saveProject(env, projectToken, proj);
  }
}

async function handleScheduled(controller, env, ctx) {
  if (!env.LEADS_KV || !env.RESEND_API_KEY || !env.CHAT_SIGNING_SECRET) {
    console.error("scheduled cron skipped: missing bindings");
    return;
  }

  const nowMs = controller?.scheduledTime ? Number(controller.scheduledTime) : Date.now();
  const maxGets = 35;
  let getsCount = 0;
  const savedCursor = await env.LEADS_KV.get("cron:project_cursor").catch(() => null);
  let cursor = savedCursor || undefined;
  const INACTIVE_CRON_STATUSES = new Set(["abandoned", "cancelled"]);
  let completedFullList = false;

  do {
    const list = await env.LEADS_KV.list({ prefix: "project:", cursor });
    let reachedLimit = false;

    for (const item of list.keys) {
      if (getsCount >= maxGets) {
        reachedLimit = true;
        break;
      }

      const meta = item.metadata || {};
      const status = meta.status;

      if (status && INACTIVE_CRON_STATUSES.has(status)) {
        continue;
      }

      if (status === "completed" || status === "done") {
        if (meta.hasWeb === false) {
          continue;
        }
        if (meta.hasWeb === true) {
          const nextDue = Number(meta.renewalNextDue) || 0;
          if (nextDue > 0 && nowMs < nextDue - 31 * DAY_MS) {
            continue;
          }
        }
        // Si meta.hasWeb === undefined, se procesa para que saveProject rellene los metadatos
      }

      getsCount++;
      await inspectProjectDeadlines(env, item.name, nowMs).catch((e) =>
        console.error("cron project check failed:", item.name, e?.message)
      );
    }

    if (reachedLimit) {
      const nextCursor = list.cursor || cursor;
      if (nextCursor) {
        await env.LEADS_KV.put("cron:project_cursor", nextCursor, { expirationTtl: 86400 }).catch(() => {});
      }
      return;
    }

    if (list.list_complete) {
      completedFullList = true;
      cursor = undefined;
    } else {
      cursor = list.cursor;
      if (getsCount >= maxGets) {
        if (cursor) {
          await env.LEADS_KV.put("cron:project_cursor", cursor, { expirationTtl: 86400 }).catch(() => {});
        }
        return;
      }
    }
  } while (cursor && getsCount < maxGets);

  if (completedFullList) {
    await env.LEADS_KV.delete("cron:project_cursor").catch(() => {});
  } else if (cursor) {
    await env.LEADS_KV.put("cron:project_cursor", cursor, { expirationTtl: 86400 }).catch(() => {});
  }
}

// ══ index.js — Punto de entrada del Worker: enrutado de peticiones HTTP y eventos programados. ══

const HTML_CLIENT_PATHS = new Set(["/verify", "/valorar", "/approve-phase", "/cancel-renewal", "/renovar"]);

const HTML_ADMIN_PATHS = new Set(["/testimonial", "/testimonial-delete", "/advance-phase", "/responder-chat"]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/webhook/stripe") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "method_not_allowed" }, 405, null, { Allow: "POST" });
      }
      try {
        return await handleStripeWebhook(request, env, ctx);
      } catch (e) {
        console.error("stripe webhook failed:", e?.message);
        return jsonResponse({ error: "webhook_failed" }, 500, null);
      }
    }

    if (HTML_CLIENT_PATHS.has(url.pathname) || HTML_ADMIN_PATHS.has(url.pathname)) {
      try {
        if (url.pathname === "/verify") return await handleVerify(request, env, ctx, url);
        if (url.pathname === "/testimonial") return await handleTestimonialReview(request, env, ctx, url);
        if (url.pathname === "/testimonial-delete") return await handleTestimonialDelete(request, env, ctx, url);
        if (url.pathname === "/advance-phase") return await handlePhaseAdvance(request, env, ctx, url);
        if (url.pathname === "/responder-chat") return await handleStudioChat(request, env, ctx, url);
        if (url.pathname === "/approve-phase") return await handlePhaseApprove(request, env, ctx, url);
        if (url.pathname === "/cancel-renewal") return await handleCancelRenewal(request, env, ctx, url);
        if (url.pathname === "/renovar") return await handleRenewalRedirect(request, env, ctx, url);
        if (url.pathname === "/valorar") return await handleReview(request, env, ctx, url);
      } catch (e) {
        console.error("html route failed:", e?.message);
        return errorPage(HTML_CLIENT_PATHS.has(url.pathname) ? langFromRequest(request) : "es");
      }
    }

    if (url.pathname === "/file") {
      try {
        return await handleFileDownload(request, env, url);
      } catch (e) {
        console.error("file route failed:", e?.message);
        return new Response("error al procesar el archivo", { status: 500 });
      }
    }

    if (url.pathname === "/proyecto") {
      try {
        return await handleProject(request, env, ctx, url);
      } catch (e) {
        console.error("project page failed:", e?.message);
        return errorPage(langFromRequest(request));
      }
    }

    const origin = request.headers.get("Origin");
    const originOk = ALLOWED_ORIGINS.includes(origin);
    const o = originOk ? origin : request.method === "GET" ? "*" : null;

    if (request.method === "OPTIONS") {
      return originOk
        ? new Response(null, { status: 204, headers: corsHeaders(origin) })
        : new Response(null, { status: 403 });
    }

    if (url.pathname === "/webhook/email") return handleEmailForm(request, env, originOk, o);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/testimonials")) {
      try {
        const approved = env?.LEADS_KV
          ? (await env.LEADS_KV.get(APPROVED_KEY, { type: "json", cacheTtl: 60 })) || []
          : [];
        const publicList = approved.map(({ name, business, rating, comment }) => ({
          name,
          business,
          rating,
          comment,
        }));
        return jsonResponse(publicList, 200, originOk ? origin : "*", {
          "Cache-Control": "public, max-age=60",
        });
      } catch (e) {
        console.error("testimonials failed:", e?.message);
        return jsonResponse([], 200, originOk ? origin : "*", { "Cache-Control": "no-store" });
      }
    }

    if (!originOk) return jsonResponse({ error: "forbidden_origin" }, 403, null);
    if (request.method !== "POST") {
      return jsonResponse({ error: "method_not_allowed" }, 405, o, { Allow: "GET, POST, OPTIONS" });
    }

    const declared = Number(request.headers.get("Content-Length") || 0);
    if (declared > MAX_BODY_BYTES) return jsonResponse({ error: "payload_too_large" }, 413, o);
    const raw = await request.text();
    if (enc.encode(raw).byteLength > MAX_BODY_BYTES) return jsonResponse({ error: "payload_too_large" }, 413, o);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400, o);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse({ error: "invalid_json" }, 400, o);
    }

    return handleChatPost(request, env, body, o, ctx);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(handleScheduled(controller, env, ctx));
  },
};
