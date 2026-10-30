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
