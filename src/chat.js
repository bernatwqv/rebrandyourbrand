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
    const rawAllMessages = Array.isArray(body.messages)
      ? body.messages.filter((m) => m && typeof m.text === "string")
      : [];
    const fullEmail = findEmail(rawAllMessages);
    const fullDomain = findDomain(rawAllMessages);

    const chatMessages = await normalizeMessages(key, body.messages);
    if (!chatMessages.length || chatMessages.at(-1).role !== "user") {
      throw new HttpError(400, "invalid_messages");
    }

    const plan0 = normalizeServices(body.services);

    if (!(await verifySession(key, body.session, ip))) throw new HttpError(403, "session_invalid");

    const email = findEmail(chatMessages) || fullEmail;
    const brand0 = cleanBrand(body.brand);
    const domain0 = cleanInput(body.domain, 200) || findDomain(chatMessages) || fullDomain;
    const confirmSigIn = typeof body.confirmSig === "string" ? body.confirmSig : "";
    const isShown = async (p, b, d) =>
      !!(email && b && p && (!p.ids.includes("web") || d)) &&
      (await verifyRaw(key, confirmPayload(email, b, p, d), confirmSigIn));

    const confirmAndSend = async (plan, brand, domain) => {
      if (!env.RESEND_API_KEY) throw new HttpError(500, "misconfigured");
      if (!plan) throw new HttpError(400, "plan_required");
      if (!brand) throw new HttpError(400, "brand_required");
      if (!(await isShown(plan, brand, domain))) throw new HttpError(400, "invalid_confirmation");

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
        domain,
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
          domain: domain || undefined,
          services: planOut(plan),
          resume: `${verifyToken}.${await resumeSig(key, verifyToken)}`,
          emailHint: maskEmail(email),
        },
        200,
        o
      );
    };

    if (body.confirm === true) {
      return await confirmAndSend(plan0, brand0, domain0);
    }

    const lastText = chatMessages.at(-1)?.text || "";
    const userDenied = DENY_RE.test(lastText);
    const userAgreed =
      lastText.length <= 60 && AGREE_RE.test(lastText) && !userDenied && !CHANGE_INTENT_RE.test(lastText);

    const summaryResponse = async (plan, brand, domain) => {
      const reply = buildSummary(lang, { brand, email, plan, domain });
      const confirmSig = await signRaw(key, confirmPayload(email, brand, plan, domain));
      return jsonResponse(
        {
          reply,
          sig: await signMsg(key, reply),
          leadClosed: false,
          canConfirm: true,
          confirmSig,
          brand,
          domain: domain || undefined,
          services: planOut(plan),
        },
        200,
        o
      );
    };

    const wasShown = await isShown(plan0, brand0, domain0);

    // Si el resumen ya estaba en pantalla y el cliente escribe "sí"/"vale"/"ok"/"bai", confirmamos sin bucle
    if (wasShown && userAgreed) {
      return await confirmAndSend(plan0, brand0, domain0);
    }

    // Si el cliente acaba de dar el último dato que faltaba sin pedir cambios, devolvemos el resumen al instante sin llamar a Groq
    const missing0 = missingOf(brand0, email, plan0, domain0);
    const textWithoutEmail = lastText.replace(EMAIL_FIND, "").trim();
    if (
      !missing0.length &&
      !wasShown &&
      !userDenied &&
      !CHANGE_INTENT_RE.test(textWithoutEmail) &&
      !SERVICE_MENTION_RE.test(textWithoutEmail)
    ) {
      return await summaryResponse(plan0, brand0, domain0);
    }

    const out = await askGroq(
      env,
      lang,
      { plan: plan0, brand: brand0, email, domain: domain0, denied: wasShown && userDenied },
      chatMessages
    );

    const plan = mergeServices(plan0, out);
    const brand = cleanBrand(out.brand) || brand0;
    const domain = cleanInput(out.domain, 200) || domain0 || findDomain(chatMessages);
    const missing = missingOf(brand, email, plan, domain);

    if (!missing.length) {
      const shownNow = await isShown(plan, brand, domain);
      if (!shownNow) return await summaryResponse(plan, brand, domain);
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
        domain: domain || undefined,
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
