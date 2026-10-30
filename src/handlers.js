async function handleVerify(request, env, ctx, url) {
  let L = langFromRequest(request);
  const token = url.searchParams.get("token");
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return msgPage(L, "invalid", 400);

  if (request.method === "GET" || request.method === "HEAD") {
    try {
      const rawGet = env.LEADS_KV ? await env.LEADS_KV.get(`pending:${token}`) : null;
      if (rawGet) L = pickLang(JSON.parse(rawGet).lang);
    } catch {}
    return msgPage(L, "verify", 200, { eyebrow: PG[L].verify[0], form: true });
  }

  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
  }
  if (!env.LEADS_KV || !env.RESEND_API_KEY) return msgPage(L, "config", 500);

  const key = `pending:${token}`;
  const raw = await env.LEADS_KV.get(key);
  if (!raw) return msgPage(L, "expired", 400);

  const data = JSON.parse(raw);
  L = pickLang(data.lang);

  const plan = normalizeServices(data.services);
  if (!plan) {
    await alertAdmin(
      env,
      "verificación sin servicios válidos",
      `cliente: ${data.clientEmail}\nmarca: ${data.brand}\nservicios: ${JSON.stringify(data.services)}`,
      ctx
    );
    return paymentRetryPage(L);
  }

  let proj = null;
  if (typeof data.projectToken === "string" && /^[a-f0-9]{64}$/.test(data.projectToken)) {
    const rawProj = await env.LEADS_KV.get(`project:${data.projectToken}`);
    if (rawProj) proj = JSON.parse(rawProj);
  }
  if (!proj) {
    proj = await createProjectRecord(env, {
      clientEmail: data.clientEmail,
      brand: data.brand,
      plan,
      lang: L,
      messages: data.messages,
    });
    data.projectToken = proj.token;
  }

  const projectPageUrl = buildUrl("/proyecto", { token: proj.token });

  if (proj.paid) {
    return redirectTo(projectPageUrl);
  }

  if (!env.STRIPE_SECRET_KEY) {
    await alertAdmin(
      env,
      "la clave stripe_secret_key no está configurada",
      `cliente verificado sin poder generar el pago: ${data.clientEmail} (${data.brand}).`,
      ctx
    );
  }

  const leadPromise = data.leadDelivered
    ? Promise.resolve(true)
    : deliverVerifiedLead(env, ctx, { ...data, plan, projectToken: proj.token }).then(
        () => true,
        (e) => {
          console.error("deliver lead failed:", e?.message);
          return false;
        }
      );

  const checkoutPromise = env.STRIPE_SECRET_KEY
    ? ensureStripeCheckout(env, proj).catch((e) => {
        console.error("checkout failed:", e?.message);
        return null;
      })
    : Promise.resolve(null);

  const [delivered, checkout] = await Promise.all([leadPromise, checkoutPromise]);

  data.leadDelivered = delivered;
  if (checkout?.url && isStripeUrl(checkout.url)) data.checkoutUrl = checkout.url;
  await env.LEADS_KV.put(key, JSON.stringify(data), {
    expirationTtl: PENDING_VERIFY_TTL_SECONDS,
  });

  if (checkout?.paid) return redirectTo(projectPageUrl);
  if (checkout?.url) return redirectTo(checkout.url);
  return msgPage(L, "retry", 502, {
    form: true,
    footerUrl: projectPageUrl,
    footerLabel: PG[L].common.openTracker,
  });
}

async function completeProjectPhase(
  env,
  proj,
  projectToken,
  { approvedBy = "studio", deliverableUrl = "", note = "", legacyActionToken = "" } = {}
) {
  const idx = proj.phases.findIndex(
    (ph) => ph.step === Number(proj.currentPhase) && (ph.status === "active" || ph.status === "review")
  );
  const targetIdx =
    idx >= 0 ? idx : proj.phases.findIndex((ph) => ph.status === "active" || ph.status === "review");
  if (targetIdx < 0) return { ok: false, reason: "already_finished" };

  const now = new Date().toISOString();
  const advancedPhase = proj.phases[targetIdx];
  advancedPhase.status = "done";
  advancedPhase.date = now;
  advancedPhase.approvedBy = approvedBy;
  if (approvedBy === "client") advancedPhase.approvedAt = now;
  if (deliverableUrl) advancedPhase.deliverableUrl = deliverableUrl;
  if (note) advancedPhase.note = note;

  let nextPhase = null;
  let nextStep = 0;
  let finished = false;

  if (targetIdx + 1 < proj.phases.length) {
    nextPhase = proj.phases[targetIdx + 1];
    nextPhase.status = "active";
    nextPhase.date = now;
    nextStep = nextPhase.step;
    proj.currentPhase = nextStep;
  } else {
    finished = true;
    proj.finishedAt = now;
    proj.currentPhase = advancedPhase.step + 1;
    if (Array.isArray(proj.services) && proj.services.includes("web") && !proj.nextRenewalAt) {
      proj.nextRenewalAt = addOneYearIso(now);
    }
  }

  const lang = pickLang(proj.lang);
  const advancedTitleEs = phaseTitle(advancedPhase, "es");
  const nextTitleEs = nextPhase ? phaseTitle(nextPhase, "es") : "";
  const nextActionUrl = !finished ? await advancePhaseUrl(env, projectToken, nextStep) : "";
  const trackingUrl = buildUrl("/proyecto", { token: projectToken });
  const t = EM[lang].phase;

  const adminSubject =
    approvedBy === "client"
      ? `fase aprobada por el cliente: "${advancedTitleEs}" — ${proj.brand}`
      : `fase completada: "${advancedTitleEs}" — ${proj.brand}`;

  const adminParas =
    approvedBy === "client"
      ? [
          "el cliente ha dejado aprobada por escrito la fase actual.",
          lines(
            `— proyecto: ${bold(proj.brand)}`,
            `— cliente: ${bold(proj.clientEmail)}`,
            `— fase aprobada: ${bold(advancedTitleEs)}`,
            `— registro de aprobación (iso): ${bold(now)}`,
            finished
              ? `— estado: ${bold("proyecto finalizado")}`
              : `— nueva fase activa: ${bold(`paso ${nextStep} — ${nextTitleEs}`)}`
          ),
        ]
      : [
          "hola,",
          `la fase ${bold(advancedTitleEs)} del proyecto ${bold(proj.brand)} se ha completado con éxito.`,
          finished
            ? "el proyecto ha completado todas sus fases y ha finalizado."
            : `la nueva fase activa es: ${bold(`paso ${nextStep} — ${nextTitleEs}`)}.`,
        ];

  try {
    await Promise.all([
      resendSend(
        env,
        {
          to: ["hola@rebrandyourbrand.es"],
          reply_to: proj.clientEmail,
          subject: adminSubject,
          ...renderEmail("es", {
            paras: adminParas,
            cta: nextActionUrl
              ? { label: `gestionar siguiente fase (${nextTitleEs})`, url: nextActionUrl }
              : { label: "ver ficha del proyecto", url: trackingUrl },
          }),
        },
        `phase-admin-${projectToken}-${advancedPhase.step}`
      ),
      resendSend(
        env,
        {
          to: [proj.clientEmail],
          subject: t.subject(proj.brand),
          ...renderEmail(lang, {
            paras: [
              t.hello,
              t.intro(bold(proj.brand)),
              lines(
                `— ${t.done}: ${bold(phaseTitle(advancedPhase, lang))}`,
                finished ? `— ${bold(t.finished)}` : `— ${t.next}: ${bold(phaseTitle(nextPhase, lang))}`
              ),
            ],
            quote: advancedPhase.note || "",
            cta: { label: t.cta, url: trackingUrl },
            secondaryLink: advancedPhase.deliverableUrl
              ? { label: t.deliverable, url: advancedPhase.deliverableUrl }
              : null,
            note: t.note,
          }),
        },
        `phase-client-${projectToken}-${advancedPhase.step}`
      ),
    ]);

    await env.LEADS_KV.put(`project:${projectToken}`, JSON.stringify(proj));
    if (legacyActionToken) {
      await env.LEADS_KV.delete(`phase_action:${legacyActionToken}`).catch(() => {});
    }
  } catch (e) {
    console.error("phase advance email failed:", e?.message);
    const retryAdvanceUrl = await advancePhaseUrl(env, projectToken, advancedPhase.step);
    await alertAdmin(
      env,
      "fallo al enviar correos de avance de fase",
      `proyecto: ${proj.brand}\nerror: ${e?.message}\nenlace de gestión: ${retryAdvanceUrl}`
    );
    return { ok: false, reason: "email_failed" };
  }

  if (finished && !proj.reviewInvited) {
    try {
      await sendReviewInvite(env, proj, projectToken);
      proj.reviewInvited = true;
      await env.LEADS_KV.put(`project:${projectToken}`, JSON.stringify(proj));
    } catch (e) {
      console.error("review invite failed:", e?.message);
      await alertAdmin(
        env,
        "fallo al enviar la invitación a valorar",
        `proyecto: ${proj.brand}\ncliente: ${proj.clientEmail}\nenlace de valoración (envíaselo a mano): ${await reviewUrl(env, projectToken)}`
      );
    }
  }

  return {
    ok: true,
    finished,
    advancedTitleEs,
    nextTitleEs,
    nextActionUrl,
  };
}

// ── GESTIÓN INTERNA DE FASES Y ENTREGABLES (/advance-phase) ──
async function handlePhaseAdvance(request, env, url) {
  if (!env.LEADS_KV || !env.RESEND_API_KEY) {
    return htmlResponse(page("error", "error de configuración", "falta configuración en el servidor."), 500);
  }

  let projectToken = "";
  let step = 0;
  let legacyActionToken = "";

  const pParam = url.searchParams.get("p");
  const stepParam = parseInt(url.searchParams.get("step") || "", 10);
  const tParam = url.searchParams.get("t");
  const legacyToken = url.searchParams.get("token");

  if (pParam || tParam) {
    if (
      !pParam ||
      !/^[a-f0-9]{64}$/.test(pParam) ||
      !Number.isInteger(stepParam) ||
      stepParam < 1 ||
      stepParam > 20 ||
      !tParam ||
      !/^[a-f0-9]{64}$/.test(tParam)
    ) {
      return htmlResponse(page("enlace inválido", "enlace inválido", "el enlace de gestión no es válido."), 400);
    }
    const key = await getKey(env);
    if (!(await verifyRaw(key, `action|${pParam}|${stepParam}`, tParam))) {
      return htmlResponse(page("enlace inválido", "enlace inválido", "la firma del enlace no es válida."), 400);
    }
    projectToken = pParam;
    step = stepParam;
  } else if (legacyToken && /^[a-f0-9]{64}$/.test(legacyToken)) {
    const rawAction = await env.LEADS_KV.get(`phase_action:${legacyToken}`);
    if (!rawAction) {
      return htmlResponse(page("enlace caducado", "acción ya procesada", "este enlace antiguo ya fue utilizado o caducó."), 400);
    }
    const actionData = JSON.parse(rawAction);
    projectToken = actionData.projectToken;
    step = Number(actionData.step);
    legacyActionToken = legacyToken;
  } else {
    return htmlResponse(page("enlace inválido", "enlace inválido", "faltan parámetros en el enlace."), 400);
  }

  const rawProj = await env.LEADS_KV.get(`project:${projectToken}`);
  if (!rawProj) {
    return htmlResponse(page("no encontrado", "proyecto no encontrado", "no hemos encontrado este proyecto en kv."), 404);
  }
  const proj = JSON.parse(rawProj);
  const trackingUrl = buildUrl("/proyecto", { token: projectToken });

  if (!proj.paid) {
    return htmlResponse(
      page("pago pendiente", "proyecto aún sin pagar", `el proyecto ${proj.brand} todavía no figura como pagado.`, {
        eyebrow: "gestión interna",
        footerUrl: trackingUrl,
        footerLabel: "ver página del cliente",
      }),
      400
    );
  }

  const allDone = Array.isArray(proj.phases) && proj.phases.every((ph) => ph.status === "done");
  if (allDone) {
    return htmlResponse(
      page("proyecto finalizado", "proyecto ya finalizado", `todas las fases de ${proj.brand} ya figuran como completadas.`, {
        eyebrow: "gestión interna",
        footerUrl: trackingUrl,
        footerLabel: "ver seguimiento del proyecto",
      }),
      200
    );
  }

  if (Number(proj.currentPhase) !== step) {
    const activeAdvanceUrl = await advancePhaseUrl(env, projectToken, proj.currentPhase);
    return htmlResponse(
      page(
        "fase ya gestionada",
        "esta fase ya avanzó",
        `este enlace correspondía al paso ${step}, pero ${proj.brand} se encuentra ahora en el paso ${proj.currentPhase}.`,
        {
          eyebrow: "gestión interna",
          html: `<a class="btn" href="${esc(activeAdvanceUrl)}">ir al paso actual (${Number(proj.currentPhase)})</a>`,
          footerUrl: trackingUrl,
          footerLabel: "ver página del cliente",
        }
      ),
      200
    );
  }

  const currentPhaseObj =
    proj.phases.find((ph) => ph.step === step) ||
    proj.phases.find((ph) => ph.status === "active" || ph.status === "review");
  if (!currentPhaseObj) {
    return htmlResponse(page("finalizado", "proyecto finalizado", "este proyecto no tiene fases pendientes."), 400);
  }

  const currentTitleEs = phaseTitle(currentPhaseObj, "es");
  const stateLabel =
    currentPhaseObj.status === "review"
      ? `en revisión del cliente (enviada el ${fmtDate(currentPhaseObj.reviewSentAt || currentPhaseObj.date, "es")})`
      : "en curso en el estudio";

  if (request.method === "GET" || request.method === "HEAD") {
    const ob = proj.onboarding;
    const obHtml = ob
      ? `<div class="box">
          <span class="eyebrow">materiales del cliente</span>
          <div class="kv">
            ${ob.socials ? `<div class="kv-row"><span>web / redes</span><span class="kv-val">${esc(ob.socials)}</span></div>` : ""}
            ${ob.domain ? `<div class="kv-row"><span>dominio</span><span class="kv-val">${esc(ob.domain)}</span></div>` : ""}
            ${ob.materials ? `<div class="kv-row"><span>carpeta / notas</span><span class="kv-val">${esc(ob.materials)}</span></div>` : ""}
          </div>
        </div>`
      : "";

    const html = `
      <div class="box">
        <div class="kv">
          <div class="kv-row"><span>proyecto</span><span class="kv-val">${esc(proj.brand)}</span></div>
          <div class="kv-row"><span>cliente</span><span class="kv-val">${esc(proj.clientEmail)}</span></div>
          <div class="kv-row"><span>idioma</span><span class="kv-val">${esc(proj.lang)}</span></div>
          <div class="kv-row"><span>servicios</span><span class="kv-val">${esc(svcLabel(proj.services, "es"))}</span></div>
          <div class="kv-row"><span>fase actual</span><span class="kv-val">paso ${currentPhaseObj.step} — ${esc(currentTitleEs)}</span></div>
          <div class="kv-row"><span>estado</span><span class="kv-val">${esc(stateLabel)}</span></div>
        </div>
      </div>
      ${obHtml}
      <form method="POST" style="text-align:left;">
        <label for="deliverableUrl">enlace al entregable o preview (opcional, https://)</label>
        <input id="deliverableUrl" name="deliverableUrl" type="url" maxlength="500" placeholder="https://www.figma.com/... o https://drive.google.com/..." value="${esc(currentPhaseObj.deliverableUrl || "")}">
        <label for="note">nota para el cliente (opcional)</label>
        <textarea id="note" name="note" rows="4" maxlength="600" placeholder="contexto breve sobre la entrega, qué revisar o pasos siguientes...">${esc(currentPhaseObj.note || "")}</textarea>
        <button type="submit" name="decision" value="review">enviar propuesta a revisión del cliente</button>
        <button type="submit" name="decision" value="complete" class="secondary">marcar fase como completada y avanzar directamente</button>
      </form>
    `;

    return htmlResponse(
      page(
        `gestionar fase — ${proj.brand}`,
        "gestionar fase del proyecto",
        "puedes enviar un entregable para que el cliente lo valide por escrito en un clic, o cerrar la fase directamente si ya está aprobada.",
        {
          eyebrow: "panel interno del estudio",
          wide: true,
          html,
          footerUrl: trackingUrl,
          footerLabel: "ver página pública del cliente",
        }
      ),
      200
    );
  }

  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
  }

  const form = await request.formData().catch(() => null);
  const rawUrl = String(form?.get("deliverableUrl") ?? "").trim();
  const deliverableUrl = cleanHttpsUrl(rawUrl, 500);
  if (rawUrl && !deliverableUrl) {
    return htmlResponse(
      page(
        "enlace inválido",
        "revisa el enlace del entregable",
        "el enlace al entregable debe usar https:// (por ejemplo https://drive.google.com/...). vuelve atrás y corrígelo o déjalo vacío.",
        {
          eyebrow: "panel interno del estudio",
          footerUrl: await advancePhaseUrl(env, projectToken, step),
          footerLabel: "volver a la fase",
        }
      ),
      400
    );
  }

  const note = cleanNote(form?.get("note") ?? "", 600);
  const decision = String(form?.get("decision") ?? "complete");
  const currentManageUrl = await advancePhaseUrl(env, projectToken, step);

  if (decision === "review") {
    const now = new Date().toISOString();
    currentPhaseObj.status = "review";
    currentPhaseObj.reviewSentAt = now;
    currentPhaseObj.deliverableUrl = deliverableUrl;
    currentPhaseObj.note = note;
    delete currentPhaseObj.reminderSentAt;
    delete currentPhaseObj.tacitAlertSentAt;

    const lang = pickLang(proj.lang);
    const tp = EM[lang].proposal;
    const phaseNameClient = phaseTitle(currentPhaseObj, lang);
    const clientApproveUrl = await approvePhaseUrl(env, projectToken, step);

    try {
      await resendSend(
        env,
        {
          to: [proj.clientEmail],
          reply_to: "hola@rebrandyourbrand.es",
          subject: tp.subject(proj.brand, phaseNameClient),
          ...renderEmail(lang, {
            paras: [
              tp.hello,
              tp.intro(bold(proj.brand), bold(phaseNameClient)),
              deliverableUrl
                ? `${tp.openDeliverable}: <a href="${esc(deliverableUrl)}" target="_blank" style="color:#3D5A85;font-weight:600;">${esc(deliverableUrl)}</a>`
                : "",
            ].filter(Boolean),
            quote: note,
            cta: { label: tp.cta, url: clientApproveUrl },
            secondaryLink: { label: EM[lang].phase.cta, url: trackingUrl },
            note: tp.revisions,
          }),
        },
        `proposal-${projectToken}-${step}-${Date.now()}`
      );

      await env.LEADS_KV.put(`project:${projectToken}`, JSON.stringify(proj));
    } catch (e) {
      console.error("proposal email failed:", e?.message);
      return htmlResponse(
        page(
          "error al enviar",
          "no se ha podido enviar el correo",
          "ha fallado el envío a través de resend, así que la fase no se ha modificado. inténtalo de nuevo en unos minutos.",
          {
            eyebrow: "panel interno del estudio",
            footerUrl: currentManageUrl,
            footerLabel: "volver a intentarlo",
          }
        ),
        500
      );
    }

    return htmlResponse(
      page(
        "propuesta enviada",
        "propuesta enviada a revisión",
        `hemos avisado a ${proj.clientEmail} con el botón de aprobación escrita para "${currentTitleEs}". en cuanto pulse aprobar, avanzará automáticamente a la siguiente fase.`,
        {
          eyebrow: "panel interno del estudio",
          html: `<a class="btn secondary" href="${esc(currentManageUrl)}">volver al panel de esta fase</a>`,
          footerUrl: trackingUrl,
          footerLabel: "ver página del cliente",
        }
      ),
      200
    );
  }

  const result = await completeProjectPhase(env, proj, projectToken, {
    approvedBy: "studio",
    deliverableUrl,
    note,
    legacyActionToken,
  });

  if (!result.ok) {
    if (result.reason === "email_failed") {
      return htmlResponse(
        page(
          "error al notificar",
          "no se ha podido enviar el correo",
          "no se ha podido enviar el correo de notificación, así que la fase sigue sin cambios en el sistema para que puedas reintentarlo sin perder el estado.",
          {
            eyebrow: "panel interno del estudio",
            html: `<a class="btn" href="${esc(currentManageUrl)}">reintentar ahora</a>`,
            footerUrl: trackingUrl,
            footerLabel: "ver página del cliente",
          }
        ),
        500
      );
    }
    return htmlResponse(page("finalizado", "proyecto ya finalizado", "no quedan fases activas."), 400);
  }

  const nextBtnHtml = result.nextActionUrl
    ? `<a class="btn" href="${esc(result.nextActionUrl)}">abrir panel de la siguiente fase (${esc(result.nextTitleEs)})</a>`
    : "";

  return htmlResponse(
    page(
      "fase completada",
      "fase avanzada con éxito",
      `has completado "${result.advancedTitleEs}" para ${proj.brand}.${result.finished ? " el proyecto ha finalizado y hemos invitado al cliente a valorarlo." : ` la nueva fase activa es "${result.nextTitleEs}" y se ha notificado al cliente.`}`,
      {
        eyebrow: "panel interno del estudio",
        html: nextBtnHtml,
        footerUrl: trackingUrl,
        footerLabel: "ver seguimiento del cliente",
      }
    ),
    200
  );
}

// ── APROBACIÓN ESCRITA DE FASE POR EL CLIENTE (/approve-phase) ──
async function handlePhaseApprove(request, env, url) {
  let L = langFromRequest(request);
  const p = url.searchParams.get("p");
  const step = parseInt(url.searchParams.get("step") || "", 10);
  const t = url.searchParams.get("t");

  if (
    !p ||
    !/^[a-f0-9]{64}$/.test(p) ||
    !Number.isInteger(step) ||
    step < 1 ||
    step > 20 ||
    !t ||
    !/^[a-f0-9]{64}$/.test(t)
  ) {
    return msgPage(L, "invalid", 400);
  }
  if (!env.LEADS_KV || !env.RESEND_API_KEY) return msgPage(L, "config", 500);

  const key = await getKey(env);
  if (!(await verifyRaw(key, `approve|${p}|${step}`, t))) return msgPage(L, "invalid", 400);

  const rawProj = await env.LEADS_KV.get(`project:${p}`);
  if (!rawProj) return msgPage(L, "trackMissing", 404);

  const proj = JSON.parse(rawProj);
  L = pickLang(proj.lang);
  const A = PG[L].ap;
  const T = PG[L].tr;
  const trackingUrl = buildUrl("/proyecto", { token: p });

  const ph = (proj.phases || []).find((x) => x.step === step);
  if (!ph || !proj.paid) return msgPage(L, "invalid", 400);

  if (ph.status === "done" || Number(proj.currentPhase) !== step) {
    return htmlResponse(
      page(A.already[0], A.already[1], A.already[2], {
        lang: L,
        eyebrow: A.eyebrow,
        html: `<a class="btn" href="${esc(trackingUrl)}">${esc(PG[L].common.openTracker)}</a>`,
        footerUrl: trackingUrl,
        footerLabel: PG[L].common.openTracker,
      }),
      200
    );
  }

  if (request.method === "GET" || request.method === "HEAD") {
    const detailHtml =
      ph.note || ph.deliverableUrl
        ? `<div class="box">
            ${ph.note ? `<p style="font-size:.84rem;color:#17171A;margin-bottom:${ph.deliverableUrl ? ".75rem" : "0"};white-space:pre-wrap;"><strong>${esc(T.studioNote)}:</strong> ${esc(ph.note)}</p>` : ""}
            ${ph.deliverableUrl ? `<a class="pill-link" href="${esc(ph.deliverableUrl)}" target="_blank" rel="noopener noreferrer">${esc(A.deliverable)}</a>` : ""}
          </div>`
        : "";

    const bodyHtml = `${detailHtml}<p class="lead" style="font-size:.82rem;margin-bottom:1.25rem;">${esc(A.legal)}</p>`;
    return htmlResponse(
      page(A.title, A.heading, A.intro(phaseTitle(ph, L), proj.brand), {
        lang: L,
        eyebrow: A.eyebrow,
        html: bodyHtml,
        form: true,
        formLabel: A.btn,
        footerUrl: trackingUrl,
        footerLabel: PG[L].common.openTracker,
      }),
      200
    );
  }

  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
  }

  const res = await completeProjectPhase(env, proj, p, {
    approvedBy: "client",
    deliverableUrl: ph.deliverableUrl || "",
    note: ph.note || "",
  });

  if (!res.ok && res.reason === "email_failed") return errorPage(L);

  return htmlResponse(
    page(A.done[0], A.done[1], A.done[2], {
      lang: L,
      eyebrow: A.eyebrow,
      html: `<a class="btn" href="${esc(trackingUrl)}">${esc(PG[L].common.openTracker)}</a>`,
      footerUrl: trackingUrl,
      footerLabel: PG[L].common.openTracker,
    }),
    200
  );
}

// ── BAJA EN UN CLIC DE LA RENOVACIÓN ANUAL (/cancel-renewal) ──
async function handleCancelRenewal(request, env, url) {
  let L = langFromRequest(request);
  const p = url.searchParams.get("p");
  const due = url.searchParams.get("due") || "";
  const t = url.searchParams.get("t");

  if (!p || !/^[a-f0-9]{64}$/.test(p) || !due || due.length > 40 || !t || !/^[a-f0-9]{64}$/.test(t)) {
    return msgPage(L, "invalid", 400);
  }
  if (!env.LEADS_KV) return msgPage(L, "config", 500);

  const key = await getKey(env);
  if (!(await verifyRaw(key, `crenew|${p}|${due}`, t))) return msgPage(L, "invalid", 400);

  const rawProj = await env.LEADS_KV.get(`project:${p}`);
  if (!rawProj) return msgPage(L, "trackMissing", 404);

  const proj = JSON.parse(rawProj);
  L = pickLang(proj.lang);
  const RN = PG[L].rn;
  const trackingUrl = buildUrl("/proyecto", { token: p });
  const dueFormatted = fmtDate(proj.nextRenewalAt || due, L);

  if (proj.renewalCanceled) {
    return htmlResponse(
      page(RN.already[0], RN.already[1], RN.already[2], {
        lang: L,
        eyebrow: RN.eyebrow,
        footerUrl: trackingUrl,
        footerLabel: PG[L].common.openTracker,
      }),
      200
    );
  }

  if (request.method === "GET" || request.method === "HEAD") {
    return htmlResponse(
      page(RN.title, RN.heading, RN.intro(proj.brand, dueFormatted), {
        lang: L,
        eyebrow: RN.eyebrow,
        form: true,
        formLabel: RN.btn,
        footerUrl: trackingUrl,
        footerLabel: PG[L].common.openTracker,
      }),
      200
    );
  }

  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
  }

  proj.renewalCanceled = true;
  proj.renewalCanceledAt = new Date().toISOString();
  await env.LEADS_KV.put(`project:${p}`, JSON.stringify(proj));
  await alertAdmin(
    env,
    `baja de renovación anual confirmada — ${proj.brand}`,
    `cliente: ${proj.clientEmail}\nmarca: ${proj.brand}\nvencimiento del periodo actual: ${fmtDate(proj.nextRenewalAt || due, "es")}`
  );

  return htmlResponse(
    page(RN.done[0], RN.done[1], RN.done[2], {
      lang: L,
      eyebrow: RN.eyebrow,
      html: `<a class="btn secondary" href="${esc(trackingUrl)}">${esc(PG[L].common.openTracker)}</a>`,
      footerUrl: trackingUrl,
      footerLabel: PG[L].common.openTracker,
    }),
    200
  );
}

// ── SEGUIMIENTO DEL PROYECTO, RESCATE DE PAGO Y ONBOARDING (/proyecto) ──
async function handleProject(request, env, url) {
  let L = langFromRequest(request);
  const token = url.searchParams.get("token");
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return msgPage(L, "trackInvalid", 404);
  }
  if (!env.LEADS_KV) return msgPage(L, "config", 500);

  const raw = await env.LEADS_KV.get(`project:${token}`);
  if (!raw) return msgPage(L, "trackMissing", 404);

  let proj = JSON.parse(raw);
  L = pickLang(proj.lang);
  const T = PG[L].tr;
  const projectPageUrl = buildUrl("/proyecto", { token });

  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    const op = String(form?.get("op") || (!proj.paid ? "pay" : ""));

    if (op === "pay") {
      if (proj.paid) return redirectTo(projectPageUrl);
      if (!env.STRIPE_SECRET_KEY) return paymentRetryPage(L);
      const checkout = await ensureStripeCheckout(env, proj);
      if (checkout?.paid) return redirectTo(projectPageUrl);
      if (checkout?.url) return redirectTo(checkout.url);
      return msgPage(L, "retry", 502, {
        form: true,
        footerUrl: projectPageUrl,
        footerLabel: PG[L].common.openTracker,
      });
    }

    if (op === "onboarding") {
      if (!proj.paid) return redirectTo(projectPageUrl);
      const socials = cleanInput(form?.get("socials") ?? "", 250);
      const domain = cleanInput(form?.get("domain") ?? "", 200);
      const materials = cleanInput(form?.get("materials") ?? "", 500);

      if (!socials && !domain && !materials) {
        return htmlResponse(
          page(T.obMissing[0], T.obMissing[1], T.obMissing[2], {
            lang: L,
            eyebrow: T.obEyebrow,
            html: `<a class="btn" href="${esc(projectPageUrl)}">${esc(PG[L].common.openTracker)}</a>`,
            footerUrl: projectPageUrl,
            footerLabel: PG[L].common.openTracker,
          }),
          400
        );
      }

      proj.onboarding = {
        socials,
        domain,
        materials,
        submittedAt: new Date().toISOString(),
      };
      await env.LEADS_KV.put(`project:${token}`, JSON.stringify(proj));

      if (env.RESEND_API_KEY) {
        const manageUrl = await advancePhaseUrl(env, token, proj.currentPhase || 1);
        await resendSend(
          env,
          {
            to: ["hola@rebrandyourbrand.es"],
            reply_to: proj.clientEmail,
            subject: `materiales iniciales recibidos — ${proj.brand}`,
            ...renderEmail("es", {
              paras: [
                `el cliente ha enviado los materiales de arranque para ${bold(proj.brand)}.`,
                lines(
                  `— cliente: ${bold(proj.clientEmail)}`,
                  socials && `— web / redes actuales: ${bold(socials)}`,
                  domain && `— dominio: ${bold(domain)}`,
                  materials && `— carpeta / notas: ${bold(materials)}`
                ),
              ],
              cta: { label: "abrir gestión de la fase actual", url: manageUrl },
              secondaryLink: { label: "ver seguimiento del cliente", url: projectPageUrl },
            }),
          },
          `onboarding-${token}-${Date.now()}`
        ).catch((e) => console.error("onboarding email failed:", e?.message));
      }

      return redirectTo(buildUrl("/proyecto", { token, ob: "1" }));
    }

    return redirectTo(projectPageUrl);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
  }

  if (!proj.paid || !proj.emailsSent || !proj.receiptUrl) {
    const sid = url.searchParams.get("session_id") || proj.stripeSessionId;
    if (sid && /^cs_[A-Za-z0-9_]+$/.test(sid) && env.STRIPE_SECRET_KEY) {
      const session = await fetchStripeSession(env, sid);
      if (session && (session.metadata?.project_token || session.client_reference_id) === token) {
        await processPaidSession(env, session).catch((e) =>
          console.error("processPaidSession (fallback) failed:", e?.message)
        );
        const fresh = await env.LEADS_KV.get(`project:${token}`);
        if (fresh) proj = JSON.parse(fresh);
      }
    }
  }

  const receiptRow =
    proj.paid && isStripeReceiptUrl(proj.receiptUrl)
      ? `<div class="phase-actions" style="margin-top:.85rem;"><a class="pill-link" href="${esc(proj.receiptUrl)}" target="_blank" rel="noopener noreferrer">${esc(T.receipt)}</a></div>`
      : "";

  const headerHtml = `
    <div class="box">
      <div class="kv">
        <div class="kv-row"><span>${esc(T.project)}</span><span class="kv-val">${esc(proj.brand)}</span></div>
        <div class="kv-row"><span>${esc(T.services)}</span><span class="kv-val">${esc(svcLabel(proj.services, L))}</span></div>
        <div class="kv-row"><span>${esc(proj.paid ? T.paid : T.due)}</span><span class="kv-val">${esc(eur(Number(proj.totalEur), L))}</span></div>
      </div>
      ${receiptRow}
    </div>`;

  if (!proj.paid) {
    const unpaidHtml = `
      ${headerHtml}
      <p class="lead">${esc(T.payIntro)}</p>
      <form method="POST">
        <input type="hidden" name="op" value="pay">
        <button type="submit">${esc(T.payBtn)}</button>
      </form>`;

    return htmlResponse(
      page(`${T.title} — ${proj.brand}`, T.heading, "", {
        lang: L,
        eyebrow: T.eyebrow,
        wide: true,
        html: unpaidHtml,
      }),
      200
    );
  }

  const bannerHtml =
    url.searchParams.get("ob") === "1" ? `<div class="banner-ok">${esc(T.obSentBanner)}</div>` : "";

  const allDone = Array.isArray(proj.phases) && proj.phases.every((ph) => ph.status === "done");
  let onboardingHtml = "";

  if (!proj.onboarding && !allDone) {
    onboardingHtml = `
      <div class="box accent">
        <span class="eyebrow">${esc(T.obEyebrow)}</span>
        <h2>${esc(T.obTitle)}</h2>
        <p class="lead" style="margin-bottom:1.1rem;font-size:.85rem;">${esc(T.obIntro)}</p>
        <form method="POST" style="text-align:left;">
          <input type="hidden" name="op" value="onboarding">
          <label for="socials">${esc(T.obSocials)}</label>
          <input id="socials" name="socials" type="text" maxlength="250" placeholder="${esc(T.obSocialsPh)}">
          <label for="domain">${esc(T.obDomain)}</label>
          <input id="domain" name="domain" type="text" maxlength="200" placeholder="${esc(T.obDomainPh)}">
          <label for="materials">${esc(T.obMaterials)}</label>
          <textarea id="materials" name="materials" rows="3" maxlength="500" placeholder="${esc(T.obMaterialsPh)}"></textarea>
          <button type="submit">${esc(T.obSubmit)}</button>
        </form>
      </div>`;
  } else if (proj.onboarding) {
    const ob = proj.onboarding;
    const matUrl = cleanHttpsUrl(ob.materials, 500);
    const matVal = matUrl
      ? `<a href="${esc(matUrl)}" target="_blank" rel="noopener noreferrer" style="color:#3D5A85;text-decoration:underline;">${esc(matUrl)}</a>`
      : esc(ob.materials);
    onboardingHtml = `
      <div class="box">
        <span class="eyebrow">${esc(T.obSentTitle)}</span>
        <div class="kv">
          ${ob.socials ? `<div class="kv-row"><span>${esc(T.obLblSocials)}</span><span class="kv-val">${esc(ob.socials)}</span></div>` : ""}
          ${ob.domain ? `<div class="kv-row"><span>${esc(T.obLblDomain)}</span><span class="kv-val">${esc(ob.domain)}</span></div>` : ""}
          ${ob.materials ? `<div class="kv-row"><span>${esc(T.obLblMaterials)}</span><span class="kv-val" style="word-break:break-all;">${matVal}</span></div>` : ""}
        </div>
      </div>`;
  }

  const phaseCards = await Promise.all(
    (proj.phases || []).map(async (ph) => {
      const isDone = ph.status === "done";
      const isReview = ph.status === "review";
      const isActive = ph.status === "active";
      const cls = isDone ? " is-done" : isReview ? " is-review" : isActive ? " is-active" : "";
      const dot = isDone ? "✓" : String(Number(ph.step));

      let meta = T.todo;
      if (isDone) {
        const parts = [T.done];
        if (ph.date) parts.push(fmtDate(ph.date, L));
        if (ph.approvedBy === "client") parts.push(T.doneClient);
        else if (ph.approvedBy === "tacit") parts.push(T.doneTacit);
        meta = parts.join(" — ");
      } else if (isReview) {
        meta = T.review;
      } else if (isActive) {
        meta = T.active;
      }

      const safeDeliv = cleanHttpsUrl(ph.deliverableUrl || "", 500);
      const noteHtml = ph.note
        ? `<div class="phase-note"><strong>${esc(T.studioNote)}:</strong> ${esc(ph.note)}</div>`
        : "";

      const actions = [];
      if (safeDeliv) {
        actions.push(
          `<a class="pill-link" href="${esc(safeDeliv)}" target="_blank" rel="noopener noreferrer">${esc(T.deliverable)}</a>`
        );
      }
      if (isReview) {
        const appUrl = await approvePhaseUrl(env, token, ph.step);
        actions.push(`<a class="btn btn-inline" href="${esc(appUrl)}">${esc(T.reviewAction)}</a>`);
      }
      const actionsHtml = actions.length ? `<div class="phase-actions">${actions.join("")}</div>` : "";

      return `<div class="phase-card${cls}">
        <span class="phase-dot">${dot}</span>
        <div class="phase-body">
          <span class="phase-title">${esc(T.step)} ${Number(ph.step)} — ${esc(phaseTitle(ph, L))}</span>
          <span class="phase-meta">${esc(meta)}</span>
          ${noteHtml}
          ${actionsHtml}
        </div>
      </div>`;
    })
  );

  const fullHtml = `
    ${bannerHtml}
    ${headerHtml}
    ${onboardingHtml}
    <h3>${esc(T.state)}</h3>
    <div class="timeline">${phaseCards.join("")}</div>`;

  return htmlResponse(
    page(`${T.title} — ${proj.brand}`, T.heading, "", {
      lang: L,
      eyebrow: T.eyebrow,
      wide: true,
      html: fullHtml,
    }),
    200
  );
}

// ── VALORACIÓN VERIFICADA (/valorar) ──
async function handleReview(request, env, url) {
  let L = langFromRequest(request);
  const p = url.searchParams.get("p");
  const t = url.searchParams.get("t");
  if (!p || !/^[a-f0-9]{64}$/.test(p) || !t || !/^[a-f0-9]{64}$/.test(t)) return msgPage(L, "invalid", 400);
  if (!env.LEADS_KV || !env.RESEND_API_KEY) return msgPage(L, "config", 500);

  const key = await getKey(env);
  if (!(await verifyRaw(key, `review|${p}`, t))) return msgPage(L, "invalid", 400);

  const raw = await env.LEADS_KV.get(`project:${p}`);
  if (!raw) return msgPage(L, "trackMissing", 404);
  const proj = JSON.parse(raw);
  L = pickLang(proj.lang);
  const trackingUrl = buildUrl("/proyecto", { token: p });

  const finished =
    proj.paid &&
    Array.isArray(proj.phases) &&
    proj.phases.length > 0 &&
    proj.phases.every((ph) => ph.status === "done");
  if (!finished) return msgPage(L, "rvNotReady", 403, { footerUrl: trackingUrl, footerLabel: PG[L].common.openTracker });
  if (proj.reviewSubmitted) return msgPage(L, "rvDone", 200, { footerUrl: trackingUrl, footerLabel: PG[L].common.openTracker });

  const R = PG[L].rv;
  if (request.method === "GET" || request.method === "HEAD") {
    const stars5 = [5, 4, 3, 2, 1]
      .map((n) => `<option value="${n}">${"★".repeat(n)}${"☆".repeat(5 - n)} (${n}/5)</option>`)
      .join("");
    const formHtml = `<form method="POST" style="text-align:left;">
      <label>${esc(R.business)}</label><input type="text" value="${esc(proj.brand)}" readonly>
      <label for="name">${esc(R.name)}</label><input id="name" name="name" type="text" required maxlength="80" autocomplete="name">
      <label for="rating">${esc(R.rating)}</label><select id="rating" name="rating">${stars5}</select>
      <label for="comment">${esc(R.comment)}</label><textarea id="comment" name="comment" required rows="4" maxlength="300"></textarea>
      <button type="submit">${esc(R.submit)}</button>
    </form>`;
    return htmlResponse(
      page(R.title, R.heading, R.intro, {
        lang: L,
        eyebrow: R.eyebrow,
        html: formHtml,
        footerUrl: trackingUrl,
        footerLabel: PG[L].common.openTracker,
      }),
      200
    );
  }
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
  }

  const form = await request.formData().catch(() => null);
  const name = cleanInput(form?.get("name") ?? "", 80);
  const comment = cleanNote(form?.get("comment") ?? "", 300);
  const rating = Math.min(5, Math.max(1, parseInt(form?.get("rating"), 10) || 5));
  if (!name || !comment) return msgPage(L, "rvMissing", 400);

  const business = cleanInput(proj.brand ?? "", 80);
  const token = randomHex(32);
  const review = {
    id: token.slice(0, 16),
    name,
    business,
    rating,
    comment,
    date: new Date().toISOString(),
    verified: true,
  };
  await env.LEADS_KV.put(`testimonial:${token}`, JSON.stringify(review), {
    expirationTtl: TESTIMONIAL_TTL_SECONDS,
  });

  try {
    await resendSend(
      env,
      {
        to: ["hola@rebrandyourbrand.es"],
        subject: `nueva reseña pendiente de ${business} (${rating}/5)`,
        ...renderEmail("es", {
          paras: [
            "nueva valoración de un cliente verificado (proyecto finalizado):",
            lines(
              `— nombre: ${bold(name)}`,
              `— negocio: ${bold(business)}`,
              `— servicios: ${bold(svcLabel(proj.services, "es"))}`,
              `— valoración: ${bold(`${rating}/5`)}`
            ),
            "comentario:",
          ],
          quote: comment,
          cta: { label: "aprobar o rechazar reseña", url: buildUrl("/testimonial", { token }) },
        }),
      },
      `testimonial-${token}`
    );
  } catch (e) {
    console.error("Testimonial email failed:", e?.message);
    await env.LEADS_KV.delete(`testimonial:${token}`).catch(() => {});
    return msgPage(L, "error", 502);
  }

  proj.reviewSubmitted = true;
  await env.LEADS_KV.put(`project:${p}`, JSON.stringify(proj));
  return msgPage(L, "rvThanks", 200, {
    footerUrl: trackingUrl,
    footerLabel: PG[L].common.openTracker,
  });
}

// ── MODERACIÓN DE RESEÑA (/testimonial) ──
async function handleTestimonialReview(request, env, url) {
  const token = url.searchParams.get("token");
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return htmlResponse(page("inválido", "enlace inválido", "el enlace no es válido."), 400);
  }
  if (!env.LEADS_KV) {
    return htmlResponse(page("error", "error de configuración", "falta el kv."), 500);
  }

  const raw = await env.LEADS_KV.get(`testimonial:${token}`);
  if (!raw) {
    return htmlResponse(
      page("expirado", "reseña ya gestionada", "esta reseña ya fue aprobada, rechazada o ha caducado."),
      400
    );
  }
  const review = JSON.parse(raw);

  if (request.method === "GET" || request.method === "HEAD") {
    const buttons = `<blockquote>${esc(review.comment)}</blockquote>
      <form method="POST"><button type="submit" name="decision" value="approve">aprobar y publicar</button><button type="submit" name="decision" value="reject" class="no">rechazar</button></form>`;
    return htmlResponse(
      page(
        "moderar reseña",
        "nueva reseña verificada",
        `${review.business} — ${review.name} — ${stars(review.rating)}`,
        { eyebrow: "moderación interna", html: buttons }
      ),
      200
    );
  }
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
  }

  const decision = (await request.formData().catch(() => null))?.get("decision");

  if (decision === "approve") {
    const approved = (await env.LEADS_KV.get(APPROVED_KEY, { type: "json" })) || [];
    approved.unshift(review);
    await env.LEADS_KV.put(APPROVED_KEY, JSON.stringify(approved.slice(0, MAX_APPROVED_TESTIMONIALS)));
    await env.LEADS_KV.delete(`testimonial:${token}`);

    try {
      const key = await getKey(env);
      const deleteToken = await testimonialDeleteToken(key, review.id);
      const deleteUrl = buildUrl("/testimonial-delete", { token: deleteToken, id: review.id });
      await resendSend(
        env,
        {
          to: ["hola@rebrandyourbrand.es"],
          subject: `reseña publicada de ${review.business} (${review.rating}/5) — enlace para eliminar`,
          ...renderEmail("es", {
            paras: [
              "hola,",
              `la reseña de ${bold(review.business)} (${esc(review.name)}, ${review.rating}/5) ya está publicada en la web.`,
              "comentario:",
            ],
            quote: review.comment,
            cta: { label: "eliminar reseña", url: deleteUrl },
            note: "si necesitas retirarla más adelante, usa este botón y te pediremos confirmación antes de borrarla.",
          }),
        },
        `approved-${review.id}`
      );
    } catch (e) {
      console.error("approved testimonial email failed:", e?.message);
    }
    return htmlResponse(
      page(
        "publicada",
        "reseña publicada",
        "ya aparece en la web. te hemos enviado un correo con un botón por si quieres eliminarla más adelante.",
        { eyebrow: "moderación interna" }
      ),
      200
    );
  }

  if (decision === "reject") {
    await env.LEADS_KV.delete(`testimonial:${token}`);
    return htmlResponse(
      page("rechazada", "reseña rechazada", "se ha descartado y no se publicará.", {
        eyebrow: "moderación interna",
      }),
      200
    );
  }

  return htmlResponse(page("error", "acción no válida", "vuelve a abrir el enlace del correo."), 400);
}

// ── ELIMINAR UNA RESEÑA YA PUBLICADA (/testimonial-delete) ──
async function handleTestimonialDelete(request, env, url) {
  const token = url.searchParams.get("token");
  const id = url.searchParams.get("id");
  if (!token || !/^[a-f0-9]{64}$/.test(token) || !id || !/^[a-f0-9]{16}$/.test(id)) {
    return htmlResponse(page("inválido", "enlace inválido", "el enlace no es válido."), 400);
  }
  if (!env.LEADS_KV) return htmlResponse(page("error", "error de configuración", "falta el kv."), 500);

  const key = await getKey(env);
  if (!(await verifyRaw(key, `tdel|${id}`, token))) {
    return htmlResponse(page("inválido", "enlace inválido", "el enlace no es válido."), 400);
  }

  const approved = (await env.LEADS_KV.get(APPROVED_KEY, { type: "json" })) || [];
  const review = approved.find((r) => r.id === id);
  if (!review) {
    return htmlResponse(
      page("no encontrada", "reseña no encontrada", "esta reseña ya se eliminó o ya no está publicada."),
      404
    );
  }

  if (request.method === "GET" || request.method === "HEAD") {
    const html = `<blockquote>${esc(review.comment)}</blockquote>
      <form method="POST"><button type="submit">eliminar definitivamente</button></form>`;
    return htmlResponse(
      page(
        "eliminar reseña",
        "eliminar reseña",
        `${review.business} — ${review.name} — ${stars(review.rating)}`,
        { eyebrow: "moderación interna", html }
      ),
      200
    );
  }
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
  }

  await env.LEADS_KV.put(APPROVED_KEY, JSON.stringify(approved.filter((r) => r.id !== id)));
  return htmlResponse(
    page(
      "eliminada",
      "reseña eliminada",
      "ya no aparecerá en la web (la lista pública puede tardar un minuto en actualizarse).",
      { eyebrow: "moderación interna" }
    ),
    200
  );
}

// ── FORMULARIO OPCIONAL POR CORREO (/webhook/email) ──
async function handleEmailForm(request, env, originOk, o) {
  if (!ENABLE_EMAIL_FORM) return jsonResponse({ error: "not_found" }, 404, null);
  if (!originOk) return jsonResponse({ error: "forbidden_origin" }, 403, null);
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405, o, { Allow: "POST, OPTIONS" });
  }
  if (!env.LEADS_KV || !env.RESEND_API_KEY || !env.CHAT_LIMITER || !env.TURNSTILE_SECRET_KEY) {
    return jsonResponse({ error: "misconfigured" }, 500, o);
  }

  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_BODY_BYTES) return jsonResponse({ error: "payload_too_large" }, 413, o);
  const raw = await request.text();
  if (enc.encode(raw).byteLength > MAX_BODY_BYTES) return jsonResponse({ error: "payload_too_large" }, 413, o);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400, o);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "invalid_json" }, 400, o);
  }

  try {
    const ip = request.headers.get("CF-Connecting-IP") ?? "";
    const { success } = await env.CHAT_LIMITER.limit({ key: `e:${ipKey(ip)}` });
    if (!success) throw new HttpError(429, "rate_limited", { "Retry-After": "60" });
    if (env.VERIFY_LIMITER) {
      const { success: okV } = await env.VERIFY_LIMITER.limit({ key: `v:${ipKey(ip)}` });
      if (!okV) throw new HttpError(429, "rate_limited", { "Retry-After": "60" });
    }
    await verifyTurnstile(env, body.token, ip, "email-form");

    const clientEmail = String(body.email ?? "").toLowerCase().trim();
    const brand = cleanBrand(body.brand);
    if (clientEmail.length > 254 || !EMAIL_RE.test(clientEmail) || !brand) {
      throw new HttpError(400, "missing_fields");
    }

    const plan = normalizeServices(body.services);
    if (!plan) throw new HttpError(400, "plan_required");

    const lang = LANG_ORDER.includes(body.lang) ? body.lang : "es";
    const description = cleanText(body.description, 500) || "sin descripción";

    await startVerification(env, {
      lang,
      messages: [{ role: "user", text: `Solicitud por formulario. Descripción: ${description}` }],
      plan,
      clientEmail,
      brand,
    });
    return jsonResponse({ success: true }, 200, o);
  } catch (err) {
    if (err instanceof HttpError) return jsonResponse({ error: err.code }, err.status, o, err.headers);
    console.error("email form unhandled:", err?.message);
    return jsonResponse({ error: "internal_error" }, 500, o);
  }
}
