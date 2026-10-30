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

// Importe base anual de renovación de infraestructura web (dominio, DNS/SSL y correo corporativo) si env.WEB_RENEWAL_EUR no está definida en Cloudflare
const WEB_RENEWAL_EUR = 85;

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
      es: "página web rápida y a tu nombre, publicada y entregada llave en mano",
      ca: "pàgina web ràpida i a nom teu, publicada i lliurada clau en mà",
      eu: "zure izenean egindako webgune azkarra, argitaratua eta giltza eskuan entregatua",
      en: "fast website in your name, published and delivered turnkey",
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
