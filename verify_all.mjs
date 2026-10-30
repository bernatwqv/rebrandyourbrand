import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

// 1. Verificar scripts inline, JSON-LD y claves de Brandi en index.html
const html = readFileSync(join(root, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g)];
scripts.forEach((m, i) => {
  if (!m[1].trim()) return;
  new Function(m[1]);
  console.log(`index.html <script> #${i}: OK (${m[1].length} chars)`);
});

const ld = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
ld.forEach((m, i) => {
  JSON.parse(m[1]);
  console.log(`index.html JSON-LD #${i}: OK`);
});

for (const key of ["pending-msg", "verified-note", "open-project"]) {
  const count = [...html.matchAll(new RegExp(`"${key}"\\s*:`, "g"))].length;
  if (count !== 4) {
    throw new Error(`La clave "${key}" aparece ${count} veces en index.html (esperado: 4 idiomas).`);
  }
}
console.log("index.html claves multilingües de Brandi (es / ca / eu / en): OK");

// 2. Auditar reglas inquebrantables de estilo y módulo ESM en worker.js
const workerPath = join(root, "worker.js");
const workerSrc = readFileSync(workerPath, "utf8");

if (/[\u00b7\u2022]/.test(workerSrc)) {
  throw new Error("Carácter prohibido detectado en worker.js (punto medio o viñeta).");
}

const rem = workerSrc.replace(/&&/g, "").replace(/m & \(1 << i\)/g, "");
if (rem.includes("&")) {
  throw new Error(`Ampersand no permitido en worker.js (posición ${rem.indexOf("&")}).`);
}
console.log("worker.js auditoría de estilo (0 puntos medios, 0 viñetas, 0 ampersands): OK");

const mod = await import(pathToFileURL(workerPath).href);
if (typeof mod.default?.fetch !== "function" || typeof mod.default?.scheduled !== "function") {
  throw new Error("worker.js no exporta los manejadores fetch() y scheduled().");
}
console.log("worker.js importación ESM (fetch + scheduled): OK");
