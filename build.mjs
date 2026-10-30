import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

const MODULES = [
  ["config.js", "Configuración: constantes, límites, catálogo de servicios y expresiones comunes."],
  ["utils.js", "Utilidades comunes: idioma, fechas, formato de texto y limpieza de entradas."],
  ["http.js", "Cabeceras HTTP, CSP de páginas y constructores de respuestas."],
  ["i18n.js", "Diccionarios multilingües (es / ca / eu / en) para Brandi, correos y páginas."],
  ["security.js", "Criptografía HMAC, tokens deterministas, sesión de chat y Turnstile."],
  ["email.js", "Diseño editorial de correos, envío por Resend y alertas internas."],
  ["leads.js", "Doble opt-in de correo y entrega de leads verificados."],
  ["ai.js", "Brandi (Groq): prompt, llamada al modelo, validación de respuestas y servicios elegidos."],
  ["payments.js", "Pagos (Stripe B2B): fases del proyecto, checkout, rescate, webhook y confirmación."],
  ["pages.js", "Identidad visual y plantillas HTML editoriales de api.rebrandyourbrand.es."],
  ["handlers.js", "Manejadores de rutas: verificar, seguimiento, onboarding, fases, bajas y reseñas."],
  ["chat.js", "Chat con Brandi: sesión de Turnstile, resumen instantáneo, confirmación y estado."],
  ["cron.js", "Tareas programadas (Cron Trigger): recordatorios de revisión y renovaciones anuales."],
  ["index.js", "Punto de entrada del Worker: enrutado de peticiones HTTP y eventos programados."],
];

const HEADER = `/**
 * rebrandyourbrand — Worker (archivo único GENERADO por build.mjs; no lo edites a mano: edita src/*.js y vuelve a ejecutar "node build.mjs").
 * Groq (Brandi), doble opt-in (con reenvío), Stripe B2B (pago único y rescate), seguimiento con onboarding, EmailOps de fases, valoraciones verificadas y Cron Trigger.
 */`;

const chunks = [HEADER];

for (const [file, desc] of MODULES) {
  const fullPath = join(root, "src", file);
  const content = readFileSync(fullPath, "utf8").replace(/\r\n/g, "\n").trim();
  chunks.push(`// ══ ${file} — ${desc} ══\n\n${content}`);
}

const output = `${chunks.join("\n\n")}\n`;

if (/[\u00b7\u2022]/.test(output)) {
  throw new Error("Build abortado: se detectó un punto medio (· o •) prohibido por las reglas de estilo.");
}

writeFileSync(join(root, "worker.js"), output, "utf8");
console.log(`worker.js generado (${Buffer.byteLength(output, "utf8")} bytes).`);
