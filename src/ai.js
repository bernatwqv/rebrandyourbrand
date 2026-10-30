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
El precio total es la suma de los servicios elegidos. No hay descuentos ni paquetes.

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
