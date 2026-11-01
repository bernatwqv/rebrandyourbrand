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
  const initialMaterials = cleanDomain
    ? [
        {
          id: "init",
          createdAt: nowIso,
          domain: cleanDomain,
          socials: "",
          url: "",
          fileUrl: "",
          filename: "",
          notes: "",
        },
      ]
    : [];

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
    materialsList: initialMaterials,
    referencesList: [],
    ...(cleanDomain ? { onboarding: { domain: cleanDomain, socials: "", materials: "", submittedAt: nowIso } } : {}),
  };
  await env.LEADS_KV.put(projectKey, JSON.stringify(projectData), {
    expirationTtl: PENDING_PROJECT_TTL_SECONDS,
    metadata: { status: "active" },
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
    await env.LEADS_KV.put(`project:${proj.token}`, JSON.stringify(proj), {
      expirationTtl: PENDING_PROJECT_TTL_SECONDS,
      metadata: { status: proj.status || "active" },
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

async function createExtraRevisionCheckout(env, proj, step, returnUrl, cancelUrl) {
  if (!env.STRIPE_SECRET_KEY || !proj) return "";
  const l = pickLang(proj.lang);
  const safeBrand = proj.brand || "proyecto";
  const ph = (proj.phases || []).find((p) => Number(p.step) === Number(step)) || { step };
  const phaseName = phaseTitle(ph, l) || `fase ${step}`;

  const titleByLang = {
    es: `Ronda de ajustes adicional — ${phaseName}`,
    ca: `Ronda d'ajustos addicional — ${phaseName}`,
    eu: `Doikuntza-txanda gehigarria — ${phaseName}`,
    en: `Additional revision round — ${phaseName}`,
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
  const ph = (proj.phases || []).find((p) => Number(p.step) === Number(step));
  if (!ph) return false;

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
  if (ph.status !== "done") {
    ph.status = "review";
  }

  await env.LEADS_KV.put(`project:${proj.token}`, JSON.stringify(proj), {
    metadata: { status: proj.status || "active" },
  });

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
    proj.renewalOverdueAlertSentAt = null;
    proj.renewalReminderSentAt = null;
    await env.LEADS_KV.put(key, JSON.stringify(proj), {
      metadata: { status: proj.status || "active" },
    });
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
    if (dirty) await env.LEADS_KV.put(key, JSON.stringify(proj), { metadata: { status: proj.status || "active" } });
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
    if (dirty) await env.LEADS_KV.put(key, JSON.stringify(proj), { metadata: { status: proj.status || "active" } });
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
