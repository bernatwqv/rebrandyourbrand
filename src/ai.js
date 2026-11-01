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
    ? `SERVICIOS ELEGIDOS: ${svcLabel(plan.ids, lang)} (${plan.total} € en total).`
    : `SERVICIOS: sin elegir todavía. El cliente no ha usado el selector de la web, así que quizá no conoce todas las opciones.`;
  const domainBlock = plan?.ids?.includes("web")
    ? (domain ? `DOMINIO WEB: ya conocido (${domain}).` : `DOMINIO WEB: estrictamente OBLIGATORIO al contratar la web. Aún falta.`)
    : "";
  const missing = missingOf(brand, email, plan, domain);
  const deniedBlock = denied
    ? `\nEl cliente acaba de RECHAZAR el resumen. Pregúntale con amabilidad qué quiere cambiar (marca, servicios, dominio o correo). No repitas el resumen.`
    : "";

  return `LANGUAGE RULE (absolute priority): the value of the "reply" field MUST be written entirely in ${langName}. These instructions are in Spanish for internal use only: never copy their language. Answer in Spanish only if ${langName} is español, even if the client mixes languages.

Eres Brandi, Directora de Arte e Inteligencia Creativa en rebrandyourbrand. Idioma obligatorio de respuesta: ${langName}.

Tu objetivo es entender la marca del cliente, dar una breve pincelada estratégica y reunir los datos necesarios para cerrar la propuesta: MARCA, SERVICIOS${plan?.ids?.includes("web") ? ", DOMINIO" : ""} y CORREO.

ESTILO:
- No actúes como un bot de atención al cliente. Eres una consultora de marca directa, aguda y conceptual.
- Respuestas directas, concisas (máximo 3 frases), en minúsculas relajadas si encaja con el tono editorial (escribe todo en minúsculas, sin mayúsculas iniciales, como el resto de la web), sin tecnicismos innecesarios.
- NUNCA escribas los ids internos de servicio (logo, paleta, web) tal cual: usa siempre los nombres del catalogo en el idioma del cliente (${langName}).
- Habla y escribe SIEMPRE en minúsculas (sin mayúsculas iniciales ni en nombres propios, excepto siglas técnicas indispensables como DNS o SSL), exactamente en sintonía con la estética y voz de marca del estudio.
- Haz UNA sola pregunta por mensaje.
- No uses puntos medios ni el símbolo ampersand en tus textos; usa conjunciones o guiones largos.

No hay planes cerrados: el cliente elige solo los servicios que necesita y paga únicamente por ellos (pago único del 100% mediante enlace seguro tras verificar el correo, sin cuotas mensuales). Servicios y precios oficiales:
${catalogFor(lang)}
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
  "reply": "your reply to the client, written in ${langName}",
  "brand": "nombre de la marca del cliente, o null si aún no lo sabes",
  "domain": "dominio indicado por el cliente (ej. mitienda.es), o null",
  "services": ["logo", "paleta", "web"] (solo los elegidos) | null
}
- "services": lista de ids elegidos por el cliente (valores posibles: "logo", "paleta", "web")${plan ? ` (ahora mismo: ${JSON.stringify(plan.ids)}; devuélvelo tal cual salvo que el cliente pida cambiarlo explícitamente)` : "; null mientras no los haya elegido claramente"}.
- "brand": devuelve la marca ya conocida salvo que el cliente la cambie.
- "domain": devuelve el dominio web indicado si el proyecto incluye web.

REMINDER: the "reply" field must be in ${langName}.`;
}

// Llamada unica a Groq (modelo de razonamiento): presupuesto de tokens holgado y un reintento si se corta por longitud
async function groqComplete(env, body, timeoutMs) {
  const call = (maxTokens) =>
    fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: JSON.stringify({
        ...body,
        model: GROQ_MODEL,
        max_completion_tokens: maxTokens,
        reasoning_effort: "low",
        include_reasoning: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  let res = await call(1500);
  if (!res.ok) return { res, data: null };
  let data = await res.json().catch(() => null);
  if (data?.choices?.[0]?.finish_reason === "length") {
    res = await call(2500);
    data = res.ok ? await res.json().catch(() => null) : null;
  }
  return { res, data };
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
      const { res: groq, data } = await groqComplete(
        env,
        {
          messages: [
            { role: "system", content: buildSystemInstruction(lang, ctx) },
            ...chatMessages.map((m) => ({ role: m.role, content: m.text })),
          ],
          temperature: 0.4,
          response_format: { type: "json_object" },
        },
        8000
      );

      if (groq.status === 429 || groq.status >= 500) {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        throw new HttpError(503, "upstream_busy", { "Retry-After": "10" });
      }
      if (!groq.ok) throw new HttpError(502, "upstream_error");

      const out = parseModelJson(data?.choices?.[0]?.message?.content);
      if (out && typeof out.reply === "string") {
        out.reply = out.reply
          .replace(/[\u00b7\u2022]/g, " — ")
          .replace(/\b(logo|paleta|web)\b/gi, (w) => (lang === "es" ? w : (SERVICES[w.toLowerCase()]?.names?.[lang] || w)))
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

  return `LANGUAGE RULE (absolute priority): answer ONLY in ${langName}, even though these instructions are in Spanish.

Eres Brandi, Directora Creativa e Inteligencia Artística de rebrandyourbrand.
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
- Si el cliente solicita cambios complejos, negociaciones, aprobaciones directas de fase o pide expresamente hablar con personas, indícale amablemente que use la pestaña del equipo humano o pulse el botón de "hablar con el equipo humano" para contactar directamente con Gael y Bernat.

REMINDER: write your answer in ${langName}.`;
}

async function askGroqProject(env, lang, proj, chatMessages, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { res: groq, data } = await groqComplete(
        env,
        {
          messages: [
            { role: "system", content: buildProjectSystemInstruction(lang, proj) },
            ...chatMessages.map((m) => ({ role: m.role, content: m.text })),
          ],
          temperature: 0.4,
        },
        8000
      );

      if (!groq.ok) throw new Error(`Groq HTTP ${groq.status}`);
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error("empty_reply");

      const clean = text
        .replace(/[\u00b7\u2022]/g, " — ")
        .replace(new RegExp("\\x26", "g"), lang === "ca" ? " i " : lang === "en" ? " and " : lang === "eu" ? " eta " : " y ")
        .replace(/(^|[.!?¿¡]\s*|\n\s*)([A-ZÁÉÍÓÚÀÈÒÇÑ])(?![A-ZÁÉÍÓÚÀÈÒÇÑ])/g, (_, p, c) => p + c.toLowerCase());
      if (hasUnknownPrice(clean) || hasUnknownPercent(clean)) throw new Error("unknown_price");
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
    const { res, data } = await groqComplete(
      env,
      {
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
        temperature: 0.1,
        response_format: { type: "json_object" },
      },
      7000
    );

    if (!res.ok) {
      console.warn(`Groq translate HTTP ${res.status}`);
      return raw;
    }

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

