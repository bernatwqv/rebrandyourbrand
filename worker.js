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

const TACIT_REMINDER_DAYS = 15;

const TACIT_APPROVAL_DAYS = 20;

const RENEWAL_NOTICE_DAYS = 30;

const MAX_PHASE_REVISIONS = 2;

// Importe anual obligatorio de infraestructura técnica web (dominio, correo corporativo, DNS/SSL y despliegue edge) si env.WEB_RENEWAL_EUR no está definida en Cloudflare
const WEB_RENEWAL_EUR = 100;

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
    price: 200,
    names: {
      es: "logotipo",
      ca: "logotip",
      eu: "logotipoa",
      en: "logo",
    },
    includes: {
      es: "logotipo principal y versión secundaria, listos para redes, cartelería y facturas",
      ca: "logotip principal i versió secundària, llestos per a xarxes, cartelleria i factures",
      eu: "logotipo nagusia eta bigarren mailako bertsioa, sareetarako, karteletarako eta fakturetarako prest",
      en: "primary and secondary logo, ready for social media, signage and invoices",
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
      es: "colores y tipografías elegidos para tu marca",
      ca: "colors i tipografies triats per a la teva marca",
      eu: "zure markarako aukeratutako koloreak eta tipografiak",
      en: "colors and typefaces chosen for your brand",
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

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

const EMAIL_FIND = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

const AGREE_RE = /(?<![\p{L}\p{N}])(?:confirmo|confirm|vale|adelante|procedemos|s[ií]|perfecto|de acuerdo|acuerdo|ok|okay|yes|sure|go ahead|d'acord|endavant|bai|ados|aurrera|ederto|primeran)(?![\p{L}\p{N}])/iu;

const DENY_RE = /^\s*(?:no|nope|ez|ezeztatu|cancel\w*)(?![\p{L}\p{N}])/iu;

// Precios que Brandi puede mencionar: 50 (hora extra), renovación anual web y cualquier combinación de servicios
const ALLOWED_EUR = new Set([50, WEB_RENEWAL_EUR]);

for (let m = 1; m < (1 << SERVICE_IDS.length); m++) {
  ALLOWED_EUR.add(SERVICE_IDS.reduce((sum, id, i) => sum + (m & (1 << i) ? SERVICES[id].price : 0), 0));
}

const CATALOG = SERVICE_IDS
  .map((id) => `   - ${SERVICES[id].names.es}: ${SERVICES[id].price} € — ${SERVICES[id].includes.es}.`)
  .join("\n");

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

const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://checkout.stripe.com; base-uri 'none'; frame-ancestors 'none'";

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
    fallback: "Perdona, ha ocurrido un pequeño desajuste técnico. ¿Podrías repetirlo?",
    sent: "¡Listo! Te acabamos de enviar un correo de verificación. Ábrelo y pulsa el botón para confirmar tu briefing y abrir la página de tu proyecto con el pago seguro. Si no lo ves, mira en spam o reenvíalo con los botones de abajo.",
  },
  ca: {
    fallback: "Perdona, hi ha hagut un petit desajust tècnic. Ho pots repetir?",
    sent: "Llest! Acabem d'enviar-te un correu de verificació. Obre'l i prem el botó per confirmar el teu briefing i obrir la pàgina del teu projecte amb el pagament segur. Si no el veus, mira el correu brossa o reenvia'l amb els botons de sota.",
  },
  eu: {
    fallback: "Barkatu, akats tekniko txiki bat gertatu da. Errepika dezakezu?",
    sent: "Prest! Egiaztatze-mezu bat bidali berri dizugu. Ireki eta sakatu botoia zure briefing-a berresteko eta ordainketa segurua duen zure proiektuaren orria irekitzeko. Ikusten ez baduzu, begiratu spama edo bidali berriro beheko botoiekin.",
  },
  en: {
    fallback: "Apologies, a minor technical glitch occurred. Could you rephrase?",
    sent: "All set! We just sent you a verification email. Open it and click the button to confirm your briefing and open your project page with secure payment. If you cannot see it, check spam or resend it with the buttons below.",
  },
};

const ASK = {
  es: {
    brand: "¿Cómo se llama tu marca o proyecto?",
    services: "¿Qué necesitas: logotipo (200 €), paleta de empresa (100 €), web (400 €) o una combinación?",
    email: "¿A qué correo electrónico te enviamos la verificación?",
  },
  ca: {
    brand: "Com es diu la teva marca o projecte?",
    services: "Què necessites: logotip (200 €), paleta d'empresa (100 €), web (400 €) o una combinació?",
    email: "A quin correu electrònic t'enviem la verificació?",
  },
  eu: {
    brand: "Nola du izena zure marka edo proiektuak?",
    services: "Zer behar duzu: logotipoa (200 €), enpresaren paleta (100 €), webgunea (400 €) edo konbinazio bat?",
    email: "Ze helbide elektronikotara bidaliko dizugu egiaztapena?",
  },
  en: {
    brand: "What is your brand or project called?",
    services: "What do you need: logo (€200), company color palette (€100), website (€400) or a combination?",
    email: "Which email address should we send the verification to?",
  },
};

const SUMMARY = {
  es: {
    title: "Resumen de tu propuesta:",
    brand: "Marca",
    email: "Correo",
    services: "Servicios",
    total: "Inversión total",
    pay: "pago único de creación del 100 %, sin cuotas mensuales",
    legal: "Al confirmar, declaras actuar como empresa o autónomo y aceptas las condiciones de servicio y la política de privacidad.",
    ask: "¿Confirmas que quieres recibir el correo de verificación para continuar con el pago seguro?",
  },
  ca: {
    title: "Resum de la teva proposta:",
    brand: "Marca",
    email: "Correu",
    services: "Serveis",
    total: "Inversió total",
    pay: "pagament únic de creació del 100 %, sense quotes mensuals",
    legal: "En confirmar, declares actuar com a empresa o autònom i acceptes les condicions de servei i la política de privacitat.",
    ask: "Confirmes que vols rebre el correu de verificació per continuar amb el pagament segur?",
  },
  eu: {
    title: "Zure proposamenaren laburpena:",
    brand: "Marka",
    email: "Posta elektronikoa",
    services: "Zerbitzuak",
    total: "Guztizko inbertsioa",
    pay: "sorkuntzaren % 100eko ordainketa bakarra, hileroko kuotarik gabe",
    legal: "Berrestean, enpresa edo autonomo gisa jokatzen duzula adierazten duzu eta zerbitzu-baldintzak zein pribatutasun-politika onartzen dituzu.",
    ask: "Berresten al duzu egiaztatze-mezua jaso nahi duzula ordainketa seguruarekin jarraitzeko?",
  },
  en: {
    title: "Summary of your proposal:",
    brand: "Brand",
    email: "Email",
    services: "Services",
    total: "Total investment",
    pay: "one-time 100% creation payment, no monthly fees",
    legal: "By confirming, you state that you act as a business or sole trader and accept the terms of service and the privacy policy.",
    ask: "Do you confirm you want to receive the verification email to continue to the secure payment?",
  },
};

const eur = (n, lang) => (lang === "en" ? `€${n}` : `${n} €`);

function buildSummary(lang, { brand, email, plan }) {
  const l = pickLang(lang);
  const s = SUMMARY[l] || SUMMARY.es;
  const items = plan.ids.map((id) => `   — ${SERVICES[id].names[l]} (${eur(SERVICES[id].price, l)}): ${SERVICES[id].includes[l]}`);
  return [
    s.title,
    `— ${s.brand}: ${brand}`,
    `— ${s.email}: ${email}`,
    `— ${s.services}:`,
    ...items,
    `— ${s.total}: ${eur(plan.total, l)} (${s.pay})`,
    "",
    s.legal,
    "",
    s.ask,
  ].join("\n");
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
      note: "según las condiciones del servicio, transcurridos 20 días naturales desde el envío sin comentarios se aplicará la aprobación tácita de la fase.",
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
      note: "segons les condicions del servei, passats 20 dies naturals des de l'enviament sense comentaris s'aplicarà l'aprovació tàcita de la fase.",
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
      note: "zerbitzu-baldintzen arabera, bidalketatik 20 egun natural iruzkinik gabe igarotzean fasearen onespen isila aplikatuko da.",
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
      note: "under our terms of service, if 20 calendar days pass from delivery without feedback, tacit approval applies to the phase.",
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
      roundsUsed: (u, m) => `rondas gratuitas usadas en esta fase: ${u} de ${m}`,
      legal: "al aprobar, das por cerrada esta fase según las condiciones de servicio. si necesitas cambios dentro de tus 2 rondas gratuitas de revisión, despliega el botón secundario de abajo.",
      confirmApprove: "confirmo que he revisado la propuesta y quiero aprobar definitivamente esta fase",
      confirmRevise: "confirmo que he revisado las correcciones y quiero enviar esta ronda de ajustes",
      confirmRequired: "es obligatorio marcar la casilla de confirmación antes de enviar.",
      btn: "aprobar fase y continuar",
      revToggle: (r, m) => `pedir ajustes (ronda ${r} de ${m})`,
      revLabel: (r, m) => `describe con claridad los ajustes que necesitas (ronda ${r} de ${m})`,
      revPh: "indica en un solo mensaje todos los cambios puntuales para aplicar en esta ronda...",
      revSubmit: (r, m) => `enviar ajustes de la ronda ${r} de ${m}`,
      revEmpty: "escribe los ajustes que necesitas antes de enviar la ronda.",
      revExhausted: "ya has utilizado las 2 rondas de revisión gratuitas incluidas en esta fase. puedes aprobar la propuesta arriba para continuar o escribirnos a hola@rebrandyourbrand.es para presupuestar ajustes adicionales (50 €/hora, cláusula 1.2).",
      revDone: ["ajustes enviados", "ajustes registrados con éxito", (r, m) => `hemos recibido tus indicaciones de la ronda ${r} de ${m} y te avisaremos por correo en cuanto la versión actualizada esté lista para revisar.`],
      revWorking: ["ajustes en curso", "estamos aplicando tus ajustes", (r, m) => `ya tenemos registrada tu petición de la ronda ${r} de ${m} y estamos preparando la nueva versión. te avisaremos por correo en cuanto esté lista.`],
      done: ["fase aprobada", "fase aprobada con éxito", "hemos registrado tu validación por escrito y ya hemos activado la siguiente etapa de tu proyecto."],
      already: ["fase ya gestionada", "esta fase ya está cerrada", "esta fase ya consta como aprobada y completada en tu proyecto."],
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
      obMaterials: "enlace a carpeta con logo previo, fotos y textos (drive, wetransfer, dropbox...) o notas",
      obMaterialsPh: "https://drive.google.com/... o indicaciones breves",
      confirmOnboarding: "confirmo que he revisado los datos y enlaces y quiero enviarlos definitivamente al estudio",
      confirmRequired: "es obligatorio marcar la casilla de confirmación antes de enviar los materiales.",
      confirmRequiredTitle: "confirmación obligatoria",
      confirmRequiredHeading: "marca la casilla de confirmación",
      obSubmit: "enviar materiales al estudio",
      obSentBanner: "materiales recibidos correctamente. nuestro equipo ya tiene todo registrado.",
      obSentTitle: "materiales iniciales enviados",
      obLblSocials: "web o redes",
      obLblDomain: "dominio",
      obLblMaterials: "carpeta o notas",
      obMissing: ["faltan datos", "indica al menos un dato", "rellena al menos uno de los campos antes de enviar el formulario."],
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
      roundsUsed: (u, m) => `rondes gratuïtes usades en aquesta fase: ${u} de ${m}`,
      legal: "en aprovar, dónes per tancada aquesta fase segons les condicions de servei. si necessites canvis dins de les teves 2 rondes gratuïtes de revisió, desplega el botó secundari de sota.",
      confirmApprove: "confirmo que he revisat la proposta i vull aprovar definitivament aquesta fase",
      confirmRevise: "confirmo que he revisat les correccions i vull enviar aquesta ronda d'ajustos",
      confirmRequired: "és obligatori marcar la casella de confirmació abans d'enviar.",
      btn: "aprovar fase i continuar",
      revToggle: (r, m) => `demanar ajustos (ronda ${r} de ${m})`,
      revLabel: (r, m) => `descriu amb claredat els ajustos que necessites (ronda ${r} de ${m})`,
      revPh: "indica en un sol missatge tots els canvis puntuals per aplicar en aquesta ronda...",
      revSubmit: (r, m) => `enviar ajustos de la ronda ${r} de ${m}`,
      revEmpty: "escriu els ajustos que necessites abans d'enviar la ronda.",
      revExhausted: "ja has utilitzat les 2 rondes de revisió gratuïtes incloses en aquesta fase. pots aprovar la proposta a dalt per continuar o escriure'ns a hola@rebrandyourbrand.es per pressupostar ajustos addicionals (50 €/hora, clàusula 1.2).",
      revDone: ["ajustos enviats", "ajustos registrats amb èxit", (r, m) => `hem rebut les teves indicacions de la ronda ${r} de ${m} i t'avisarem per correu tan bon punt la versió actualitzada estigui a punt per revisar.`],
      revWorking: ["ajustos en curs", "estem aplicant els teus ajustos", (r, m) => `ja tenim registrada la teva petició de la ronda ${r} de ${m} i estem preparant la nova versió. t'avisarem per correu tan bon punt estigui a punt.`],
      done: ["fase aprovada", "fase aprovada amb èxit", "hem registrat la teva validació per escrit i ja hem activat l'etapa següent del teu projecte."],
      already: ["fase ja gestionada", "aquesta fase ja està tancada", "aquesta fase ja consta com a aprovada i completada al teu projecte."],
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
      obMaterials: "enllaç a carpeta amb logotip previ, fotos i textos (drive, wetransfer, dropbox...) o notes",
      obMaterialsPh: "https://drive.google.com/... o indicacions breus",
      confirmOnboarding: "confirmo que he revisat les dades i enllaços i vull enviar-los definitivament a l'estudi",
      confirmRequired: "és obligatori marcar la casella de confirmació abans d'enviar els materials.",
      confirmRequiredTitle: "confirmació obligatòria",
      confirmRequiredHeading: "marca la casella de confirmació",
      obSubmit: "enviar materials a l'estudi",
      obSentBanner: "materials rebuts correctament. el nostre equip ja ho té tot registrat.",
      obSentTitle: "materials inicials enviats",
      obLblSocials: "web o xarxes",
      obLblDomain: "domini",
      obLblMaterials: "carpeta o notes",
      obMissing: ["falten dades", "indica almenys una dada", "omple almenys un dels camps abans d'enviar el formulari."],
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
      roundsUsed: (u, m) => `fase honetan erabilitako doako txandak: ${m}tik ${u}`,
      legal: "onartzean, fase hau itxitzat ematen duzu zerbitzu-baldintzen arabera. barne dituzun doako 2 berrikuspen-txanden barruan aldaketak behar badituzu, ireki beheko bigarren botoia.",
      confirmApprove: "proposamena berrikusi dudala eta fase hau behin betiko onartu nahi dudala berresten dut",
      confirmRevise: "zuzenketak berrikusi ditudala eta doikuntza-txanda hau bidali nahi dudala berresten dut",
      confirmRequired: "nahitaezkoa da berrespen-laukia markatzea bidali aurretik.",
      btn: "onartu fasea eta jarraitu",
      revToggle: (r, m) => `eskatu doikuntzak (${m}tik ${r}. txanda)`,
      revLabel: (r, m) => `azaldu argi behar dituzun doikuntzak (${m}tik ${r}. txanda)`,
      revPh: "adierazi mezu bakarrean txanda honetan aplikatu beharreko aldaketa zehatz guztiak...",
      revSubmit: (r, m) => `bidali ${m}tik ${r}. txandako doikuntzak`,
      revEmpty: "idatzi behar dituzun doikuntzak txanda bidali aurretik.",
      revExhausted: "dagoeneko erabili dituzu fase honetan barne hartutako doako 2 berrikuspen-txandak. goian proposamena onar dezakezu jarraitzeko edo hola@rebrandyourbrand.es helbidera idatzi doikuntza gehigarriak aurrekontatzeko (50 €/orduko, 1.2 klausula).",
      revDone: ["doikuntzak bidalita", "doikuntzak behar bezala erregistratu dira", (r, m) => `jaso ditugu zure ${m}tik ${r}. txandako argibideak eta posta elektronikoz abisatuko dizugu bertsio eguneratua berrikusteko prest dagoenean.`],
      revWorking: ["doikuntzak martxan", "zure doikuntzak aplikatzen ari gara", (r, m) => `dagoeneko erregistratuta daukagu zure ${m}tik ${r}. txandako eskaera eta bertsio berria prestatzen ari gara. prest dagoenean posta elektronikoz abisatuko dizugu.`],
      done: ["fasea onartuta", "fasea behar bezala onartu da", "zure idatzizko onarpena erregistratu dugu eta zure proiektuaren hurrengo etapa aktibatu dugu."],
      already: ["fasea kudeatuta", "fase hau itxita dago jada", "fase hau dagoeneko onartuta eta osatuta agertzen da zure proiektuan."],
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
      obMaterials: "aurreko logotipoa, argazkiak eta testuak dituen karpetarako esteka (drive, wetransfer, dropbox...) edo oharrak",
      obMaterialsPh: "https://drive.google.com/... edo ohar laburrak",
      confirmOnboarding: "datuak eta estekak berrikusi ditudala eta estudiora behin betiko bidali nahi ditudala berresten dut",
      confirmRequired: "nahitaezkoa da berrespen-laukia markatzea materialak bidali aurretik.",
      confirmRequiredTitle: "derrigorrezko berrespena",
      confirmRequiredHeading: "markatu berrespen-laukia",
      obSubmit: "bidali materialak estudiora",
      obSentBanner: "materialak behar bezala jaso dira. gure taldeak dena erregistratuta dauka jada.",
      obSentTitle: "bidalitako hasierako materialak",
      obLblSocials: "webgunea edo sareak",
      obLblDomain: "domeinua",
      obLblMaterials: "karpeta edo oharrak",
      obMissing: ["datuak falta dira", "adierazi gutxienez datu bat", "bete gutxienez eremuetako bat inprimakia bidali aurretik."],
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
      roundsUsed: (u, m) => `free revision rounds used in this phase: ${u} of ${m}`,
      legal: "by approving, this phase is closed under our terms of service. if you need changes within your 2 free revision rounds, expand the secondary button below.",
      confirmApprove: "i confirm that i have reviewed the proposal and want to approve this phase definitively",
      confirmRevise: "i confirm that i have reviewed the feedback and want to submit this round of adjustments",
      confirmRequired: "you must tick the confirmation checkbox before sending.",
      btn: "approve phase and continue",
      revToggle: (r, m) => `request adjustments (round ${r} of ${m})`,
      revLabel: (r, m) => `describe clearly the adjustments you need (round ${r} of ${m})`,
      revPh: "list in a single message all the specific changes to apply in this round...",
      revSubmit: (r, m) => `send adjustments for round ${r} of ${m}`,
      revEmpty: "please write the adjustments you need before submitting this round.",
      revExhausted: "you have already used both free revision rounds included in this phase. you can approve the proposal above to continue or email hola@rebrandyourbrand.es to quote additional adjustments (€50/hour, clause 1.2).",
      revDone: ["adjustments sent", "adjustments recorded successfully", (r, m) => `we have received your round ${r} of ${m} notes and will email you as soon as the updated version is ready for review.`],
      revWorking: ["adjustments in progress", "we are applying your adjustments", (r, m) => `we already have your round ${r} of ${m} request on file and are preparing the updated version. we will email you as soon as it is ready.`],
      done: ["phase approved", "phase approved successfully", "we have recorded your written approval and activated the next stage of your project."],
      already: ["already approved", "this phase is already closed", "this phase is already marked as approved and completed on your project."],
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
      obMaterials: "link to folder with previous logo, photos and copy (drive, wetransfer, dropbox...) or notes",
      obMaterialsPh: "https://drive.google.com/... or brief notes",
      confirmOnboarding: "i confirm that i have reviewed the details and links and want to send them definitively to the studio",
      confirmRequired: "you must tick the confirmation checkbox before sending materials.",
      confirmRequiredTitle: "confirmation required",
      confirmRequiredHeading: "please tick the confirmation checkbox",
      obSubmit: "send materials to studio",
      obSentBanner: "materials received. our team has everything logged.",
      obSentTitle: "submitted kickoff materials",
      obLblSocials: "web or social",
      obLblDomain: "domain",
      obLblMaterials: "folder or notes",
      obMissing: ["missing details", "please fill in at least one field", "enter at least one detail before sending the form."],
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

const confirmPayload = (email, brand, plan) => `confirm|${email}|${brand}|${plan.ids.join(",")}`;

// Tokens deterministas firmados por HMAC (sin depender de claves temporales en KV)
const getActionToken = (key, projectToken, step) => signRaw(key, `action|${projectToken}|${step}`);

const approvePhaseToken = (key, projectToken, step) => signRaw(key, `approve|${projectToken}|${step}`);

const cancelRenewalToken = (key, projectToken, dueIso) => signRaw(key, `crenew|${projectToken}|${dueIso}`);

const fileDownloadToken = (key, projectToken, step, fileId) => signRaw(key, `file|${projectToken}|${step}|${fileId}`);

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

async function fileDownloadUrl(env, projectToken, step, fileId) {
  const key = await getKey(env);
  const t = await fileDownloadToken(key, projectToken, step, fileId);
  return buildUrl("/file", { p: projectToken, step, id: fileId, t });
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
    ? `<blockquote style="margin:0 0 24px;padding:14px 16px;background-color:#FFFFFF;border-left:2px solid #8CA3C4;border-radius:0 8px 8px 0;color:#17171A;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;">${esc(quote)}</blockquote>`
    : "";
  const button = cta
    ? `<div style="text-align:center;margin:32px 0 20px;"><a href="${esc(cta.url)}" target="_blank" style="background-color:#8CA3C4;color:#0A0A0C;padding:14px 28px;text-decoration:none;font-weight:600;font-size:13px;border-radius:10px;display:inline-block;text-transform:lowercase;">${esc(cta.label)}</a></div>`
    : "";
  const secondary = secondaryLink
    ? `<p style="text-align:center;margin:0 0 24px;font-size:12px;"><a href="${esc(secondaryLink.url)}" target="_blank" style="color:#3D5A85;text-decoration:underline;text-transform:lowercase;">${esc(secondaryLink.label)}</a></p>`
    : "";
  const footer = `<p style="color:#58575E;font-size:12px;line-height:1.55;margin:32px 0 0;border-top:1px solid #E4DED0;padding-top:20px;">${note ? `${note}<br><br>` : ""}${EMAIL_SIGN[l]}</p>`;

  const html = `<!DOCTYPE html>
<html lang="${l}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"></head>
<body style="background-color:#FFFFFF;color:#17171A;font-family:'Inter',Arial,sans-serif;padding:40px 20px;margin:0;">
  <div style="max-width:560px;margin:0 auto;background-color:#EDE6D6;border:1px solid #E4DED0;padding:40px;border-radius:16px;">
    <h2 style="font-family:'Fraunces',Georgia,serif;font-size:22px;letter-spacing:-0.03em;margin:0 0 24px;color:#17171A;font-weight:400;text-transform:lowercase;">rebrandyourbrand</h2>
    ${body}${quoteHtml}${button}${secondary}${footer}
  </div>
</body></html>`;

  const text = [
    ...paras.map(htmlToText),
    quote,
    cta ? `${cta.label}:\n${cta.url}` : "",
    secondaryLink ? `${secondaryLink.label}:\n${secondaryLink.url}` : "",
    [note && htmlToText(note), EMAIL_SIGN[l]].filter(Boolean).join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n\n");

  return { html, text };
}

// Resend con soporte de Idempotency-Key
async function resendSend(env, payload, idempotencyKey) {
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${env.RESEND_API_KEY}` };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify({ from: "rebrandyourbrand <hola@rebrandyourbrand.es>", ...payload }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Resend error: ${res.status}`);
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

async function startVerification(env, { lang, messages, plan, clientEmail, brand }) {
  const cooldownKey = `cooldown:${clientEmail}`;
  if (await env.LEADS_KV.get(cooldownKey)) {
    throw new HttpError(429, "email_cooldown", { "Retry-After": String(EMAIL_COOLDOWN_SECONDS) });
  }
  if (!plan) throw new HttpError(400, "plan_required");

  const l = pickLang(lang);
  const verifyToken = randomHex(32);
  const pendingKey = `pending:${verifyToken}`;
  const pendingPayload = {
    lang: l,
    messages,
    services: plan.ids,
    clientEmail,
    brand,
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

  await resendSend(
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
  );

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
  if (ctx?.waitUntil) ctx.waitUntil(ack);
}

// ══ ai.js — Brandi (Groq): prompt, llamada al modelo, validación de respuestas y servicios elegidos. ══

// "plan" en este archivo = { ids: [...], total } con los servicios elegidos

function normalizeServices(input) {
  if (!Array.isArray(input)) return null;
  const ids = SERVICE_IDS.filter((id) => input.includes(id));
  if (!ids.length) return null;
  return { ids, total: ids.reduce((sum, id) => sum + SERVICES[id].price, 0) };
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

const missingOf = (brand, email, plan) =>
  [!brand && "brand", !plan && "services", !email && "email"].filter(Boolean);

function buildSystemInstruction(lang, ctx) {
  const { plan, brand, email, denied } = ctx;
  const langName = LANG_NAMES[pickLang(lang)] || LANG_NAMES.es;

  const servicesBlock = plan
    ? `SERVICIOS ELEGIDOS: ${svcLabel(plan.ids, "es")} (${plan.total} € en total).`
    : `SERVICIOS: sin elegir todavía. El cliente no ha usado el selector de la web, así que quizá no conoce todas las opciones.`;
  const missing = missingOf(brand, email, plan);
  const deniedBlock = denied
    ? `\nEl cliente acaba de RECHAZAR el resumen. Pregúntale con amabilidad qué quiere cambiar (marca, servicios o correo). No repitas el resumen.`
    : "";

  return `Eres Brandi, Directora de Arte e Inteligencia Creativa en rebrandyourbrand. Idioma obligatorio de respuesta: ${langName}.

Tu objetivo es entender la marca del cliente, dar una breve pincelada estratégica y reunir tres datos para cerrar la propuesta: MARCA, SERVICIOS y CORREO.

ESTILO:
- No actúes como un bot de atención al cliente. Eres una consultora de marca directa, aguda y conceptual.
- Máximo 3 frases por mensaje. Haz UNA sola pregunta por mensaje.
- No uses puntos medios ni el símbolo ampersand en tus textos; usa conjunciones o guiones largos.

No hay planes cerrados: el cliente elige solo los servicios que necesita y paga únicamente por ellos (pago único del 100% mediante enlace seguro tras verificar el correo, sin cuotas mensuales). Servicios y precios oficiales:
${CATALOG}
El precio total de creación es la suma de los servicios elegidos. No hay descuentos ni paquetes.
Si el cliente elige o pregunta por la web (400 € de pago único de desarrollo), aclara si surge la duda que conlleva una cuota obligatoria de 100 €/año exclusivamente por infraestructura técnica gestionada (dominio, correo corporativo, DNS, certificados SSL y despliegue edge): no incluye cambios de contenido, diseño ni nuevas secciones tras la entrega (solo las 2 rondas de revisión gratuitas durante la creación; cualquier cambio posterior se presupuesta aparte o a 50 €/hora).

ESTADO ACTUAL DE LA CONVERSACIÓN:
- MARCA: ${brand ? `ya conocida (${brand})` : "pendiente"}
- ${servicesBlock}
- CORREO: ${email ? "ya recibido" : "pendiente"}
- Datos que aún faltan (por prioridad): ${missing.length ? missing.join(", ") : "ninguno"}.${deniedBlock}

CÓMO CONDUCIR LA CONVERSACIÓN:
1. Primero incorpora lo que el cliente acaba de decir en su último mensaje (marca, servicios, correo).
2. Después pregunta por el PRIMER dato que siga faltando, siguiendo el orden: marca -> servicios -> correo.
3. Si faltan los SERVICIOS: pregunta qué necesita resolver primero y orienta según su caso (por ejemplo, un logotipo que no se ve bien en pequeño, colores incoherentes, o ninguna web). Menciona los tres servicios y que puede combinarlos. No presiones ni des por hecho ninguno.
4. Si ya hay servicios elegidos, no vuelvas a preguntar por ellos salvo que el cliente quiera cambiarlos. Puedes sugerir en una frase un servicio complementario, una sola vez.
5. Si falta el CORREO: pídelo diciendo que es para enviarle la verificación y el acceso a su proyecto y pago seguro.
6. Cuando ya no falte nada NO escribas tú el resumen ni digas que has enviado ningún correo: el sistema mostrará el resumen automáticamente. Limítate a decir en una frase que ya lo tienes todo.
- Habla únicamente de los servicios de rebrandyourbrand. Nunca inventes precios ni porcentajes distintos de los oficiales.

FORMATO DE SALIDA (JSON estricto, sin texto fuera del JSON):
{
  "reply": "tu respuesta al cliente",
  "brand": "nombre de la marca del cliente, o null si aún no lo sabes",
  "services": ["logo", "paleta", "web"] (solo los elegidos) | null
}
- "services": lista de ids elegidos por el cliente (valores posibles: "logo", "paleta", "web")${plan ? ` (ahora mismo: ${JSON.stringify(plan.ids)}; devuélvelo tal cual salvo que el cliente pida cambiarlo explícitamente)` : "; null mientras no los haya elegido claramente"}.
- "brand": devuelve la marca ya conocida salvo que el cliente la cambie.`;
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
          max_tokens: MAX_OUTPUT_TOKENS,
          temperature: 0.4,
          reasoning_effort: "low",
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(10000),
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
      return out && typeof out === "object" && !Array.isArray(out) ? out : {};
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (attempt === retries) throw new HttpError(503, "upstream_busy", { "Retry-After": "10" });
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
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

async function createProjectRecord(env, { clientEmail, brand, plan, lang, messages }) {
  const safeBrand = brand || "proyecto";
  const projectToken = randomHex(32);
  const projectKey = `project:${projectToken}`;
  const cleanMsgs = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, text: m.text.slice(0, 2000) }));

  const projectData = {
    token: projectToken,
    brand: safeBrand,
    clientEmail,
    lang: pickLang(lang),
    services: plan.ids,
    totalEur: plan.total,
    messages: cleanMsgs,
    paid: false,
    emailsSent: false,
    currentPhase: 1,
    createdAt: new Date().toISOString(),
    phases: newPhases(plan.ids),
  };
  await env.LEADS_KV.put(projectKey, JSON.stringify(projectData), {
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
    customer_creation: "always",
    success_url: successUrl,
    cancel_url: projectUrl,
    "metadata[kind]": "project",
    "metadata[project_token]": proj.token,
    "metadata[services]": proj.services.join(","),
    "metadata[brand]": safeBrand,
  });

  proj.services.forEach((id, i) => {
    if (!SERVICES[id]) return;
    const name = SERVICES[id].names[l] || SERVICES[id].names.es;
    params.set(`line_items[${i}][price_data][currency]`, "eur");
    params.set(
      `line_items[${i}][price_data][product_data][name]`,
      `${name.charAt(0).toUpperCase()}${name.slice(1)} — ${safeBrand}`.slice(0, 250)
    );
    params.set(`line_items[${i}][price_data][unit_amount]`, String(SERVICES[id].price * 100));
    params.set(`line_items[${i}][quantity]`, "1");
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
    await env.LEADS_KV.put(`project:${proj.token}`, JSON.stringify(proj), {
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

async function processPaidSession(env, session, { fromWebhook = false } = {}) {
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
    proj.nextRenewalAt = addOneYearIso(proj.nextRenewalAt || proj.finishedAt);
    proj.renewalCanceled = false;
    proj.renewalRemindedFor = "";
    await env.LEADS_KV.put(key, JSON.stringify(proj));
    await alertAdmin(
      env,
      `renovación anual abonada — ${proj.brand}`,
      `cliente: ${proj.clientEmail}\nmarca: ${proj.brand}\nimporte: ${(Number(session.amount_total || 0) / 100).toFixed(2)} eur\npróximo vencimiento: ${fmtDate(proj.nextRenewalAt, "es")}`
    );
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
    if (dirty) await env.LEADS_KV.put(key, JSON.stringify(proj));
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
    if (dirty) await env.LEADS_KV.put(key, JSON.stringify(proj));
  }
}

// Devuelve 500 en error de webhook (incluida consistencia eventual de KV) para que Stripe reintente
async function handleStripeWebhook(request, env) {
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
    await processPaidSession(env, event.data?.object, { fromWebhook: true });
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

const RYBB_LOGO_SVG = `<svg viewBox="0 0 726 261" width="96" height="34" fill="currentColor" aria-hidden="true" style="display:block;height:28px;width:auto;"><path fill-rule="evenodd" d="${RYBB_LOGO_PATH}"></path></svg>`;

const PAGE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html{background:#FFFFFF;color:#17171A;-webkit-text-size-adjust:100%}
body{
  min-height:100vh;
  background-color:#FFFFFF;
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
  background:linear-gradient(155deg,#EDE6D6,rgba(237,230,214,.86));
  border:1px solid #E4DED0;
  border-radius:18px;
  padding:2.25rem;
  width:100%;
  box-shadow:0 20px 60px rgba(61,50,30,.1);
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
  background:#FFFFFF;
  border:1px solid #E4DED0;
  border-radius:13px;
  padding:1.15rem 1.25rem;
  margin-bottom:1.25rem;
  text-align:left;
}
.box.accent{border-color:#8CA3C4}
.box.review-box{border-color:#E8A33D;background:#FFFDF9}
.kv{display:grid;gap:.55rem;font-size:.86rem;color:#58575E}
.kv-row{display:flex;flex-wrap:wrap;justify-content:space-between;gap:.35rem 1rem;padding-bottom:.5rem;border-bottom:1px solid rgba(228,222,208,.65)}
.kv-row:last-child{padding-bottom:0;border-bottom:none}
.kv-val{color:#17171A;font-weight:600;text-align:right}
blockquote{
  background:#FFFFFF;
  color:#17171A;
  font-size:.9rem;
  font-style:italic;
  line-height:1.6;
  margin:0 0 1.35rem;
  text-align:left;
  border:1px solid #E4DED0;
  border-left:3px solid #8CA3C4;
  border-radius:0 10px 10px 0;
  padding:.9rem 1rem;
  white-space:pre-wrap;
  word-break:break-word;
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
  background:#FFFFFF;
  border:1px solid #E4DED0;
  border-radius:10px;
  padding:.72rem .85rem;
  font:inherit;
  font-size:.88rem;
  color:#17171A;
  margin-bottom:1rem;
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
  background:#FFFFFF;
  cursor:pointer;
}
input[type="file"]::file-selector-button{
  border:1px solid #E4DED0;
  background:#EDE6D6;
  color:#17171A;
  padding:.4rem .8rem;
  border-radius:7px;
  margin-right:.8rem;
  font:600 .78rem/1.2 inherit;
  cursor:pointer;
  transition:background .2s;
}
input[type="file"]::file-selector-button:hover{
  background:#E4DED0;
}
.file-note{
  font-size:.74rem;
  color:#58575E;
  margin-top:-.6rem;
  margin-bottom:1rem;
  display:block;
}
.confirm-box{
  margin-top:.85rem;
  margin-bottom:1.15rem;
  padding:.85rem 1rem;
  background:#FFFDF9;
  border:1px solid #E8A33D;
  border-radius:10px;
  text-align:left;
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
input:focus,select:focus,textarea:focus{outline:none;border-color:#8CA3C4;box-shadow:0 0 0 3px rgba(140,163,196,.2)}
button,.btn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:.45rem;
  width:100%;
  background:#8CA3C4;
  color:#0A0A0C;
  border:1px solid #8CA3C4;
  padding:.85rem 1.25rem;
  font:600 .84rem/1.2 inherit;
  letter-spacing:.02em;
  text-transform:lowercase;
  text-decoration:none;
  border-radius:11px;
  cursor:pointer;
}
button:hover,.btn:hover{background:#5F7A9E;border-color:#5F7A9E;color:#FFFFFF}
button.secondary,.btn.secondary,button.no{
  background:#FFFFFF;
  color:#17171A;
  border:1px solid #E4DED0;
  margin-top:.6rem;
}
button.secondary:hover,.btn.secondary:hover,button.no:hover{
  border-color:#8CA3C4;
  background:#FBF9F4;
  color:#17171A;
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
  background:#FFFFFF;
  border:1px solid #E4DED0;
  border-radius:12px;
  padding:1.05rem 1.15rem;
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
  background:#FFFFFF;
  border:1px solid #E4DED0;
  border-radius:12px;
  padding:.95rem 1.1rem;
  display:flex;
  align-items:flex-start;
  gap:.85rem;
}
.phase-card.is-done{border-color:rgba(140,163,196,.55)}
.phase-card.is-active{border-color:#8CA3C4;box-shadow:0 6px 20px rgba(95,122,158,.1)}
.phase-card.is-review{border-color:#E8A33D;background:#FFFDF9;box-shadow:0 8px 24px rgba(232,163,61,.12)}
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
  border-radius:8px;
  border:1px solid rgba(140,163,196,.55);
  background:rgba(140,163,196,.12);
}
.pill-link:hover{background:#8CA3C4;color:#0A0A0C;border-color:#8CA3C4}
.banner-ok{
  background:#FFFFFF;
  border:1px solid #8CA3C4;
  border-left:3px solid #3D5A85;
  border-radius:10px;
  padding:.8rem 1rem;
  margin-bottom:1.15rem;
  font-size:.82rem;
  color:#17171A;
  text-align:left;
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
  } = {}
) {
  const l = pickLang(lang);
  const common = (PG[l] || PG.es).common;
  const tag = common.studioTag;
  const backText = footerLabel || common.backSite;

  return `<!DOCTYPE html><html lang="${l}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="robots" content="noindex"><meta name="color-scheme" content="light"><meta name="theme-color" content="#FFFFFF"><title>${esc(lc1(title))} — rebrandyourbrand</title><style>${PAGE_CSS}</style></head><body><div class="shell${wide ? " wide" : ""}"><header class="topbar"><a href="${SITE_URL}" class="brand-link" aria-label="rebrandyourbrand">${RYBB_LOGO_SVG}</a><span class="brand-tag">${esc(tag)}</span></header><main class="card">${eyebrow ? `<span class="eyebrow">${esc(eyebrow)}</span>` : ""}<h1>${esc(heading)}</h1>${text ? `<p class="lead">${esc(text)}</p>` : ""}${html}${form ? `<form method="POST"><button type="submit">${esc(formLabel)}</button></form>` : ""}</main><footer class="foot"><a href="${esc(footerUrl)}">${esc(backText)}</a><a href="mailto:hola@rebrandyourbrand.es">hola@rebrandyourbrand.es</a></footer></div></body></html>`;
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

async function completeProjectPhase(
  env,
  proj,
  projectToken,
  { approvedBy = "studio", deliverableUrl = "", deliverableFilename = "", note = "", legacyActionToken = "" } = {}
) {
  const idx = proj.phases.findIndex(
    (ph) => ph.step === Number(proj.currentPhase) && (ph.status === "active" || ph.status === "review")
  );
  const targetIdx =
    idx >= 0 ? idx : proj.phases.findIndex((ph) => ph.status === "active" || ph.status === "review");
  if (targetIdx < 0) return { ok: false, reason: "already_finished" };

  const now = new Date().toISOString();
  const advancedPhase = proj.phases[targetIdx];
  advancedPhase.status = "done";
  advancedPhase.date = now;
  advancedPhase.approvedBy = approvedBy;
  if (approvedBy === "client") advancedPhase.approvedAt = now;
  if (deliverableUrl) advancedPhase.deliverableUrl = deliverableUrl;
  if (deliverableFilename) advancedPhase.deliverableFilename = deliverableFilename;
  if (note) advancedPhase.note = note;

  let nextPhase = null;
  let nextStep = 0;
  let finished = false;

  if (targetIdx + 1 < proj.phases.length) {
    nextPhase = proj.phases[targetIdx + 1];
    nextPhase.status = "active";
    nextPhase.date = now;
    nextStep = nextPhase.step;
    proj.currentPhase = nextStep;
  } else {
    finished = true;
    proj.finishedAt = now;
    proj.currentPhase = advancedPhase.step + 1;
    if (Array.isArray(proj.services) && proj.services.includes("web") && !proj.nextRenewalAt) {
      proj.nextRenewalAt = addOneYearIso(now);
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
              ? `— estado: ${bold("proyecto finalizado")}`
              : `— nueva fase activa: ${bold(`paso ${nextStep} — ${nextTitleEs}`)}`
          ),
        ]
      : [
          "hola,",
          `la fase ${bold(advancedTitleEs)} del proyecto ${bold(proj.brand)} se ha completado con éxito.`,
          finished
            ? "el proyecto ha completado todas sus fases y ha finalizado."
            : `la nueva fase activa es: ${bold(`paso ${nextStep} — ${nextTitleEs}`)}.`,
        ];

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
                finished ? `— ${bold(t.finished)}` : `— ${t.next}: ${bold(phaseTitle(nextPhase, lang))}`
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

    await env.LEADS_KV.put(`project:${projectToken}`, JSON.stringify(proj));
    if (legacyActionToken) {
      await env.LEADS_KV.delete(`phase_action:${legacyActionToken}`).catch(() => {});
    }
  } catch (e) {
    console.error("phase advance email failed:", e?.message);
    const retryAdvanceUrl = await advancePhaseUrl(env, projectToken, advancedPhase.step);
    await alertAdmin(
      env,
      "fallo al enviar correos de avance de fase",
      `proyecto: ${proj.brand}\nerror: ${e?.message}\nenlace de gestión: ${retryAdvanceUrl}`
    );
    return { ok: false, reason: "email_failed" };
  }

  if (finished && !proj.reviewInvited) {
    try {
      await sendReviewInvite(env, proj, projectToken);
      proj.reviewInvited = true;
      await env.LEADS_KV.put(`project:${projectToken}`, JSON.stringify(proj));
    } catch (e) {
      console.error("review invite failed:", e?.message);
      await alertAdmin(
        env,
        "fallo al enviar la invitación a valorar",
        `proyecto: ${proj.brand}\ncliente: ${proj.clientEmail}\nenlace de valoración (envíaselo a mano): ${await reviewUrl(env, projectToken)}`
      );
    }
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
async function handlePhaseAdvance(request, env, url) {
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

  const allDone = Array.isArray(proj.phases) && proj.phases.every((ph) => ph.status === "done");
  if (allDone) {
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
  const revsUsed = Math.min(MAX_PHASE_REVISIONS, Math.max(0, Number(currentPhaseObj.revisionsUsed) || 0));
  const stateLabel =
    currentPhaseObj.status === "review"
      ? `en revisión del cliente (enviada el ${fmtDate(currentPhaseObj.reviewSentAt || currentPhaseObj.date, "es")})`
      : revsUsed > 0
        ? `aplicando ajustes del cliente (ronda ${revsUsed} de ${MAX_PHASE_REVISIONS})`
        : "en curso en el estudio";

  if (request.method === "GET" || request.method === "HEAD") {
    const ob = proj.onboarding;
    const obHtml = ob
      ? `<div class="box">
          <span class="eyebrow">materiales del cliente</span>
          <div class="kv">
            ${ob.socials ? `<div class="kv-row"><span>web / redes</span><span class="kv-val">${esc(ob.socials)}</span></div>` : ""}
            ${ob.domain ? `<div class="kv-row"><span>dominio</span><span class="kv-val">${esc(ob.domain)}</span></div>` : ""}
            ${ob.materials ? `<div class="kv-row"><span>carpeta / notas</span><span class="kv-val">${esc(ob.materials)}</span></div>` : ""}
          </div>
        </div>`
      : "";

    const revsHtml =
      Array.isArray(currentPhaseObj.revisions) && currentPhaseObj.revisions.length
        ? `<div class="box review-box">
            <span class="eyebrow">historial de ajustes solicitados por el cliente</span>
            ${currentPhaseObj.revisions
              .map(
                (rv) => `<div style="margin-bottom:.75rem;">
                  <span style="display:block;font-size:.75rem;font-weight:600;color:#825008;margin-bottom:.25rem;">ronda ${Number(rv.round) || 1} de ${MAX_PHASE_REVISIONS}${rv.requestedAt ? ` — ${esc(fmtDate(rv.requestedAt, "es"))}` : ""}</span>
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
          <div class="kv-row"><span>servicios</span><span class="kv-val">${esc(svcLabel(proj.services, "es"))}</span></div>
          <div class="kv-row"><span>fase actual</span><span class="kv-val">paso ${currentPhaseObj.step} — ${esc(currentTitleEs)}</span></div>
          <div class="kv-row"><span>estado</span><span class="kv-val">${esc(stateLabel)}</span></div>
          <div class="kv-row"><span>rondas gratuitas usadas</span><span class="kv-val">${revsUsed} de ${MAX_PHASE_REVISIONS}</span></div>
        </div>
      </div>
      ${obHtml}
      ${revsHtml}
      <form method="POST" enctype="multipart/form-data" style="text-align:left;">
        <label for="deliverable_file">1. subir archivo directo del entregable (opcional, cualquier formato)</label>
        <input id="deliverable_file" name="deliverable_file" type="file">
        <span class="file-note">acepta cualquier formato (pdf, zip, png, jpg, svg, webp, mp4...) hasta 25 mb.</span>
        <label for="deliverable_url">2. o pegar enlace externo (opcional si subes archivo, ej. github pages o figma)</label>
        <input id="deliverable_url" name="deliverable_url" type="url" maxlength="500" placeholder="https://..." value="${esc(currentPhaseObj.deliverableUrl || "")}">
        <label for="note">nota para el cliente (opcional)</label>
        <textarea id="note" name="note" rows="4" maxlength="600" placeholder="contexto breve sobre la entrega, qué revisar o pasos siguientes...">${esc(currentPhaseObj.note || "")}</textarea>
        <div class="confirm-box">
          <label class="confirm-label">
            <input type="checkbox" name="confirm_action" value="yes" required>
            <span>confirmo que he revisado el contenido y el entregable antes de enviarlo definitivamente</span>
          </label>
        </div>
        <button type="submit" name="decision" value="review">enviar propuesta a revisión del cliente</button>
        <button type="submit" name="decision" value="complete" class="secondary">marcar fase como completada y avanzar directamente</button>
      </form>
    `;

    return htmlResponse(
      page(
        `gestionar fase — ${proj.brand}`,
        "gestionar fase del proyecto",
        "puedes enviar un entregable para que el cliente lo valide por escrito en un clic, o cerrar la fase directamente si ya está aprobada.",
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

  if (String(form?.get("confirm_action") || "") !== "yes") {
    return htmlResponse(
      page(
        "confirmación obligatoria",
        "marca la casilla de confirmación",
        "es obligatorio marcar la casilla de confirmación antes de enviar la propuesta o completar la fase.",
        {
          eyebrow: "panel interno del estudio",
          footerUrl: currentManageUrl,
          footerLabel: "volver a la fase",
        }
      ),
      400
    );
  }

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
  const decision = String(form?.get("decision") ?? "complete");

  if (decision === "review") {
    const now = new Date().toISOString();
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

      await env.LEADS_KV.put(`project:${projectToken}`, JSON.stringify(proj));
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
        "propuesta enviada",
        "propuesta enviada a revisión",
        `hemos avisado a ${proj.clientEmail} con el enlace para revisar, aprobar por escrito o pedir ajustes en "${currentTitleEs}".`,
        {
          eyebrow: "panel interno del estudio",
          html: `<a class="btn secondary" href="${esc(currentManageUrl)}">volver al panel de esta fase</a>`,
          footerUrl: trackingUrl,
          footerLabel: "ver página del cliente",
        }
      ),
      200
    );
  }

  const result = await completeProjectPhase(env, proj, projectToken, {
    approvedBy: "studio",
    deliverableUrl: effectiveDeliverableUrl,
    deliverableFilename: effectiveDeliverableFilename,
    note,
    legacyActionToken,
  });

  if (!result.ok) {
    if (result.reason === "email_failed") {
      return htmlResponse(
        page(
          "error al notificar",
          "no se ha podido enviar el correo",
          "no se ha podido enviar el correo de notificación, así que la fase sigue sin cambios en el sistema para que puedas reintentarlo sin perder el estado.",
          {
            eyebrow: "panel interno del estudio",
            html: `<a class="btn" href="${esc(currentManageUrl)}">reintentar ahora</a>`,
            footerUrl: trackingUrl,
            footerLabel: "ver página del cliente",
          }
        ),
        500
      );
    }
    return htmlResponse(page("finalizado", "proyecto ya finalizado", "no quedan fases activas."), 400);
  }

  const nextBtnHtml = result.nextActionUrl
    ? `<a class="btn" href="${esc(result.nextActionUrl)}">abrir panel de la siguiente fase (${esc(result.nextTitleEs)})</a>`
    : "";

  return htmlResponse(
    page(
      "fase completada",
      "fase avanzada con éxito",
      `has completado "${result.advancedTitleEs}" para ${proj.brand}.${result.finished ? " el proyecto ha finalizado y hemos invitado al cliente a valorarlo." : ` la nueva fase activa es "${result.nextTitleEs}" y se ha notificado al cliente.`}`,
      {
        eyebrow: "panel interno del estudio",
        html: nextBtnHtml,
        footerUrl: trackingUrl,
        footerLabel: "ver seguimiento del cliente",
      }
    ),
    200
  );
}

// ── REVISIÓN, SOLICITUD DE AJUSTES Y APROBACIÓN ESCRITA POR EL CLIENTE (/approve-phase) ──
async function handlePhaseApprove(request, env, url) {
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
    return htmlResponse(
      page(A.already[0], A.already[1], A.already[2], {
        lang: L,
        eyebrow: A.eyebrow,
        html: `<a class="btn" href="${esc(trackingUrl)}">${esc(PG[L].common.openTracker)}</a>`,
        footerUrl: trackingUrl,
        footerLabel: PG[L].common.openTracker,
      }),
      200
    );
  }

  const used = Math.min(MAX_PHASE_REVISIONS, Math.max(0, Number(ph.revisionsUsed) || 0));
  const nextRound = used + 1;

  if (ph.status === "active" && used > 0) {
    return htmlResponse(
      page(A.revWorking[0], A.revWorking[1], A.revWorking[2](used, MAX_PHASE_REVISIONS), {
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
    const detailHtml =
      ph.note || ph.deliverableUrl || used > 0
        ? `<div class="box">
            ${ph.note ? `<p style="font-size:.84rem;color:#17171A;margin-bottom:${ph.deliverableUrl || used > 0 ? ".75rem" : "0"};white-space:pre-wrap;"><strong>${esc(T.studioNote)}:</strong> ${esc(ph.note)}</p>` : ""}
            ${ph.deliverableUrl ? `<a class="pill-link" href="${esc(ph.deliverableUrl)}" target="_blank" rel="noopener noreferrer">${esc(ph.deliverableFilename ? `${A.deliverable} (${ph.deliverableFilename})` : A.deliverable)}</a>` : ""}
            ${used > 0 ? `<p style="font-size:.75rem;color:#58575E;margin-top:${ph.deliverableUrl ? ".65rem" : "0"};">${esc(A.roundsUsed(used, MAX_PHASE_REVISIONS))}</p>` : ""}
          </div>`
        : "";

    const canRevise = ph.status === "review" && used < MAX_PHASE_REVISIONS;
    const reviseHtml = canRevise
      ? `<details class="rev-details"${revError ? " open" : ""}>
          <summary class="btn secondary">${esc(A.revToggle(nextRound, MAX_PHASE_REVISIONS))}</summary>
          <div class="rev-body">
            ${revError ? `<p class="rev-err">${esc(revError)}</p>` : ""}
            <form method="POST">
              <input type="hidden" name="decision" value="revise">
              <label for="feedback">${esc(A.revLabel(nextRound, MAX_PHASE_REVISIONS))}</label>
              <textarea id="feedback" name="feedback" rows="4" minlength="5" maxlength="1500" required placeholder="${esc(A.revPh)}"></textarea>
              <div class="confirm-box">
                <label class="confirm-label">
                  <input type="checkbox" name="confirm_action" value="yes" required>
                  <span>${esc(A.confirmRevise)}</span>
                </label>
              </div>
              <button type="submit">${esc(A.revSubmit(nextRound, MAX_PHASE_REVISIONS))}</button>
            </form>
          </div>
        </details>`
      : used >= MAX_PHASE_REVISIONS
        ? `<div class="box" style="margin-top:.85rem;margin-bottom:0;font-size:.8rem;color:#58575E;">${esc(A.revExhausted)}</div>`
        : "";

    const bodyHtml = `${detailHtml}<p class="lead" style="font-size:.82rem;margin-bottom:1.25rem;">${esc(A.legal)}</p><form method="POST"><input type="hidden" name="decision" value="approve"><div class="confirm-box"><label class="confirm-label"><input type="checkbox" name="confirm_action" value="yes" required><span>${esc(A.confirmApprove)}</span></label></div><button type="submit">${esc(A.btn)}</button></form>${reviseHtml}`;

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
    return renderReviewScreen();
  }

  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
  }

  const form = await request.formData().catch(() => null);
  const decision = String(form?.get("decision") || "approve");

  if (String(form?.get("confirm_action") || "") !== "yes") {
    return renderReviewScreen(A.confirmRequired, 400);
  }

  if (decision === "revise") {
    if (ph.status !== "review" || used >= MAX_PHASE_REVISIONS) {
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

    try {
      await resendSend(
        env,
        {
          to: ["hola@rebrandyourbrand.es"],
          reply_to: proj.clientEmail,
          subject: `ajustes solicitados (ronda ${round} de ${MAX_PHASE_REVISIONS}) — "${phaseTitleEs}" — ${proj.brand}`,
          ...renderEmail("es", {
            paras: [
              "el cliente ha solicitado ajustes directamente desde la página de revisión de fase.",
              lines(
                `— proyecto: ${bold(proj.brand)}`,
                `— cliente: ${bold(proj.clientEmail)}`,
                `— fase: ${bold(`paso ${ph.step} — ${phaseTitleEs}`)}`,
                `— ronda consumida: ${bold(`ronda ${round} de ${MAX_PHASE_REVISIONS}`)}`,
                `— fecha (iso): ${bold(now)}`
              ),
              "cambios solicitados por el cliente:",
            ],
            quote: feedback,
            cta: { label: "abrir panel de la fase para subir nueva versión", url: manageUrl },
            secondaryLink: { label: "ver seguimiento público del cliente", url: trackingUrl },
            note:
              round >= MAX_PHASE_REVISIONS
                ? "esta ha sido la segunda y última ronda gratuita incluida en esta fase. cualquier ajuste posterior se tarifica aparte o a 50 €/h (cláusula 1.2)."
                : "cuando tengas lista la propuesta ajustada, vuelve a enviarla a revisión desde el panel de la fase.",
          }),
        },
        `revise-admin-${p}-${step}-r${round}`
      );
    } catch (e) {
      console.error("revision request email failed:", e?.message);
      return errorPage(L);
    }

    ph.revisionsUsed = round;
    if (!Array.isArray(ph.revisions)) ph.revisions = [];
    ph.revisions.push({ round, text: feedback, requestedAt: now });
    ph.status = "active";
    ph.lastRevisionAt = now;
    delete ph.reminderSentAt;
    delete ph.tacitAlertSentAt;
    await env.LEADS_KV.put(`project:${p}`, JSON.stringify(proj));

    return htmlResponse(
      page(A.revDone[0], A.revDone[1], A.revDone[2](round, MAX_PHASE_REVISIONS), {
        lang: L,
        eyebrow: A.eyebrow,
        html: `<a class="btn" href="${esc(trackingUrl)}">${esc(PG[L].common.openTracker)}</a>`,
        footerUrl: trackingUrl,
        footerLabel: PG[L].common.openTracker,
      }),
      200
    );
  }

  const res = await completeProjectPhase(env, proj, p, {
    approvedBy: "client",
    deliverableUrl: ph.deliverableUrl || "",
    deliverableFilename: ph.deliverableFilename || "",
    note: ph.note || "",
  });

  if (!res.ok && res.reason === "email_failed") return errorPage(L);

  return htmlResponse(
    page(A.done[0], A.done[1], A.done[2], {
      lang: L,
      eyebrow: A.eyebrow,
      html: `<a class="btn" href="${esc(trackingUrl)}">${esc(PG[L].common.openTracker)}</a>`,
      footerUrl: trackingUrl,
      footerLabel: PG[L].common.openTracker,
    }),
    200
  );
}

// ── BAJA EN UN CLIC DE LA RENOVACIÓN ANUAL (/cancel-renewal) ──
async function handleCancelRenewal(request, env, url) {
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
  await env.LEADS_KV.put(`project:${p}`, JSON.stringify(proj));
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

// ── DESCARGA DIRECTA DE ENTREGABLES (/file) ──
async function handleFileDownload(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  const p = url.searchParams.get("p");
  const step = parseInt(url.searchParams.get("step") || "", 10);
  const id = url.searchParams.get("id");
  const t = url.searchParams.get("t");

  if (
    !p ||
    !/^[a-f0-9]{64}$/.test(p) ||
    !Number.isInteger(step) ||
    step < 1 ||
    step > 20 ||
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

  const filename = metadata?.filename || `entregable-fase-${step}`;
  const safeName = safeFilename(filename, `entregable-fase-${step}`);
  const contentType = metadata?.contentType || "application/octet-stream";
  const size = metadata?.size || value.byteLength;
  const encodedName = encodeURIComponent(safeName);

  return new Response(value, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${safeName.replace(/["\r\n\\]/g, "_")}"; filename*=UTF-8''${encodedName}`,
      "Content-Length": String(size),
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

// ── SEGUIMIENTO DEL PROYECTO, RESCATE DE PAGO Y ONBOARDING (/proyecto) ──
async function handleProject(request, env, url) {
  let L = langFromRequest(request);
  const token = url.searchParams.get("token");
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return msgPage(L, "trackInvalid", 404);
  }
  if (!env.LEADS_KV) return msgPage(L, "config", 500);

  const raw = await env.LEADS_KV.get(`project:${token}`);
  if (!raw) return msgPage(L, "trackMissing", 404);

  let proj = JSON.parse(raw);
  L = pickLang(proj.lang);
  const T = PG[L].tr;
  const projectPageUrl = buildUrl("/proyecto", { token });

  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    const op = String(form?.get("op") || (!proj.paid ? "pay" : ""));

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

    if (op === "onboarding") {
      if (!proj.paid) return redirectTo(projectPageUrl);
      if (String(form?.get("confirm_action") || "") !== "yes") {
        return htmlResponse(
          page(T.confirmRequiredTitle || "confirmación obligatoria", T.confirmRequiredHeading || "marca la casilla de confirmación", T.confirmRequired, {
            lang: L,
            eyebrow: T.obEyebrow,
            html: `<a class="btn" href="${esc(projectPageUrl)}">${esc(PG[L].common.openTracker)}</a>`,
            footerUrl: projectPageUrl,
            footerLabel: PG[L].common.openTracker,
          }),
          400
        );
      }
      const socials = cleanInput(form?.get("socials") ?? "", 250);
      const domain = cleanInput(form?.get("domain") ?? "", 200);
      const materials = cleanInput(form?.get("materials") ?? "", 500);

      if (!socials && !domain && !materials) {
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

      proj.onboarding = {
        socials,
        domain,
        materials,
        submittedAt: new Date().toISOString(),
      };
      await env.LEADS_KV.put(`project:${token}`, JSON.stringify(proj));

      if (env.RESEND_API_KEY) {
        const manageUrl = await advancePhaseUrl(env, token, proj.currentPhase || 1);
        await resendSend(
          env,
          {
            to: ["hola@rebrandyourbrand.es"],
            reply_to: proj.clientEmail,
            subject: `materiales iniciales recibidos — ${proj.brand}`,
            ...renderEmail("es", {
              paras: [
                `el cliente ha enviado los materiales de arranque para ${bold(proj.brand)}.`,
                lines(
                  `— cliente: ${bold(proj.clientEmail)}`,
                  socials && `— web / redes actuales: ${bold(socials)}`,
                  domain && `— dominio: ${bold(domain)}`,
                  materials && `— carpeta / notas: ${bold(materials)}`
                ),
              ],
              cta: { label: "abrir gestión de la fase actual", url: manageUrl },
              secondaryLink: { label: "ver seguimiento del cliente", url: projectPageUrl },
            }),
          },
          `onboarding-${token}-${Date.now()}`
        ).catch((e) => console.error("onboarding email failed:", e?.message));
      }

      return redirectTo(buildUrl("/proyecto", { token, ob: "1" }));
    }

    return redirectTo(projectPageUrl);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
  }

  if (!proj.paid || !proj.emailsSent || !proj.receiptUrl) {
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
    }
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

  const bannerHtml =
    url.searchParams.get("ob") === "1" ? `<div class="banner-ok">${esc(T.obSentBanner)}</div>` : "";

  const allDone = Array.isArray(proj.phases) && proj.phases.every((ph) => ph.status === "done");
  let onboardingHtml = "";

  if (!proj.onboarding && !allDone) {
    onboardingHtml = `
      <div class="box accent">
        <span class="eyebrow">${esc(T.obEyebrow)}</span>
        <h2>${esc(T.obTitle)}</h2>
        <p class="lead" style="margin-bottom:1.1rem;font-size:.85rem;">${esc(T.obIntro)}</p>
        <form method="POST" style="text-align:left;">
          <input type="hidden" name="op" value="onboarding">
          <label for="socials">${esc(T.obSocials)}</label>
          <input id="socials" name="socials" type="text" maxlength="250" placeholder="${esc(T.obSocialsPh)}">
          <label for="domain">${esc(T.obDomain)}</label>
          <input id="domain" name="domain" type="text" maxlength="200" placeholder="${esc(T.obDomainPh)}">
          <label for="materials">${esc(T.obMaterials)}</label>
          <textarea id="materials" name="materials" rows="3" maxlength="500" placeholder="${esc(T.obMaterialsPh)}"></textarea>
          <div class="confirm-box">
            <label class="confirm-label">
              <input type="checkbox" name="confirm_action" value="yes" required>
              <span>${esc(T.confirmOnboarding)}</span>
            </label>
          </div>
          <button type="submit">${esc(T.obSubmit)}</button>
        </form>
      </div>`;
  } else if (proj.onboarding) {
    const ob = proj.onboarding;
    const matUrl = cleanHttpsUrl(ob.materials, 500);
    const matVal = matUrl
      ? `<a href="${esc(matUrl)}" target="_blank" rel="noopener noreferrer" style="color:#3D5A85;text-decoration:underline;">${esc(matUrl)}</a>`
      : esc(ob.materials);
    onboardingHtml = `
      <div class="box">
        <span class="eyebrow">${esc(T.obSentTitle)}</span>
        <div class="kv">
          ${ob.socials ? `<div class="kv-row"><span>${esc(T.obLblSocials)}</span><span class="kv-val">${esc(ob.socials)}</span></div>` : ""}
          ${ob.domain ? `<div class="kv-row"><span>${esc(T.obLblDomain)}</span><span class="kv-val">${esc(ob.domain)}</span></div>` : ""}
          ${ob.materials ? `<div class="kv-row"><span>${esc(T.obLblMaterials)}</span><span class="kv-val" style="word-break:break-all;">${matVal}</span></div>` : ""}
        </div>
      </div>`;
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
        const rUsed = Math.min(MAX_PHASE_REVISIONS, Math.max(0, Number(ph.revisionsUsed) || 0));
        meta = rUsed > 0 ? T.activeRev(rUsed, MAX_PHASE_REVISIONS) : T.active;
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

  const fullHtml = `
    ${bannerHtml}
    ${headerHtml}
    ${onboardingHtml}
    <h3>${esc(T.state)}</h3>
    <div class="timeline">${phaseCards.join("")}</div>`;

  return htmlResponse(
    page(`${T.title} — ${proj.brand}`, T.heading, "", {
      lang: L,
      eyebrow: T.eyebrow,
      wide: true,
      html: fullHtml,
    }),
    200
  );
}

// ── VALORACIÓN VERIFICADA (/valorar) ──
async function handleReview(request, env, url) {
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

  const finished =
    proj.paid &&
    Array.isArray(proj.phases) &&
    proj.phases.length > 0 &&
    proj.phases.every((ph) => ph.status === "done");
  if (!finished) return msgPage(L, "rvNotReady", 403, { footerUrl: trackingUrl, footerLabel: PG[L].common.openTracker });
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
  await env.LEADS_KV.put(`project:${p}`, JSON.stringify(proj));
  return msgPage(L, "rvThanks", 200, {
    footerUrl: trackingUrl,
    footerLabel: PG[L].common.openTracker,
  });
}

// ── MODERACIÓN DE RESEÑA (/testimonial) ──
async function handleTestimonialReview(request, env, url) {
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
async function handleTestimonialDelete(request, env, url) {
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
    const { success } = await env.CHAT_LIMITER.limit({ key: `e:${ipKey(ip)}` });
    if (!success) throw new HttpError(429, "rate_limited", { "Retry-After": "60" });
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
  if (!env.LEADS_KV || !env.CHAT_LIMITER || !env.RESEND_API_KEY) throw new HttpError(500, "misconfigured");
  const { success } = await env.CHAT_LIMITER.limit({ key: `p:${ipKey(ip)}` });
  if (!success) throw new HttpError(429, "rate_limited", { "Retry-After": "60" });

  const vt = await parseResume(await getKey(env), body.resume);
  if (!vt) throw new HttpError(400, "invalid_resume");
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

async function handleChatPost(request, env, body, o) {
  try {
    const ip = request.headers.get("CF-Connecting-IP") ?? "";

    // ── SESIÓN DE CHAT: Turnstile una sola vez al empezar la conversación ──
    if (body.action === "session") {
      if (!env.CHAT_LIMITER || !env.TURNSTILE_SECRET_KEY) throw new HttpError(500, "misconfigured");
      const { success } = await env.CHAT_LIMITER.limit({ key: `s:${ipKey(ip)}` });
      if (!success) throw new HttpError(429, "rate_limited", { "Retry-After": "60" });
      await verifyTurnstile(env, body.token, ip, "brandi-chat");
      return jsonResponse({ session: await makeSession(await getKey(env), ip) }, 200, o);
    }

    // ── VERIFICACIÓN PENDIENTE (estado, reenviar, empezar de nuevo) ──
    if (body.action === "pending") return await handlePendingAction(env, body, ip, o);

    // ── CHAT CON BRANDI ──
    if (!env.LEADS_KV || !env.CHAT_LIMITER || !env.GROQ_API_KEY || !env.TURNSTILE_SECRET_KEY) {
      throw new HttpError(500, "misconfigured");
    }
    const { success } = await env.CHAT_LIMITER.limit({ key: ipKey(ip) });
    if (!success) throw new HttpError(429, "rate_limited", { "Retry-After": "60" });

    const lang = LANG_ORDER.includes(body.lang) ? body.lang : "es";
    const key = await getKey(env);
    const chatMessages = await normalizeMessages(key, body.messages);
    if (!chatMessages.length || chatMessages.at(-1).role !== "user") {
      throw new HttpError(400, "invalid_messages");
    }

    const plan0 = normalizeServices(body.services);

    if (!(await verifySession(key, body.session, ip))) throw new HttpError(403, "session_invalid");

    const email = findEmail(chatMessages);
    const brand0 = cleanBrand(body.brand);
    const confirmSigIn = typeof body.confirmSig === "string" ? body.confirmSig : "";
    const isShown = async (p, b) =>
      !!(email && b && p) && (await verifyRaw(key, confirmPayload(email, b, p), confirmSigIn));

    const confirmAndSend = async (plan, brand) => {
      if (!env.RESEND_API_KEY) throw new HttpError(500, "misconfigured");
      if (!plan) throw new HttpError(400, "plan_required");
      if (!(await isShown(plan, brand))) throw new HttpError(400, "invalid_confirmation");

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
          services: planOut(plan),
          resume: `${verifyToken}.${await resumeSig(key, verifyToken)}`,
          emailHint: maskEmail(email),
        },
        200,
        o
      );
    };

    if (body.confirm === true) {
      return await confirmAndSend(plan0, brand0);
    }

    const lastText = chatMessages.at(-1)?.text || "";
    const userDenied = DENY_RE.test(lastText);
    const userAgreed =
      lastText.length <= 60 && AGREE_RE.test(lastText) && !userDenied && !CHANGE_INTENT_RE.test(lastText);

    const summaryResponse = async (plan, brand) => {
      const reply = buildSummary(lang, { brand, email, plan });
      const confirmSig = await signRaw(key, confirmPayload(email, brand, plan));
      return jsonResponse(
        {
          reply,
          sig: await signMsg(key, reply),
          leadClosed: false,
          canConfirm: true,
          confirmSig,
          brand,
          services: planOut(plan),
        },
        200,
        o
      );
    };

    const wasShown = await isShown(plan0, brand0);

    // Si el resumen ya estaba en pantalla y el cliente escribe "sí"/"vale"/"ok"/"bai", confirmamos sin bucle
    if (wasShown && userAgreed) {
      return await confirmAndSend(plan0, brand0);
    }

    // Si el cliente acaba de dar el último dato que faltaba (p. ej. el correo) sin pedir cambios, devolvemos el resumen al instante sin llamar a Groq
    const missing0 = missingOf(brand0, email, plan0);
    const textWithoutEmail = lastText.replace(EMAIL_FIND, "").trim();
    if (
      !missing0.length &&
      !wasShown &&
      !userDenied &&
      !CHANGE_INTENT_RE.test(textWithoutEmail) &&
      !SERVICE_MENTION_RE.test(textWithoutEmail)
    ) {
      return await summaryResponse(plan0, brand0);
    }

    const out = await askGroq(
      env,
      lang,
      { plan: plan0, brand: brand0, email, denied: wasShown && userDenied },
      chatMessages
    );

    const plan = mergeServices(plan0, out);
    const brand = cleanBrand(out.brand) || brand0;
    const missing = missingOf(brand, email, plan);

    if (!missing.length) {
      const shownNow = await isShown(plan, brand);
      if (!shownNow) return await summaryResponse(plan, brand);
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

  // 1. Cláusula 3.3 — Recordatorio a los 15 días y aviso de aprobación tácita a los 20 días
  if (Array.isArray(proj.phases)) {
    for (const ph of proj.phases) {
      if (ph.status !== "review" || !ph.reviewSentAt) continue;
      const sentMs = new Date(ph.reviewSentAt).getTime();
      if (Number.isNaN(sentMs)) continue;
      const daysElapsed = (nowMs - sentMs) / DAY_MS;

      if (daysElapsed >= TACIT_REMINDER_DAYS && daysElapsed < TACIT_APPROVAL_DAYS && !ph.reminderSentAt) {
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
            `tacit-15d-${projectToken}-${ph.step}-${ph.reviewSentAt.slice(0, 10)}`
          );
          ph.reminderSentAt = nowIso;
          changed = true;
        } catch (e) {
          console.error("tacit 15d reminder failed:", e?.message);
        }
      }

      if (daysElapsed >= TACIT_APPROVAL_DAYS && !ph.tacitAlertSentAt) {
        const phNameEs = phaseTitle(ph, "es");
        const manageUrl = await advancePhaseUrl(env, projectToken, ph.step);
        try {
          await resendSend(
            env,
            {
              to: ["hola@rebrandyourbrand.es"],
              reply_to: proj.clientEmail,
              subject: `plazo de 20 días cumplido (aprobación tácita) — ${proj.brand}`,
              ...renderEmail("es", {
                paras: [
                  `han transcurrido al menos 20 días naturales desde el envío a revisión de ${bold(phNameEs)} en ${bold(proj.brand)}.`,
                  lines(
                    `— cliente: ${bold(proj.clientEmail)}`,
                    `— enviada a revisión: ${bold(fmtDate(ph.reviewSentAt, "es"))}`,
                    `— fase: ${bold(`paso ${ph.step} — ${phNameEs}`)}`
                  ),
                  "si el cliente no ha pedido cambios por correo, puedes cerrar la fase aplicando la cláusula 3.3 desde el botón inferior.",
                ],
                cta: { label: "abrir panel y avanzar fase", url: manageUrl },
              }),
            },
            `tacit-20d-${projectToken}-${ph.step}-${ph.reviewSentAt.slice(0, 10)}`
          );
          ph.tacitAlertSentAt = nowIso;
          changed = true;
        } catch (e) {
          console.error("tacit 20d studio alert failed:", e?.message);
        }
      }
    }
  }

  // 2. Cláusula 3.1 — Preaviso de 30 días para renovación anual de infraestructura web
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

        if (renewalEur > 0 && env.STRIPE_SECRET_KEY) {
          const payUrl = await createRenewalCheckout(env, proj, renewalEur);
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
              proj.renewalRemindedFor = proj.nextRenewalAt;
              changed = true;
            } catch (e) {
              console.error("renewal client email failed:", e?.message);
            }
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
            proj.renewalRemindedFor = proj.nextRenewalAt;
            changed = true;
          } catch (e) {
            console.error("renewal admin reminder failed:", e?.message);
          }
        }
      }
    }
  }

  if (changed) {
    await env.LEADS_KV.put(keyName, JSON.stringify(proj));
  }
}

async function handleScheduled(controller, env, ctx) {
  if (!env.LEADS_KV || !env.RESEND_API_KEY || !env.CHAT_SIGNING_SECRET) {
    console.error("scheduled cron skipped: missing bindings");
    return;
  }

  const nowMs = controller?.scheduledTime ? Number(controller.scheduledTime) : Date.now();
  let cursor;
  do {
    const list = await env.LEADS_KV.list({ prefix: "project:", cursor });
    for (const item of list.keys) {
      await inspectProjectDeadlines(env, item.name, nowMs).catch((e) =>
        console.error("cron project check failed:", item.name, e?.message)
      );
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
}

// ══ index.js — Punto de entrada del Worker: enrutado de peticiones HTTP y eventos programados. ══

const HTML_CLIENT_PATHS = new Set(["/verify", "/valorar", "/approve-phase", "/cancel-renewal"]);

const HTML_ADMIN_PATHS = new Set(["/testimonial", "/testimonial-delete", "/advance-phase"]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/webhook/stripe") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "method_not_allowed" }, 405, null, { Allow: "POST" });
      }
      try {
        return await handleStripeWebhook(request, env);
      } catch (e) {
        console.error("stripe webhook failed:", e?.message);
        return jsonResponse({ error: "webhook_failed" }, 500, null);
      }
    }

    if (HTML_CLIENT_PATHS.has(url.pathname) || HTML_ADMIN_PATHS.has(url.pathname)) {
      try {
        if (url.pathname === "/verify") return await handleVerify(request, env, ctx, url);
        if (url.pathname === "/testimonial") return await handleTestimonialReview(request, env, url);
        if (url.pathname === "/testimonial-delete") return await handleTestimonialDelete(request, env, url);
        if (url.pathname === "/advance-phase") return await handlePhaseAdvance(request, env, url);
        if (url.pathname === "/approve-phase") return await handlePhaseApprove(request, env, url);
        if (url.pathname === "/cancel-renewal") return await handleCancelRenewal(request, env, url);
        if (url.pathname === "/valorar") return await handleReview(request, env, url);
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
        return await handleProject(request, env, url);
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
        const approved = (await env.LEADS_KV.get(APPROVED_KEY, { type: "json", cacheTtl: 60 })) || [];
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

    return handleChatPost(request, env, body, o);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(handleScheduled(controller, env, ctx));
  },
};
