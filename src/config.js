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

// Precios oficiales que Brandi puede mencionar: 100 (paleta suelta, cuota anual o ronda extra), 400 (logo o web), 500 (paleta y web) y 800 (pack completo)
const ALLOWED_EUR = new Set([100, 400, 500, 800]);

const CATALOG = [
  `   - ${SERVICES.logo.names.es}: 400 € — ${SERVICES.logo.includes.es}.`,
  `   - ${SERVICES.paleta.names.es}: 100 € (o 0 € incluida de regalo al contratar el logotipo) — ${SERVICES.paleta.includes.es}.`,
  `   - ${SERVICES.web.names.es}: 400 € — ${SERVICES.web.includes.es}.`,
].join("\n");
