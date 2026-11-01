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

for (const key of ["pending-msg", "verified-note", "open-project", "svc-web-annual"]) {
  const count = [...html.matchAll(new RegExp(`"${key}"\\s*:`, "g"))].length;
  if (count !== 4) {
    throw new Error(`La clave "${key}" aparece ${count} veces en index.html (esperado: 4 idiomas).`);
  }
}
console.log("index.html claves multilingües de Brandi y servicios (es / ca / eu / en): OK");

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

// 3. Auditoría de código defensivo estricto (ámbitos y firmas de helpers)
const saveMatches = [...workerSrc.matchAll(/saveProject\s*\(([^)]+)\)/g)];
if (saveMatches.length === 0) {
  throw new Error("No se detectaron llamadas a saveProject.");
}
saveMatches.forEach((m) => {
  const args = m[1].split(",").map((s) => s.trim());
  if (args.length < 3) {
    throw new Error(`Firma incorrecta en saveProject (< 3 argumentos): ${m[0]}`);
  }
  if (args[1].includes("project:")) {
    throw new Error(`saveProject no debe recibir el prefijo "project:" en el token: ${m[0]}`);
  }
});

const rawPuts = [...workerSrc.matchAll(/\.put\s*\(\s*[`"']project:/g)];
if (rawPuts.length > 1) {
  throw new Error("Detectada escritura directa a LEADS_KV con prefijo project: fuera de saveProject.");
}

const fnBlocks = [...workerSrc.matchAll(/async\s+function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)\s*\{([\s\S]*?)(?=\nasync\s+function|\nfunction|\nconst\s+[A-Za-z0-9_$]+\s*=|\nexport\s+default|$)/g)];
fnBlocks.forEach((fn) => {
  const name = fn[1];
  const params = fn[2].split(",").map((s) => s.trim());
  const body = fn[3];

  if (body.includes("checkProjectChatRateLimit(") || body.includes("checkRateLimit(")) {
    const usesIp = /\bip\b/.test(body);
    const hasParamIp = params.includes("ip");
    const declaresIp = /\b(?:const|let|var)\s+ip\b/.test(body);
    if (usesIp && !hasParamIp && !declaresIp) {
      throw new Error(`Ámbito roto: la función ${name} utiliza 'ip' sin declararla ni recibirla por parámetro.`);
    }
  }
});
console.log("worker.js auditoría defensiva de ámbitos y firmas (saveProject, ip, KV): OK");
