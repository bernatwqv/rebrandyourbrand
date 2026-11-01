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
      domain: data.domain,
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

function checkAllServicesApproved(proj) {
  if (!proj || !Array.isArray(proj.phases) || proj.phases.length === 0) return false;
  return proj.phases.every((ph) => ph.status === "done");
}

async function finalizeProjectClosure(
  env,
  proj,
  projectToken,
  { deliverableUrl = "", deliverableFilename = "", note = "" } = {}
) {
  if (!proj || !projectToken) return { ok: false, reason: "invalid_args" };

  const now = new Date().toISOString();
  let changed = false;

  // 1. Asegurar que todas las fases (incluida entrega final) queden con status "done"
  if (Array.isArray(proj.phases)) {
    for (const ph of proj.phases) {
      if (ph.status !== "done") {
        ph.status = "done";
        if (!ph.date) ph.date = now;
        if (!ph.approvedBy) ph.approvedBy = "client";
        if (!ph.approvedAt) ph.approvedAt = now;
        changed = true;
      }
    }
  }

  // 2. Establecer campos globales del proyecto
  if (proj.status !== "done") {
    proj.status = "done";
    changed = true;
  }
  if (!proj.finishedAt) {
    proj.finishedAt = now;
    changed = true;
  }
  const maxStep = Array.isArray(proj.phases) ? proj.phases.length : 1;
  if (Number(proj.currentPhase) <= maxStep) {
    proj.currentPhase = maxStep + 1;
    changed = true;
  }
  if (Array.isArray(proj.services) && proj.services.includes("web")) {
    if (!proj.nextRenewalAt) {
      proj.nextRenewalAt = addOneYearIso(now);
      changed = true;
    }
    if (!proj.renewalNextDue || proj.renewalNextDue !== proj.nextRenewalAt) {
      proj.renewalNextDue = proj.nextRenewalAt;
      changed = true;
    }
  }

  // Determinar el mejor entregable definitivo disponible
  const effectiveDelivUrl =
    deliverableUrl ||
    [...proj.phases].reverse().find((ph) => ph.deliverableUrl)?.deliverableUrl ||
    "";
  const effectiveDelivFilename =
    deliverableFilename ||
    [...proj.phases].reverse().find((ph) => ph.deliverableFilename)?.deliverableFilename ||
    "";
  const effectiveNote =
    note ||
    [...proj.phases].reverse().find((ph) => ph.note)?.note ||
    "";

  // Si deliveryPhase existe y no tenía entregable asignado, hereda el definitivo
  const deliveryPhase = proj.phases.find((ph) => ph.key === "delivery");
  if (deliveryPhase) {
    if (!deliveryPhase.deliverableUrl && effectiveDelivUrl) {
      deliveryPhase.deliverableUrl = effectiveDelivUrl;
      if (effectiveDelivFilename) deliveryPhase.deliverableFilename = effectiveDelivFilename;
      if (effectiveNote) deliveryPhase.note = effectiveNote;
      changed = true;
    }
  }

  const lang = pickLang(proj.lang);
  const trackingUrl = buildUrl("/proyecto", { token: projectToken });

  // 3. Correo de entrega final / cierre de proyecto al cliente con archivos definitivos (idempotente)
  if (!proj.completionEmailSent && env.RESEND_API_KEY) {
    const tc = EM[lang].completion || EM[lang].phase;
    try {
      await resendSend(
        env,
        {
          to: [proj.clientEmail],
          subject: tc.subject(proj.brand),
          ...renderEmail(lang, {
            paras: [
              tc.hello,
              tc.intro(proj.brand),
              tc.body,
              effectiveDelivUrl
                ? `${tc.deliverable}: <a href="${esc(effectiveDelivUrl)}" target="_blank" style="color:#3D5A85;font-weight:600;">${esc(effectiveDelivFilename || effectiveDelivUrl)}</a>`
                : "",
            ].filter(Boolean),
            quote: effectiveNote,
            cta: { label: tc.cta, url: trackingUrl },
            secondaryLink: effectiveDelivUrl
              ? { label: tc.deliverable, url: effectiveDelivUrl }
              : null,
            note: tc.note,
          }),
        },
        `completion-client-${projectToken}`
      );
      proj.completionEmailSent = true;
      changed = true;
    } catch (e) {
      console.error("completion client email failed:", e?.message);
    }
  }

  // 4. Notificación de cierre con éxito al estudio (idempotente)
  if (!proj.adminCompletionSent && env.RESEND_API_KEY) {
    try {
      await resendSend(
        env,
        {
          to: ["hola@rebrandyourbrand.es"],
          reply_to: proj.clientEmail,
          subject: `proyecto finalizado con éxito — ${proj.brand}`,
          ...renderEmail("es", {
            paras: [
              "el cliente ha validado todas las fases y el proyecto ha finalizado con éxito.",
              lines(
                `— proyecto: ${bold(proj.brand)}`,
                `— cliente: ${bold(proj.clientEmail)}`,
                `— servicios: ${bold(svcLabel(proj.services, "es"))}`,
                `— fecha de finalización (iso): ${bold(now)}`,
                effectiveDelivUrl ? `— entregable final: ${bold(effectiveDelivUrl)}` : ""
              ),
            ],
            cta: { label: "ver ficha del proyecto", url: trackingUrl },
          }),
        },
        `completion-admin-${projectToken}`
      );
      proj.adminCompletionSent = true;
      changed = true;
    } catch (e) {
      console.error("completion admin email failed:", e?.message);
    }
  }

  // 5. Correo automatizado con enlace único a reseña verificada (idempotente)
  if (!proj.reviewInvited && env.RESEND_API_KEY) {
    try {
      await sendReviewInvite(env, proj, projectToken);
      proj.reviewInvited = true;
      changed = true;
    } catch (e) {
      console.error("review invite failed in closure:", e?.message);
      await alertAdmin(
        env,
        "fallo al enviar la invitación a valorar en el cierre",
        `proyecto: ${proj.brand}\ncliente: ${proj.clientEmail}\nenlace de valoración (envíaselo a mano): ${await reviewUrl(env, projectToken)}`
      ).catch(() => {});
    }
  }

  if (changed) {
    await saveProject(env, projectToken, proj);
  }

  return { ok: true, finished: true };
}

async function completeProjectPhase(
  env,
  proj,
  projectToken,
  { step = 0, approvedBy = "studio", deliverableUrl = "", deliverableFilename = "", note = "", legacyActionToken = "" } = {}
) {
  let targetIdx = -1;
  if (step > 0) {
    targetIdx = proj.phases.findIndex(
      (ph) => ph.step === Number(step) && (ph.status === "active" || ph.status === "review")
    );
  }
  if (targetIdx < 0) {
    targetIdx = proj.phases.findIndex(
      (ph) => ph.step === Number(proj.currentPhase) && (ph.status === "active" || ph.status === "review")
    );
  }
  if (targetIdx < 0) {
    targetIdx = proj.phases.findIndex((ph) => ph.status === "active" || ph.status === "review");
  }
  if (targetIdx < 0) {
    if (checkAllServicesApproved(proj)) {
      await finalizeProjectClosure(env, proj, projectToken, { deliverableUrl, deliverableFilename, note });
      return { ok: true, finished: true };
    }
    return { ok: false, reason: "already_finished" };
  }

  const now = new Date().toISOString();
  const advancedPhase = proj.phases[targetIdx];
  advancedPhase.status = "done";
  advancedPhase.date = now;
  advancedPhase.approvedBy = approvedBy;
  if (approvedBy === "client") advancedPhase.approvedAt = now;
  if (deliverableUrl) advancedPhase.deliverableUrl = deliverableUrl;
  if (deliverableFilename) advancedPhase.deliverableFilename = deliverableFilename;
  if (note) advancedPhase.note = note;

  // Comprobar si se ha alcanzado el final del último servicio contratado o de todas las fases
  let nextPhase = null;
  let nextStep = 0;
  let finished = false;

  const isLastPhase = targetIdx + 1 >= proj.phases.length;
  if (isLastPhase && advancedPhase.key === "delivery") {
    finished = true;
    await finalizeProjectClosure(env, proj, projectToken, {
      deliverableUrl: deliverableUrl || advancedPhase.deliverableUrl || "",
      deliverableFilename: deliverableFilename || advancedPhase.deliverableFilename || "",
      note: note || advancedPhase.note || "",
    });
  } else if (!isLastPhase) {
    nextPhase = proj.phases[targetIdx + 1];
    nextPhase.status = "active";
    nextPhase.date = now;
    nextStep = nextPhase.step;
    proj.currentPhase = nextStep;
    await saveProject(env, projectToken, proj);
    if (nextPhase.key === "delivery" && approvedBy === "client") {
      await alertAdmin(
        env,
        `todas las fases creativas aprobadas — ${proj.brand}`,
        `el cliente ha aprobado la última fase creativa. el proyecto pasa a la fase de entrega final ("delivery"), pendiente del despliegue y entrega de archivos finales por parte del estudio.\n\ncliente: ${proj.clientEmail}\nproyecto: ${proj.brand}`
      ).catch(() => {});
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
              ? `— estado: ${bold("proyecto finalizado con éxito")}`
              : `— nueva fase activa: ${bold(`paso ${nextStep} — ${nextTitleEs}`)}`
          ),
        ]
      : [
          "hola,",
          `la fase ${bold(advancedTitleEs)} del proyecto ${bold(proj.brand)} se ha completado con éxito.`,
          finished
            ? "el proyecto ha completado todas sus fases y ha finalizado con éxito."
            : `la nueva fase activa es: ${bold(`paso ${nextStep} — ${nextTitleEs}`)}.`,
        ];

  if (!finished) {
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
                  `— ${t.next}: ${bold(phaseTitle(nextPhase, lang))}`
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
  }

  if (legacyActionToken) {
    await env.LEADS_KV.delete(`phase_action:${legacyActionToken}`).catch(() => {});
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

  // allDone ya declarado al inicio de handleProject
  if (allDone || checkAllServicesApproved(proj)) {
    if (!allDone || !proj.finishedAt || !proj.reviewInvited || proj.status !== "done") {
      await finalizeProjectClosure(env, proj, projectToken).catch((e) =>
        console.error("handlePhaseAdvance auto-finalize failed:", e?.message)
      );
    }
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
  const revsMax = currentPhaseObj.maxRevisions || MAX_PHASE_REVISIONS;
  const revsUsed = Math.min(revsMax, Math.max(0, Number(currentPhaseObj.revisionsUsed) || 0));
  const stateLabel =
    currentPhaseObj.status === "review"
      ? `en revisión del cliente (enviada el ${fmtDate(currentPhaseObj.reviewSentAt || currentPhaseObj.date, "es")})`
      : revsUsed > 0
        ? `aplicando ajustes del cliente (ronda ${revsUsed} de ${revsMax})`
        : "en curso en el estudio";

  if (request.method === "GET" || request.method === "HEAD") {
    const materialsList = (Array.isArray(proj.materialsList) ? [...proj.materialsList] : []).filter((m) => {
      if (!m) return false;
      if (m.id === "init" && !m.url && !m.fileId && !m.fileUrl && !m.notes && !m.socials) {
        if (m.domain && !proj.domain) proj.domain = m.domain;
        return false;
      }
      return true;
    });
    if (proj.onboarding && materialsList.length === 0) {
      const ob = proj.onboarding;
      const legacyUrl = cleanHttpsUrl(ob.materials || "", 500);
      const hasRealContent = Boolean(legacyUrl || ob.socials || ob.materials || ob.notes);
      if (hasRealContent) {
        materialsList.push({
          id: "legacy",
          createdAt: ob.submittedAt || ob.receivedAt || "",
          domain: ob.domain || "",
          socials: ob.socials || "",
          notes: legacyUrl ? "" : (ob.materials || ""),
          url: legacyUrl || "",
          fileUrl: "",
          filename: "",
        });
      } else if (ob.domain && !proj.domain) {
        proj.domain = ob.domain;
      }
    }
    const referencesList = Array.isArray(proj.referencesList) ? [...proj.referencesList] : [];

    const matItemsHtml = await Promise.all(
      materialsList.map(async (m, i) => {
        const dateStr = m.createdAt ? fmtDate(m.createdAt, "es") : "";
        const urlLink = cleanHttpsUrl(m.url || "", 500);
        let fileLink = "";
        if (m.fileId) fileLink = await fileDownloadUrl(env, projectToken, "mat", m.fileId);
        else if (m.fileUrl) fileLink = m.fileUrl;
        return `
          <div class="history-item">
            <div class="history-head">
              <span style="font-size:.78rem;font-weight:600;color:#3D5A85;">material #${i + 1}</span>
              ${dateStr ? `<span style="font-size:.74rem;color:#58575E;">${esc(dateStr)}</span>` : ""}
            </div>
            <div class="kv" style="font-size:.82rem;">
              ${m.domain ? `<div class="kv-row"><span>dominio</span><span class="kv-val">${esc(m.domain)}</span></div>` : ""}
              ${m.socials ? `<div class="kv-row"><span>web / redes</span><span class="kv-val">${esc(m.socials)}</span></div>` : ""}
              ${urlLink ? `<div class="kv-row"><span>enlace externo</span><span class="kv-val" style="word-break:break-all;"><a href="${esc(urlLink)}" target="_blank" rel="noopener noreferrer" style="color:#3D5A85;text-decoration:underline;">${esc(urlLink)}</a></span></div>` : ""}
              ${fileLink ? `<div class="kv-row"><span>archivo directo</span><span class="kv-val"><a class="pill-link" href="${esc(fileLink)}" target="_blank" rel="noopener noreferrer">${esc(m.filename || "descargar material")}</a></span></div>` : ""}
            </div>
            ${m.notes ? `<div class="phase-note" style="margin-top:.55rem;">${esc(m.notes)}</div>` : ""}
          </div>`;
      })
    );

    const refItemsHtml = await Promise.all(
      referencesList.map(async (r, i) => {
        const dateStr = r.createdAt ? fmtDate(r.createdAt, "es") : "";
        const urlLink = cleanHttpsUrl(r.url || "", 500);
        let fileLink = "";
        if (r.fileId) fileLink = await fileDownloadUrl(env, projectToken, "ref", r.fileId);
        else if (r.fileUrl) fileLink = r.fileUrl;
        return `
          <div class="history-item">
            <div class="history-head">
              <span style="font-size:.78rem;font-weight:600;color:#825008;">referencia #${i + 1}</span>
              ${dateStr ? `<span style="font-size:.74rem;color:#58575E;">${esc(dateStr)}</span>` : ""}
            </div>
            <div class="kv" style="font-size:.82rem;">
              ${urlLink ? `<div class="kv-row"><span>enlace web</span><span class="kv-val" style="word-break:break-all;"><a href="${esc(urlLink)}" target="_blank" rel="noopener noreferrer" style="color:#3D5A85;text-decoration:underline;">${esc(urlLink)}</a></span></div>` : ""}
              ${fileLink ? `<div class="kv-row"><span>captura / archivo</span><span class="kv-val"><a class="pill-link" href="${esc(fileLink)}" target="_blank" rel="noopener noreferrer">${esc(r.filename || "descargar referencia")}</a></span></div>` : ""}
            </div>
            ${r.notes ? `<div class="phase-note" style="margin-top:.55rem;">${esc(r.notes)}</div>` : ""}
          </div>`;
      })
    );

    const obHtml = matItemsHtml.length
      ? `<div class="box">
          <span class="eyebrow">materiales aportados por el cliente</span>
          ${matItemsHtml.join("")}
        </div>`
      : "";

    const refHtml = refItemsHtml.length
      ? `<div class="box">
          <span class="eyebrow">referencias visuales del cliente</span>
          ${refItemsHtml.join("")}
        </div>`
      : "";

    const revsHtml =
      Array.isArray(currentPhaseObj.revisions) && currentPhaseObj.revisions.length
        ? `<div class="box review-box">
            <span class="eyebrow">historial de ajustes solicitados por el cliente</span>
            ${currentPhaseObj.revisions
              .map(
                (rv) => `<div style="margin-bottom:.75rem;">
                  <span style="display:block;font-size:.75rem;font-weight:600;color:#825008;margin-bottom:.25rem;">ronda ${Number(rv.round) || 1} de ${revsMax}${rv.requestedAt ? ` — ${esc(fmtDate(rv.requestedAt, "es"))}` : ""}</span>
                  <div class="phase-note" style="margin-top:0;">${esc(rv.text || "")}</div>
                </div>`
              )
              .join("")}
          </div>`
        : "";

    const html = `
      <div class="box">
        <div class="kv">
          <div class="kv-row"><span>proyecto</span><span class="kv-val">${esc(proj.brand)}</span></div>
          <div class="kv-row"><span>cliente</span><span class="kv-val">${esc(proj.clientEmail)}</span></div>
          <div class="kv-row"><span>idioma</span><span class="kv-val">${esc(proj.lang)}</span></div>
          ${proj.domain ? `<div class="kv-row"><span>dominio preferido</span><span class="kv-val">${esc(proj.domain)}</span></div>` : ""}
          <div class="kv-row"><span>servicios</span><span class="kv-val">${esc(svcLabel(proj.services, "es"))}</span></div>
          <div class="kv-row"><span>fase actual</span><span class="kv-val">paso ${currentPhaseObj.step} — ${esc(currentTitleEs)}</span></div>
          <div class="kv-row"><span>estado</span><span class="kv-val">${esc(stateLabel)}</span></div>
          <div class="kv-row"><span>rondas de revisión usadas</span><span class="kv-val">${revsUsed} de ${revsMax}</span></div>
        </div>
      </div>
      ${obHtml}
      ${refHtml}
      ${revsHtml}
      <form method="POST" enctype="multipart/form-data" style="text-align:left;">
        <label for="deliverable_file">1. subir archivo directo del entregable (opcional, cualquier formato)</label>
        <input id="deliverable_file" name="deliverable_file" type="file">
        <span class="file-note">acepta cualquier formato (pdf, zip, png, jpg, svg, webp, mp4...) hasta 25 mb.</span>
        <label for="deliverable_url">2. o pegar enlace externo (opcional si subes archivo, ej. github pages o figma)</label>
        <input id="deliverable_url" name="deliverable_url" type="url" maxlength="500" placeholder="https://..." value="${esc(currentPhaseObj.deliverableUrl || "")}">
        <label for="note">nota para el cliente (opcional)</label>
        <textarea id="note" name="note" rows="4" maxlength="600" placeholder="contexto breve sobre la entrega, qué revisar o pasos siguientes...">${esc(currentPhaseObj.note || "")}</textarea>
        <button type="submit" name="decision" value="review">${currentPhaseObj.key === "delivery" ? "completar entrega final y cerrar proyecto" : "enviar propuesta a revisión del cliente"}</button>
      </form>
    `;

    return htmlResponse(
      page(
        `gestionar fase — ${proj.brand}`,
        "gestionar fase del proyecto",
        "puedes subir un entregable o indicar un enlace para que el cliente lo revise y valide por escrito en su panel privado.",
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
  const currentManageUrl = await advancePhaseUrl(env, projectToken, step);

  const rawUrl = String(form?.get("deliverable_url") ?? form?.get("deliverableUrl") ?? "").trim();
  const directUrl = cleanHttpsUrl(rawUrl, 500);
  if (rawUrl && !directUrl) {
    return htmlResponse(
      page(
        "enlace inválido",
        "revisa el enlace del entregable",
        "el enlace al entregable debe usar https:// (por ejemplo https://drive.google.com/...). vuelve atrás y corrígelo o déjalo vacío si subes un archivo directo.",
        {
          eyebrow: "panel interno del estudio",
          footerUrl: currentManageUrl,
          footerLabel: "volver a la fase",
        }
      ),
      400
    );
  }

  const delivFile = form?.get("deliverable_file");
  let uploadedFileUrl = "";
  let uploadedFilename = "";

  if (
    delivFile &&
    typeof delivFile === "object" &&
    typeof delivFile.arrayBuffer === "function" &&
    delivFile.size > 0
  ) {
    if (delivFile.size > 25 * 1024 * 1024) {
      return htmlResponse(
        page(
          "archivo demasiado grande",
          "tamaño de archivo superado",
          "el archivo supera el límite de 25 mb admitido para subida directa. para archivos más pesados, compártelo mediante un enlace externo (drive, wetransfer o dropbox) en el campo inferior.",
          {
            eyebrow: "panel interno del estudio",
            footerUrl: currentManageUrl,
            footerLabel: "volver a la fase",
          }
        ),
        400
      );
    }
    const fileId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const arrayBuf = await delivFile.arrayBuffer();
    uploadedFilename = safeFilename(delivFile.name, `entregable-fase-${step}`);
    const contentType = cleanInput(delivFile.type, 100) || "application/octet-stream";
    await env.LEADS_KV.put(`file:${projectToken}:${step}:${fileId}`, arrayBuf, {
      metadata: {
        filename: uploadedFilename,
        contentType,
        size: delivFile.size,
        createdAt: new Date().toISOString(),
      },
    });
    uploadedFileUrl = await fileDownloadUrl(env, projectToken, step, fileId);
  }

  const effectiveDeliverableUrl = uploadedFileUrl || directUrl || currentPhaseObj.deliverableUrl || "";
  const effectiveDeliverableFilename =
    uploadedFilename || (uploadedFileUrl ? uploadedFilename : (!directUrl ? currentPhaseObj.deliverableFilename || "" : ""));

  if (!effectiveDeliverableUrl) {
    return htmlResponse(
      page(
        "entregable obligatorio",
        "falta el entregable de la fase",
        "es obligatorio adjuntar un archivo o indicar un enlace al entregable antes de enviar la propuesta al cliente.",
        {
          eyebrow: "panel interno del estudio",
          footerUrl: currentManageUrl,
          footerLabel: "volver a la fase",
        }
      ),
      400
    );
  }

  const note = cleanNote(form?.get("note") ?? "", 600);
  const decision = String(form?.get("decision") ?? "review");

  if (currentPhaseObj.key === "delivery") {
    const now = new Date().toISOString();
    currentPhaseObj.status = "done";
    currentPhaseObj.date = now;
    currentPhaseObj.deliverableUrl = effectiveDeliverableUrl;
    if (effectiveDeliverableFilename) {
      currentPhaseObj.deliverableFilename = effectiveDeliverableFilename;
    }
    currentPhaseObj.note = note;

    await finalizeProjectClosure(env, proj, projectToken, {
      deliverableUrl: effectiveDeliverableUrl,
      deliverableFilename: effectiveDeliverableFilename,
      note,
    });

    return htmlResponse(
      page(
        "¡enviado correctamente!",
        "entrega final completada",
        `has completado la entrega final de ${proj.brand}. se han enviado los archivos definitivos y la invitación a valorar al cliente.`,
        {
          eyebrow: "panel interno del estudio",
          html: `<div class="notice-box"><p>aviso: el proyecto ha finalizado con éxito y el cliente ha recibido la notificación y los archivos.</p></div><a class="btn" href="${esc(trackingUrl)}">ver página pública del cliente</a>`,
          footerUrl: trackingUrl,
          footerLabel: "ver página pública del cliente",
        }
      ),
      200
    );
  }

  if (decision === "review") {
    const now = new Date().toISOString();
    proj.lastClientActivityAt = Date.now();
    currentPhaseObj.status = "review";
    currentPhaseObj.reviewSentAt = now;
    currentPhaseObj.deliverableUrl = effectiveDeliverableUrl;
    if (effectiveDeliverableFilename) {
      currentPhaseObj.deliverableFilename = effectiveDeliverableFilename;
    } else {
      delete currentPhaseObj.deliverableFilename;
    }
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
              effectiveDeliverableUrl
                ? `${tp.openDeliverable}: <a href="${esc(effectiveDeliverableUrl)}" target="_blank" style="color:#3D5A85;font-weight:600;">${esc(effectiveDeliverableFilename || effectiveDeliverableUrl)}</a>`
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

      await saveProject(env, projectToken, proj);
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
        "¡enviado correctamente!",
        "propuesta enviada a revisión con éxito",
        `hemos avisado a ${proj.clientEmail} con el enlace para revisar y validar por escrito "${currentTitleEs}".`,
        {
          eyebrow: "panel interno del estudio",
          html: `<div class="notice-box"><p>aviso: esta acción ya ha quedado registrada en el sistema y el cliente ha recibido la notificación para revisar la propuesta.</p></div><a class="btn" href="${esc(currentManageUrl)}">volver al panel de esta fase</a>`,
          footerUrl: trackingUrl,
          footerLabel: "ver página pública del cliente",
        }
      ),
      200
    );
  }

  return htmlResponse(
    page(
      "acción no permitida",
      "validación obligatoria del cliente",
      "la progresión del proyecto depende exclusivamente de la aprobación por escrito del cliente (cláusula 3.3). no es posible completar fases unilateralmente.",
      {
        eyebrow: "panel interno del estudio",
        footerUrl: currentManageUrl,
        footerLabel: "volver a la fase",
      }
    ),
    400
  );
}

// ── REVISIÓN, SOLICITUD DE AJUSTES Y APROBACIÓN ESCRITA POR EL CLIENTE (/approve-phase) ──
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
    const isCompleted = proj.status === "done" || checkAllServicesApproved(proj);
    const completedInfo = isCompleted && A.completed ? A.completed : A.already;
    let reviewBtn = "";
    if (isCompleted) {
      const revUrl = await reviewUrl(env, p);
      if (revUrl) {
        reviewBtn = `<a class="btn" href="${esc(revUrl)}" style="margin-bottom:.75rem;">${esc(PG[L].common?.openReview || "dejar valoración del proyecto")}</a>`;
      }
    }
    return htmlResponse(
      page(completedInfo[0], completedInfo[1], completedInfo[2], {
        lang: L,
        eyebrow: A.eyebrow,
        html: `${reviewBtn}<a class="btn secondary" href="${esc(trackingUrl)}">${esc(PG[L].common.openTracker)}</a>`,
        footerUrl: trackingUrl,
        footerLabel: PG[L].common.openTracker,
      }),
      200
    );
  }

  const maxRevs = ph.maxRevisions || MAX_PHASE_REVISIONS;
  const used = Math.min(maxRevs, Math.max(0, Number(ph.revisionsUsed) || 0));
  const nextRound = used + 1;

  if (ph.status === "active" && used > 0) {
    return htmlResponse(
      page(A.revWorking[0], A.revWorking[1], A.revWorking[2](used, maxRevs), {
        lang: L,
        eyebrow: A.eyebrow,
        html: `<a class="btn" href="${esc(trackingUrl)}">${esc(PG[L].common.openTracker)}</a>`,
        footerUrl: trackingUrl,
        footerLabel: PG[L].common.openTracker,
      }),
      200
    );
  }

  const renderReviewScreen = (revError = "", statusCode = 200) => {
    const unlockedBanner =
      url.searchParams.get("unlocked") === "1" ? `<div class="banner-ok">${esc(A.unlockedBanner)}</div>` : "";

    const detailHtml =
      ph.note || ph.deliverableUrl || used > 0 || unlockedBanner
        ? `<div class="box">
            ${unlockedBanner}
            ${ph.note ? `<p style="font-size:.84rem;color:#17171A;margin-bottom:${ph.deliverableUrl || used > 0 ? ".75rem" : "0"};white-space:pre-wrap;"><strong>${esc(T.studioNote)}:</strong> ${esc(ph.note)}</p>` : ""}
            ${ph.deliverableUrl ? `<a class="pill-link" href="${esc(ph.deliverableUrl)}" target="_blank" rel="noopener noreferrer">${esc(ph.deliverableFilename ? `${A.deliverable} (${ph.deliverableFilename})` : A.deliverable)}</a>` : ""}
            ${used > 0 ? `<p style="font-size:.75rem;color:#58575E;margin-top:${ph.deliverableUrl ? ".65rem" : "0"};">${esc(A.roundsUsed(used, maxRevs))}</p>` : ""}
          </div>`
        : "";

    const canRevise = ph.status === "review" && used < maxRevs;
    const reviseHtml = canRevise
      ? `<details class="rev-details"${revError ? " open" : ""}>
          <summary class="btn secondary">${esc(A.revToggle(nextRound, maxRevs))}</summary>
          <div class="rev-body">
            ${revError ? `<p class="rev-err">${esc(revError)}</p>` : ""}
            <form method="POST">
              <input type="hidden" name="decision" value="revise">
              <label for="feedback">${esc(A.revLabel(nextRound, maxRevs))}</label>
              <textarea id="feedback" name="feedback" rows="4" minlength="5" maxlength="1500" required placeholder="${esc(A.revPh)}"></textarea>
              <button type="submit">${esc(A.revSubmit(nextRound, maxRevs))}</button>
            </form>
          </div>
        </details>`
      : used >= maxRevs
        ? `<div class="box" style="margin-top:.85rem;margin-bottom:.85rem;font-size:.82rem;color:#58575E;">
            <p style="margin-bottom:.75rem;">${esc(A.revExhausted)}</p>
            ${revError ? `<p class="rev-err" style="margin-bottom:.75rem;">${esc(revError)}</p>` : ""}
            <form method="POST">
              <input type="hidden" name="decision" value="buy_revision">
              <button type="submit" class="btn secondary">${esc(A.btnBuyRevision)} (+100 €)</button>
            </form>
          </div>`
        : "";

    const bodyHtml = `${detailHtml}<p class="lead" style="font-size:.82rem;margin-bottom:1.25rem;">${esc(A.legal)}</p><form method="POST"><input type="hidden" name="decision" value="approve"><button type="submit">${esc(A.btn)}</button></form>${reviseHtml}`;

    return htmlResponse(
      page(A.title, A.heading, A.intro(phaseTitle(ph, L), proj.brand), {
        lang: L,
        eyebrow: A.eyebrow,
        html: bodyHtml,
        footerUrl: trackingUrl,
        footerLabel: PG[L].common.openTracker,
      }),
      statusCode
    );
  };

  if (request.method === "GET" || request.method === "HEAD") {
    const revSessionId = url.searchParams.get("rev_session_id");
    if (revSessionId && /^cs_[A-Za-z0-9_]+$/.test(revSessionId)) {
      const unlocked = await unlockExtraRevision(env, proj, step, revSessionId);
      if (unlocked) {
        return redirectTo(buildUrl("/approve-phase", { p, step: String(step), t, unlocked: "1" }));
      }
    }
    return renderReviewScreen();
  }

  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
  }

  if (ph.status !== "review") {
    if (ph.status === "done") {
      const isCompleted = proj.status === "done" || proj.phases.every((item) => item.status === "done");
      const completedInfo = isCompleted ? A.doneLast : A.donePhase(phaseTitle(ph, L));
      let reviewBtn = "";
      if (isCompleted) {
        const revUrl = await reviewUrl(env, p);
        if (revUrl) {
          reviewBtn = `<a class="btn" href="${esc(revUrl)}" style="margin-bottom:.75rem;">${esc(PG[L].common?.openReview || "dejar valoración del proyecto")}</a>`;
        }
      }
      return htmlResponse(
        page(completedInfo[0], completedInfo[1], completedInfo[2], {
          lang: L,
          eyebrow: A.eyebrow,
          html: `${reviewBtn}<a class="btn secondary" href="${esc(trackingUrl)}">${esc(PG[L].common.openTracker)}</a>`,
          footerUrl: trackingUrl,
          footerLabel: PG[L].common.openTracker,
        }),
        200
      );
    }
    if (ph.status === "active" && used > 0) {
      return htmlResponse(
        page(A.revWorking[0], A.revWorking[1], A.revWorking[2](used, maxRevs), {
          lang: L,
          eyebrow: A.eyebrow,
          html: `<a class="btn" href="${esc(trackingUrl)}">${esc(PG[L].common.openTracker)}</a>`,
          footerUrl: trackingUrl,
          footerLabel: PG[L].common.openTracker,
        }),
        200
      );
    }
    return redirectTo(trackingUrl);
  }

  const form = await request.formData().catch(() => null);
  const decision = String(form?.get("decision") || "approve");

  if (decision === "buy_revision") {
    const qJoin = String.fromCharCode(38);
    const returnUrl = `${WORKER_URL}/approve-phase?p=${p}${qJoin}step=${step}${qJoin}t=${t}${qJoin}rev_session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${WORKER_URL}/approve-phase?p=${p}${qJoin}step=${step}${qJoin}t=${t}`;
    const checkoutUrl = await createExtraRevisionCheckout(env, proj, step, returnUrl, cancelUrl);
    if (!checkoutUrl) {
      return renderReviewScreen(A.stripeError, 500);
    }
    return redirectTo(checkoutUrl);
  }

  if (decision === "revise") {
    if (ph.status !== "review" || used >= maxRevs) {
      return renderReviewScreen("", 400);
    }
    const feedback = cleanNote(form?.get("feedback") ?? "", 1500);
    if (!feedback || feedback.length < 5) {
      return renderReviewScreen(A.revEmpty, 400);
    }

    const now = new Date().toISOString();
    const round = nextRound;
    const phaseTitleEs = phaseTitle(ph, "es");
    const manageUrl = await advancePhaseUrl(env, p, step);

    try {
      await resendSend(
        env,
        {
          to: ["hola@rebrandyourbrand.es"],
          reply_to: proj.clientEmail,
          subject: `ajustes solicitados (ronda ${round} de ${maxRevs}) — "${phaseTitleEs}" — ${proj.brand}`,
          ...renderEmail("es", {
            paras: [
              "el cliente ha solicitado ajustes directamente desde la página de revisión de fase.",
              lines(
                `— proyecto: ${bold(proj.brand)}`,
                `— cliente: ${bold(proj.clientEmail)}`,
                `— fase: ${bold(`paso ${ph.step} — ${phaseTitleEs}`)}`,
                `— ronda consumida: ${bold(`ronda ${round} de ${maxRevs}`)}`,
                `— fecha (iso): ${bold(now)}`
              ),
              "cambios solicitados por el cliente:",
            ],
            quote: feedback,
            cta: { label: "abrir panel de la fase para subir nueva versión", url: manageUrl },
            secondaryLink: { label: "ver seguimiento público del cliente", url: trackingUrl },
            note:
              round >= maxRevs
                ? "esta ha sido la última ronda incluida en esta fase. el cliente puede desbloquear rondas adicionales directamente por 100 € (cláusula 1.2)."
                : "cuando tengas lista la propuesta ajustada, vuelve a enviarla a revisión desde el panel de la fase.",
          }),
        },
        `revise-admin-${p}-${step}-r${round}`
      );
    } catch (e) {
      console.error("revision request email failed:", e?.message);
      return errorPage(L);
    }

    ph.revisionsUsed = round;
    if (!Array.isArray(ph.revisions)) ph.revisions = [];
    ph.revisions.push({ round, text: feedback, requestedAt: now });
    ph.status = "active";
    ph.lastRevisionAt = now;
    delete ph.reminderSentAt;
    delete ph.tacitAlertSentAt;
    delete proj.abandonWarningSentAt;
    await saveProject(env, p, proj);

    const noticeText = PG[L].tr?.actionRegisteredNotice || "aviso: esta acción ya ha quedado registrada en el sistema y nuestro equipo ha recibido la notificación para continuar con el trabajo.";
    return htmlResponse(
      page(A.revDone[0], A.revDone[1], A.revDone[2](round, maxRevs), {
        lang: L,
        eyebrow: A.eyebrow,
        html: `<div class="notice-box"><p>${esc(noticeText)}</p></div><a class="btn" href="${esc(trackingUrl)}">${esc(PG[L].common.openTracker)}</a>`,
        footerUrl: trackingUrl,
        footerLabel: PG[L].common.openTracker,
      }),
      200
    );
  }

  const res = await completeProjectPhase(env, proj, p, {
    step,
    approvedBy: "client",
    deliverableUrl: ph.deliverableUrl || "",
    deliverableFilename: ph.deliverableFilename || "",
    note: ph.note || "",
  });

  if (!res.ok && res.reason === "email_failed") return errorPage(L);

  const noticeText = PG[L].tr?.actionRegisteredNotice || "aviso: esta acción ya ha quedado registrada en el sistema y nuestro equipo ha recibido la notificación para continuar con el trabajo.";
  const succ = res.finished && A.completed ? A.completed : A.done;
  let reviewBtn = "";
  if (res.finished) {
    const revUrl = await reviewUrl(env, p);
    if (revUrl) {
      reviewBtn = `<a class="btn" href="${esc(revUrl)}" style="margin-bottom:.75rem;">${esc(PG[L].common?.openReview || "dejar valoración del proyecto")}</a>`;
    }
  }
  return htmlResponse(
    page(succ[0], succ[1], succ[2], {
      lang: L,
      eyebrow: A.eyebrow,
      html: `<div class="notice-box"><p>${esc(noticeText)}</p></div>${reviewBtn}<a class="btn secondary" href="${esc(trackingUrl)}">${esc(PG[L].common.openTracker)}</a>`,
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

  const hasWeb = Boolean(
    proj.includesWeb || (Array.isArray(proj.services) && proj.services.includes("web"))
  );
  if (!proj.paid || !hasWeb) {
    return msgPage(L, "trackInvalid", 400);
  }

  const currentDue = String(proj.renewalNextDue || proj.nextRenewalAt || "");
  if (due && currentDue && due !== currentDue && due !== String(proj.nextRenewalAt || "") && due !== String(proj.renewalNextDue || "")) {
    return msgPage(L, "trackInvalid", 400);
  }

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
  await saveProject(env, p, proj);
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

// ── REDIRECCIÓN PERSISTENTE DE RENOVACIÓN (/renovar) ──
async function handleRenewalRedirect(request, env, url) {
  let L = langFromRequest(request);
  const p = url.searchParams.get("p");
  const t = url.searchParams.get("t");
  if (!p || !/^[a-f0-9]{64}$/.test(p) || !t || !/^[a-f0-9]{64}$/.test(t)) {
    return msgPage(L, "invalid", 400);
  }
  const key = await getKey(env);
  if (!(await verifyRaw(key, `renew|${p}`, t))) {
    return msgPage(L, "invalid", 400);
  }
  if (!env.LEADS_KV) return msgPage(L, "config", 500);
  const raw = await env.LEADS_KV.get(`project:${p}`);
  if (!raw) return msgPage(L, "trackMissing", 404);
  const proj = JSON.parse(raw);
  L = pickLang(proj.lang);
  if (!proj.paid || !Array.isArray(proj.services) || !proj.services.includes("web")) {
    return msgPage(L, "invalid", 400);
  }

  const now = Date.now();
  if (
    proj.renewalCheckoutUrl &&
    proj.renewalCheckoutCreatedAt &&
    now - Number(proj.renewalCheckoutCreatedAt) < 20 * 3600 * 1000
  ) {
    return redirectTo(proj.renewalCheckoutUrl);
  }

  const rawRenewal =
    env.WEB_RENEWAL_EUR !== undefined && String(env.WEB_RENEWAL_EUR).trim() !== ""
      ? Number(env.WEB_RENEWAL_EUR)
      : WEB_RENEWAL_EUR;
  const renewalEur = Number.isFinite(rawRenewal) && rawRenewal >= 0 ? rawRenewal : WEB_RENEWAL_EUR;
  const checkoutUrl = await createRenewalCheckout(env, proj, renewalEur);
  if (!checkoutUrl) {
    return paymentRetryPage(L);
  }

  proj.renewalCheckoutUrl = checkoutUrl;
  proj.renewalCheckoutCreatedAt = now;
  await saveProject(env, p, proj);

  return redirectTo(checkoutUrl);
}

// ── DESCARGA DIRECTA DE ENTREGABLES (/file) ──
async function handleFileDownload(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  const p = url.searchParams.get("p");
  const step = String(url.searchParams.get("step") || "").trim();
  const id = url.searchParams.get("id");
  const t = url.searchParams.get("t");

  if (
    !p ||
    !/^[a-f0-9]{64}$/.test(p) ||
    !step ||
    !/^[a-zA-Z0-9_-]{1,32}$/.test(step) ||
    !id ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(id) ||
    !t ||
    !/^[a-f0-9]{64}$/.test(t)
  ) {
    return new Response("parámetros de archivo incompletos o inválidos", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" },
    });
  }

  const key = await getKey(env);
  if (!(await verifyRaw(key, `file|${p}|${step}|${id}`, t))) {
    return new Response("enlace de archivo no válido o firma incorrecta", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" },
    });
  }

  if (!env.LEADS_KV) {
    return new Response("error de configuración en el servidor", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" },
    });
  }

  const { value, metadata } = await env.LEADS_KV.getWithMetadata(`file:${p}:${step}:${id}`, {
    type: "arrayBuffer",
  });

  if (!value) {
    return new Response("archivo no encontrado o expirado", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" },
    });
  }

  const fallbackName = step === "mat" ? "material" : (step === "ref" ? "referencia" : `entregable-fase-${step}`);
  const filename = metadata?.filename || fallbackName;
  const safeName = safeFilename(filename, fallbackName);
  const contentType = metadata?.contentType || "application/octet-stream";
  const size = metadata?.size || value.byteLength;
  const encodedName = encodeURIComponent(safeName);

  const SAFE_INLINE_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "application/pdf",
  ]);
  const dispositionType = SAFE_INLINE_TYPES.has(contentType.toLowerCase()) ? "inline" : "attachment";

  return new Response(value, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${dispositionType}; filename="${safeName.replace(/["\r\n\\]/g, "_")}"; filename*=UTF-8''${encodedName}`,
      "Content-Length": String(size),
      "Cache-Control": "private, max-age=86400",
      "Content-Security-Policy": "sandbox",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

async function checkProjectChatRateLimit(env, token, ip) {
  if (env.CHAT_LIMITER) {
    const { success } = await env.CHAT_LIMITER.limit({ key: `pc:${token.slice(0, 16)}:${ipKey(ip)}` });
    if (!success) return false;
  }
  if (env.LEADS_KV) {
    const rlKey = `rl:pchat:${token}:${ipKey(ip)}`;
    const current = await env.LEADS_KV.get(rlKey);
    const count = current ? parseInt(current, 10) : 0;
    if (count >= 12) return false;
    await env.LEADS_KV.put(rlKey, String(count + 1), { expirationTtl: 600 });
  }
  return true;
}

// Envío diferido de notificación de materiales cuando finaliza el timer o se pulsa la X
async function flushPendingMaterialsNotice(env, token, proj) {
  if (!proj || !proj.pendingMaterialsNotice) return;
  const notice = proj.pendingMaterialsNotice;
  delete proj.pendingMaterialsNotice;

  const matItem = Array.isArray(proj.materialsList) ? proj.materialsList.find((m) => m && m.id === notice.matId) : null;
  const refItem = Array.isArray(proj.referencesList) ? proj.referencesList.find((r) => r && r.id === notice.refId) : null;

  await saveProject(env, token, proj);

  if (!env.RESEND_API_KEY || (!matItem && !refItem)) {
    return;
  }

  const projectPageUrl = buildUrl("/proyecto", { token });
  const manageUrl = await advancePhaseUrl(env, token, proj.currentPhase || 1);
  const addedLines = [];

  if (matItem) {
    addedLines.push(bold("materiales del negocio aportados:"));
    if (matItem.domain) addedLines.push(`— dominio: ${bold(matItem.domain)}`);
    if (matItem.socials) addedLines.push(`— web / redes: ${bold(matItem.socials)}`);
    if (matItem.url) addedLines.push(`— enlace externo: <a href="${esc(matItem.url)}" target="_blank" style="color:#3D5A85;font-weight:600;">${esc(matItem.url)}</a>`);
    let fileLink = "";
    if (matItem.fileId) fileLink = await fileDownloadUrl(env, token, "mat", matItem.fileId);
    else if (matItem.fileUrl) fileLink = matItem.fileUrl;
    if (fileLink) addedLines.push(`— archivo directo: <a href="${esc(fileLink)}" target="_blank" style="color:#3D5A85;font-weight:600;">${esc(matItem.filename || "descargar archivo")}</a>`);
    if (matItem.notes) addedLines.push(`— notas: ${esc(matItem.notes)}`);
  }

  if (refItem) {
    if (addedLines.length) addedLines.push("");
    addedLines.push(bold("referencias visuales e inspiración:"));
    if (refItem.url) addedLines.push(`— enlace de referencia: <a href="${esc(refItem.url)}" target="_blank" style="color:#3D5A85;font-weight:600;">${esc(refItem.url)}</a>`);
    let refFileLink = "";
    if (refItem.fileId) refFileLink = await fileDownloadUrl(env, token, "ref", refItem.fileId);
    else if (refItem.fileUrl) refFileLink = refItem.fileUrl;
    if (refFileLink) addedLines.push(`— captura o imagen: <a href="${esc(refFileLink)}" target="_blank" style="color:#3D5A85;font-weight:600;">${esc(refItem.filename || "descargar referencia")}</a>`);
    if (refItem.notes) addedLines.push(`— qué le gusta: ${esc(refItem.notes)}`);
  }

  const subjectType = matItem && refItem
    ? "nuevos materiales y referencias recibidos"
    : (refItem ? "nuevas referencias visuales recibidas" : "nuevos materiales recibidos");

  await resendSend(
    env,
    {
      to: ["hola@rebrandyourbrand.es"],
      reply_to: proj.clientEmail,
      subject: `${subjectType} — ${proj.brand}`,
      ...renderEmail("es", {
        paras: [
          `el cliente ha aportado nueva información para ${bold(proj.brand)}.`,
          `— cliente: ${bold(proj.clientEmail)}`,
          ...addedLines,
        ],
        cta: { label: "abrir gestión de la fase actual", url: manageUrl },
        secondaryLink: { label: "ver seguimiento del cliente", url: projectPageUrl },
      }),
    },
    `materials-${token}-${notice.timestamp}`
  ).catch((e) => console.error("materials email failed:", e?.message));
}

// ── SEGUIMIENTO DEL PROYECTO, RESCATE DE PAGO Y ONBOARDING (/proyecto) ──
async function handleProject(request, env, url) {
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  let L = langFromRequest(request);
  const token = url.searchParams.get("token");
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return msgPage(L, "trackInvalid", 404);
  }
  if (!env.LEADS_KV) return msgPage(L, "config", 500);

  const raw = await env.LEADS_KV.get(`project:${token}`);
  if (!raw) return msgPage(L, "trackMissing", 404);

  let proj = JSON.parse(raw);
  if (proj.pendingMaterialsNotice && Date.now() - (Number(proj.pendingMaterialsNotice.timestamp) || 0) >= 60000) {
    await flushPendingMaterialsNotice(env, token, proj);
  }
  L = pickLang(proj.lang);
  const T = PG[L].tr;
  const projectPageUrl = buildUrl("/proyecto", { token });
  const allDone = proj.status === "done" || (Array.isArray(proj.phases) && proj.phases.length > 0 && proj.phases.every((ph) => ph.status === "done"));
  const hasWeb = Array.isArray(proj.services) && proj.services.includes("web");

  if (request.method === "POST") {
    let bodyJson = null;
    let form = null;
    const cType = request.headers.get("Content-Type") || "";
    if (cType.includes("application/json")) {
      bodyJson = await request.json().catch(() => null);
    } else {
      form = await request.formData().catch(() => null);
    }
    const op = String(bodyJson?.op || form?.get("op") || (!proj.paid ? "pay" : ""));

    if (op === "brandi_chat") {
      const okRate = await checkProjectChatRateLimit(env, token, ip);
      if (!okRate) {
        if (bodyJson) return jsonResponse({ error: "rate_limited" }, 429);
        return redirectTo(projectPageUrl + "#chat");
      }
      const msgText = cleanInput(bodyJson?.message || form?.get("message") || "", 1000);
      if (!msgText) {
        if (bodyJson) return jsonResponse({ error: "empty_message" }, 400);
        return redirectTo(projectPageUrl + "#chat");
      }
      const key = await getKey(env);
      const rawHistory = Array.isArray(bodyJson?.history) ? bodyJson.history : [];
      const checkedHistory = (
        await Promise.all(
          rawHistory.slice(-12).map(async (m) => {
            if (!m || typeof m.text !== "string") return null;
            if (m.role === "user") {
              const text = m.text.trim().slice(0, 600);
              return text ? { role: "user", text } : null;
            }
            if (m.role === "assistant" && typeof m.sig === "string" && (await verifyMsg(key, m.text, m.sig))) {
              return { role: "assistant", text: m.text.trim().slice(0, 600), sig: m.sig };
            }
            return null;
          })
        )
      ).filter(Boolean);
      checkedHistory.push({ role: "user", text: msgText.slice(0, 600) });

      const reply = await askGroqProject(env, L, proj, checkedHistory);
      const sig = await signMsg(key, reply);
      if (bodyJson) {
        return jsonResponse({ ok: true, reply, sig }, 200);
      }
      return redirectTo(projectPageUrl + "#chat");
    }

    if (op === "human_chat") {
      const okRate = await checkProjectChatRateLimit(env, token, ip);
      if (!okRate) {
        if (bodyJson) return jsonResponse({ error: "rate_limited" }, 429);
        return redirectTo(projectPageUrl + "#chat-human");
      }
      const msgText = cleanInput(bodyJson?.message || form?.get("message") || "", 2000);
      if (!msgText) {
        if (bodyJson) return jsonResponse({ error: "empty_message" }, 400);
        return redirectTo(projectPageUrl + "#chat-human");
      }

      const chatKey = `project_chat:${token}`;
      const chatList = (await env.LEADS_KV.get(chatKey, { type: "json" })) || [];
      let translatedToEs = null;
      if (L !== "es" && env.GROQ_API_KEY) {
        try {
          translatedToEs = await translateMessageText(env, msgText, L, "es");
        } catch (e) {
          console.warn("translateMessageText to es failed:", e?.message);
        }
      }

      const msgId = randomHex(8);
      const newMsg = {
        id: msgId,
        sender: "client",
        text: msgText,
        date: new Date().toISOString(),
        ...(translatedToEs && translatedToEs !== msgText ? { translations: { es: translatedToEs } } : {}),
      };
      chatList.push(newMsg);
      const cappedHistory = chatList.slice(-100);
      await env.LEADS_KV.put(chatKey, JSON.stringify(cappedHistory));

      if (env.RESEND_API_KEY) {
        const studioUrl = await studioChatUrl(env, token);
        const quoteForStudio = translatedToEs && translatedToEs !== msgText
          ? `${translatedToEs}\n\n(original en ${L}: ${msgText})`
          : msgText;
        try {
          await resendSend(
            env,
            {
              to: ["hola@rebrandyourbrand.es"],
              reply_to: proj.clientEmail,
              subject: `nuevo mensaje de ${proj.brand} en el chat del proyecto`,
              ...renderEmail("es", {
                paras: [
                  `el cliente de ${bold(proj.brand)} (${proj.clientEmail}) ha escrito un nuevo mensaje en el chat directo del proyecto:`,
                ],
                quote: quoteForStudio,
                cta: { label: "responder al cliente", url: studioUrl },
                secondaryLink: { label: "ver panel del proyecto", url: projectPageUrl },
              }),
            },
            `chat-studio-alert-${token}-${msgId}`
          );
        } catch (e) {
          console.error("chat studio alert failed:", e?.message);
        }

        const emChat = EM[L].chat;
        try {
          await resendSend(
            env,
            {
              to: [proj.clientEmail],
              reply_to: "hola@rebrandyourbrand.es",
              subject: emChat.confirmSubject(proj.brand),
              ...renderEmail(L, {
                paras: [
                  emChat.hello,
                  emChat.confirmReceived(bold(proj.brand)),
                  emChat.confirmSoon,
                ],
                quote: msgText,
                cta: { label: emChat.viewPortal, url: projectPageUrl + "#chat" },
              }),
            },
            `chat-client-confirm-${token}-${msgId}`
          );
        } catch (e) {
          console.error("chat client confirm failed:", e?.message);
        }
      }

      if (bodyJson) {
        return jsonResponse({ ok: true, message: newMsg }, 200);
      }
      return redirectTo(projectPageUrl + "?msg_sent=1#chat");
    }

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

    if (op === "extra_work") {
      if (!allDone) return redirectTo(projectPageUrl);
      const notes = cleanNote(form?.get("notes") || bodyJson?.notes || "", 1500);
      if (!notes || notes.length < 5) {
        return htmlResponse(
          page(T.title, T.heading, T.extraWorkEmpty, {
            lang: L,
            eyebrow: T.extraWorkEyebrow,
            wide: true,
            html: `<p class="lead" style="color:#cf172f;">${esc(T.extraWorkEmpty)}</p><a class="btn" href="${esc(projectPageUrl)}">${esc(PG[L].common.openTracker)}</a>`,
            footerUrl: projectPageUrl,
            footerLabel: PG[L].common.openTracker,
          }),
          400
        );
      }
      proj.pendingExtraWork = { notes, date: Date.now() };
      await saveProject(env, token, proj);

      const qJoin = String.fromCharCode(38);
      const returnUrl = `${WORKER_URL}/proyecto?token=${token}${qJoin}rev_session_id={CHECKOUT_SESSION_ID}${qJoin}extra_done=1`;
      const cancelUrl = `${projectPageUrl}#extra-work`;
      const checkoutUrl = await createExtraRevisionCheckout(env, proj, "post_delivery", returnUrl, cancelUrl, notes);
      if (!checkoutUrl) {
        return msgPage(L, "retry", 502, { form: false, footerUrl: projectPageUrl, footerLabel: PG[L].common.openTracker });
      }
      return redirectTo(checkoutUrl);
    }

    if (op === "onboarding") {
      if (!proj.paid) return redirectTo(projectPageUrl);

      // Normalizar lista de materiales previa excluyendo ítems sintéticos sin contenido
      const existingMaterials = (Array.isArray(proj.materialsList) ? [...proj.materialsList] : []).filter((m) => {
        if (!m) return false;
        if (m.id === "init" && !m.url && !m.fileId && !m.fileUrl && !m.notes && !m.socials) {
          if (m.domain && !proj.domain) proj.domain = m.domain;
          return false;
        }
        return true;
      });
      proj.materialsList = existingMaterials;
      const isFirstSubmission = existingMaterials.length === 0;

      // Bloque 1 — Materiales del negocio:
      const submittedDomain = hasWeb ? cleanInput(form?.get("domain") ?? "", 200) : "";
      const defaultDomain = proj.domain || proj.onboarding?.domain || "";
      const domain = submittedDomain || (isFirstSubmission ? defaultDomain : "");

      if (hasWeb && isFirstSubmission && !domain) {
        return htmlResponse(
          page(T.obDomainMissing[0], T.obDomainMissing[1], T.obDomainMissing[2], {
            lang: L,
            eyebrow: T.obEyebrow,
            html: `<a class="btn" href="${esc(projectPageUrl)}">${esc(PG[L].common.openTracker)}</a>`,
            footerUrl: projectPageUrl,
            footerLabel: PG[L].common.openTracker,
          }),
          400
        );
      }
      if (hasWeb && domain) {
        proj.domain = domain;
        if (proj.onboarding) proj.onboarding.domain = domain;
      }
      const socials = cleanInput(form?.get("socials") ?? "", 250);
      const rawMaterialsUrl = String(form?.get("materials_url") ?? "").trim();
      const materialsUrl = cleanHttpsUrl(rawMaterialsUrl, 500);
      if (rawMaterialsUrl && !materialsUrl) {
        return htmlResponse(
          page(T.obInvalidUrlTitle || "enlace inválido", T.obInvalidUrlHeading || "revisa el enlace proporcionado", T.obInvalidUrlMsg || "los enlaces externos deben usar https://. vuelve atrás y corrígelo o déjalo vacío si subes un archivo directo.", {
            lang: L,
            eyebrow: T.obEyebrow,
            html: `<a class="btn" href="${esc(projectPageUrl)}">${esc(PG[L].common.openTracker)}</a>`,
            footerUrl: projectPageUrl,
            footerLabel: PG[L].common.openTracker,
          }),
          400
        );
      }
      const materialsNotes = cleanNote(form?.get("materials_notes") ?? form?.get("materials") ?? "", 1000);

      let materialsFileDownloadUrl = "";
      let materialsFilename = "";
      let materialsFileId = "";
      let materialsFileSize = 0;
      const matFile = form?.get("materials_file");
      if (
        matFile &&
        typeof matFile === "object" &&
        typeof matFile.arrayBuffer === "function" &&
        matFile.size > 0
      ) {
        if (matFile.size > 25 * 1024 * 1024) {
          return htmlResponse(
            page(T.fileTooLargeTitle || "archivo demasiado grande", T.fileTooLargeHeading || "tamaño de archivo superado", T.fileTooLarge || "el archivo supera el límite de 25 mb admitido para subida directa.", {
              lang: L,
              eyebrow: T.obEyebrow,
              html: `<a class="btn" href="${esc(projectPageUrl)}">${esc(PG[L].common.openTracker)}</a>`,
              footerUrl: projectPageUrl,
              footerLabel: PG[L].common.openTracker,
            }),
            400
          );
        }
        materialsFileId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
        const arrayBuf = await matFile.arrayBuffer();
        materialsFilename = safeFilename(matFile.name, "material-arranque");
        materialsFileSize = matFile.size;
        const contentType = cleanInput(matFile.type, 100) || "application/octet-stream";
        await env.LEADS_KV.put(`file:${token}:mat:${materialsFileId}`, arrayBuf, {
          metadata: {
            filename: materialsFilename,
            contentType,
            size: matFile.size,
            createdAt: new Date().toISOString(),
          },
        });
        materialsFileDownloadUrl = await fileDownloadUrl(env, token, "mat", materialsFileId);
      }

      // Bloque 2 — Referencias visuales:
      const rawRefUrl = String(form?.get("reference_url") ?? "").trim();
      const referenceUrl = cleanHttpsUrl(rawRefUrl, 500);
      if (rawRefUrl && !referenceUrl) {
        return htmlResponse(
          page(T.obInvalidUrlTitle || "enlace inválido", T.obInvalidUrlHeading || "revisa el enlace proporcionado", T.obInvalidUrlMsg || "los enlaces externos deben usar https://. vuelve atrás y corrígelo o déjalo vacío si subes un archivo directo.", {
            lang: L,
            eyebrow: T.obEyebrow,
            html: `<a class="btn" href="${esc(projectPageUrl)}">${esc(PG[L].common.openTracker)}</a>`,
            footerUrl: projectPageUrl,
            footerLabel: PG[L].common.openTracker,
          }),
          400
        );
      }
      const referenceNotes = cleanNote(form?.get("reference_notes") ?? "", 1000);

      let referenceFileDownloadUrl = "";
      let referenceFilename = "";
      let referenceFileId = "";
      let referenceFileSize = 0;
      const refFile = form?.get("reference_file");
      if (
        refFile &&
        typeof refFile === "object" &&
        typeof refFile.arrayBuffer === "function" &&
        refFile.size > 0
      ) {
        if (refFile.size > 25 * 1024 * 1024) {
          return htmlResponse(
            page(T.fileTooLargeTitle || "archivo demasiado grande", T.fileTooLargeHeading || "tamaño de archivo superado", T.fileTooLarge || "el archivo supera el límite de 25 mb admitido para subida directa.", {
              lang: L,
              eyebrow: T.obEyebrow,
              html: `<a class="btn" href="${esc(projectPageUrl)}">${esc(PG[L].common.openTracker)}</a>`,
              footerUrl: projectPageUrl,
              footerLabel: PG[L].common.openTracker,
            }),
            400
          );
        }
        referenceFileId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
        const arrayBuf = await refFile.arrayBuffer();
        referenceFilename = safeFilename(refFile.name, "referencia-visual");
        referenceFileSize = refFile.size;
        const contentType = cleanInput(refFile.type, 100) || "application/octet-stream";
        await env.LEADS_KV.put(`file:${token}:ref:${referenceFileId}`, arrayBuf, {
          metadata: {
            filename: referenceFilename,
            contentType,
            size: refFile.size,
            createdAt: new Date().toISOString(),
          },
        });
        referenceFileDownloadUrl = await fileDownloadUrl(env, token, "ref", referenceFileId);
      }

      const hasDomainChange = Boolean(hasWeb && submittedDomain && submittedDomain !== (defaultDomain || proj.domain));
      const hasRealMaterial = Boolean(hasDomainChange || socials || materialsUrl || materialsNotes || materialsFileDownloadUrl);
      const hasReference = Boolean(referenceUrl || referenceNotes || referenceFileDownloadUrl);

      if (!hasRealMaterial && !hasReference) {
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

      // Migración retrocompatible de onboarding previo a materialsList si no existe:
      if (!Array.isArray(proj.materialsList)) {
        proj.materialsList = [];
        if (proj.onboarding) {
          const ob = proj.onboarding;
          const legacyUrl = cleanHttpsUrl(ob.materials || "", 500);
          proj.materialsList.push({
            id: "legacy",
            createdAt: ob.submittedAt || ob.receivedAt || proj.createdAt || new Date().toISOString(),
            domain: ob.domain || "",
            socials: ob.socials || "",
            notes: legacyUrl ? "" : (ob.materials || ""),
            url: legacyUrl || "",
            fileUrl: "",
            filename: "",
          });
        }
      }
      if (!Array.isArray(proj.referencesList)) {
        proj.referencesList = [];
      }

      const nowIso = new Date().toISOString();
      let createdMatItem = null;
      let createdRefItem = null;

      const hasMaterial = Boolean((hasWeb && (submittedDomain || isFirstSubmission)) || hasRealMaterial);

      if (hasMaterial) {
        createdMatItem = {
          id: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
          createdAt: nowIso,
          domain: submittedDomain || (isFirstSubmission ? domain : ""),
          socials,
          url: materialsUrl,
          notes: materialsNotes,
          fileUrl: materialsFileDownloadUrl,
          filename: materialsFilename,
          fileId: materialsFileId,
          fileSize: materialsFileSize,
        };
        proj.materialsList.push(createdMatItem);
        if (!proj.onboarding) {
          proj.onboarding = {
            domain: proj.domain || domain || "",
            socials: socials || "",
            materials: materialsUrl || materialsNotes || materialsFilename || "",
            submittedAt: nowIso,
          };
        }
      }

      if (hasReference) {
        createdRefItem = {
          id: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
          createdAt: nowIso,
          url: referenceUrl,
          notes: referenceNotes,
          fileUrl: referenceFileDownloadUrl,
          filename: referenceFilename,
          fileId: referenceFileId,
          fileSize: referenceFileSize,
        };
        proj.referencesList.push(createdRefItem);
      }

      proj.lastAdded = {
        matId: createdMatItem?.id || null,
        matFileId: createdMatItem?.fileId || null,
        refId: createdRefItem?.id || null,
        refFileId: createdRefItem?.fileId || null,
        timestamp: Date.now(),
      };
      proj.pendingMaterialsNotice = {
        matId: createdMatItem?.id || null,
        refId: createdRefItem?.id || null,
        timestamp: Date.now(),
      };
      delete proj.draft;
      if (hasMaterial || hasReference) {
        delete proj.abandonWarningSentAt;
      }

      await saveProject(env, token, proj);

      // Envío diferido: no se envía el correo al estudio hasta que expire el timer (60s) o el cliente pulse la X
      return redirectTo(buildUrl("/proyecto", { token, undo: "1" }));
    }

    if (op === "confirm_materials") {
      if (proj.pendingMaterialsNotice) {
        await flushPendingMaterialsNotice(env, token, proj);
      }
      proj.lastAdded = null;
      await saveProject(env, token, proj);
      const isJson = request.headers.get("Accept")?.includes("application/json") || request.headers.get("X-Requested-With");
      if (isJson) {
        return jsonResponse({ ok: true }, 200);
      }
      return redirectTo(projectPageUrl);
    }

    if (op === "undo_onboarding") {
      if (!proj.paid) return redirectTo(projectPageUrl);
      if (proj.lastAdded) {
        const { matId, matFileId, refId, refFileId } = proj.lastAdded;
        const undoneMat = Array.isArray(proj.materialsList) ? proj.materialsList.find((m) => m.id === matId) : null;
        const undoneRef = Array.isArray(proj.referencesList) ? proj.referencesList.find((r) => r.id === refId) : null;

        // Guardar borrador para restaurar en el formulario exactamente lo que el usuario tenía antes de enviar:
        proj.draft = {
          domain: undoneMat?.domain || proj.domain || "",
          socials: undoneMat?.socials || "",
          materials_url: undoneMat?.url || "",
          materials_notes: undoneMat?.notes || "",
          materials_filename: undoneMat?.filename || "",
          reference_url: undoneRef?.url || "",
          reference_notes: undoneRef?.notes || "",
          reference_filename: undoneRef?.filename || "",
        };

        if (matId && Array.isArray(proj.materialsList)) {
          proj.materialsList = proj.materialsList.filter((m) => m.id !== matId);
        }
        if (matFileId) {
          await env.LEADS_KV.delete(`file:${token}:mat:${matFileId}`).catch(() => {});
        }
        if (refId && Array.isArray(proj.referencesList)) {
          proj.referencesList = proj.referencesList.filter((r) => r.id !== refId);
        }
        if (refFileId) {
          await env.LEADS_KV.delete(`file:${token}:ref:${refFileId}`).catch(() => {});
        }
        if (proj.onboarding && (!Array.isArray(proj.materialsList) || proj.materialsList.length === 0)) {
          delete proj.onboarding;
        }
        delete proj.pendingMaterialsNotice;
        proj.lastAdded = null;
        await saveProject(env, token, proj);

        // Sin correo de cancelación: el estudio no fue notificado previamente, eliminando correos inútiles
      }
      return redirectTo(buildUrl("/proyecto", { token, undone: "1" }));
    }

    return redirectTo(projectPageUrl);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
  }

  const receiptCheckedAt = Number(proj.receiptCheckedAt) || 0;
  const shouldCheckReceipt = !proj.receiptUrl && (!receiptCheckedAt || (Date.now() - receiptCheckedAt > 10 * 60 * 1000));
  if (!proj.paid || !proj.emailsSent || shouldCheckReceipt) {
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
      if (!proj.receiptUrl) {
        proj.receiptCheckedAt = Date.now();
        await saveProject(env, token, proj);
      }
    }
  }

  const revSessionId = url.searchParams.get("rev_session_id");
  if (revSessionId && /^cs_[A-Za-z0-9_]+$/.test(revSessionId)) {
    const stepParam = url.searchParams.get("step") || "post_delivery";
    await unlockExtraRevision(env, proj, stepParam, revSessionId);
    const freshProjRaw = await env.LEADS_KV.get(`project:${token}`);
    if (freshProjRaw) proj = JSON.parse(freshProjRaw);
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

  const extraDoneBanner =
    url.searchParams.get("extra_done") === "1"
      ? `<div class="banner-ok">${esc(T.extraWorkSuccess)}</div>`
      : "";

  const undoneBanner =
    url.searchParams.get("undone") === "1"
      ? `<div class="banner-ok">${esc(T.obUndoneBanner)}</div>`
      : extraDoneBanner;

  const bannerHtml =
    url.searchParams.get("ob") === "1"
      ? `<div class="banner-ok">${esc(T.obSentBanner)}</div>`
      : undoneBanner;

  const undoHtml =
    url.searchParams.get("undo") === "1" && proj.lastAdded && Date.now() - proj.lastAdded.timestamp < 60000
      ? `
      <div class="undo-bar-wrap" id="undo-bar">
        <div class="undo-bar-content">
          <form method="POST" id="undo-dismiss-form" style="margin:0;padding:0;display:inline;">
            <input type="hidden" name="op" value="confirm_materials">
            <button type="submit" class="btn-dismiss" id="undo-dismiss-btn" aria-label="${esc(T.obDismissBtn)}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </form>
          <div class="undo-bar-text">
            <svg class="undo-ring" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <circle class="undo-ring-bg" cx="12" cy="12" r="9" fill="none" stroke-width="2.5"></circle>
              <circle class="undo-ring-stroke" cx="12" cy="12" r="9" fill="none" stroke-width="2.5"></circle>
            </svg>
            <span>${esc(T.obUndoBanner)}</span>
          </div>
          <div class="undo-bar-actions">
            <form method="POST" style="margin:0;padding:0;display:inline;">
              <input type="hidden" name="op" value="undo_onboarding">
              <button type="submit" class="btn-undo">${esc(T.obUndoBtn)}</button>
            </form>
          </div>
        </div>
      </div>
      <script>
        (function(){
          var bar = document.getElementById("undo-bar");
          if (!bar) return;
          if (bar.parentElement !== document.body) {
            document.body.appendChild(bar);
          }
          var confirmed = false;
          var confirmAndDismiss = function(e){
            if (e && e.preventDefault) e.preventDefault();
            if (confirmed) return;
            confirmed = true;
            try {
              fetch("${esc(projectPageUrl)}", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
                body: "op=confirm_materials"
              }).catch(function(){});
            } catch(err){}
            bar.classList.add("is-dismissed");
            setTimeout(function(){
              if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
            }, 360);
          };

          var btn = document.getElementById("undo-dismiss-btn");
          if (btn) btn.addEventListener("click", confirmAndDismiss);
          window.addEventListener("keydown", function(e){
            if (e.key === "Escape" || e.keyCode === 27) confirmAndDismiss();
          });
          setTimeout(function(){
            confirmAndDismiss();
          }, 60000);
        })();
      </script>`
      : "";

  // allDone ya declarado arriba en handleProject

  // Normalizar lista de materiales y referencias (modo append-only, filtrando init vacíos)
  const materialsList = (Array.isArray(proj.materialsList) ? [...proj.materialsList] : []).filter((m) => {
    if (!m) return false;
    if (m.id === "init" && !m.url && !m.fileId && !m.fileUrl && !m.notes && !m.socials) {
      if (m.domain && !proj.domain) proj.domain = m.domain;
      return false;
    }
    return true;
  });
  if (proj.onboarding && materialsList.length === 0) {
    const ob = proj.onboarding;
    const legacyUrl = cleanHttpsUrl(ob.materials || "", 500);
    const hasRealContent = Boolean(legacyUrl || ob.socials || ob.materials || ob.notes);
    if (hasRealContent) {
      materialsList.push({
        id: "legacy",
        createdAt: ob.submittedAt || ob.receivedAt || proj.createdAt || "",
        domain: ob.domain || "",
        socials: ob.socials || "",
        notes: legacyUrl ? "" : (ob.materials || ""),
        url: legacyUrl || "",
        fileUrl: "",
        filename: "",
      });
    } else if (ob.domain && !proj.domain) {
      proj.domain = ob.domain;
    }
  }
  const referencesList = Array.isArray(proj.referencesList) ? [...proj.referencesList] : [];

  const materialsItemsHtml = await Promise.all(
    materialsList.map(async (m, i) => {
      const dateStr = m.createdAt ? fmtDate(m.createdAt, L) : "";
      const urlLink = cleanHttpsUrl(m.url || "", 500);
      let fileLink = "";
      if (m.fileId) {
        fileLink = await fileDownloadUrl(env, token, "mat", m.fileId);
      } else if (m.fileUrl) {
        fileLink = m.fileUrl;
      }
      return `
        <div class="history-item">
          <div class="history-head">
            <span style="font-size:.78rem;font-weight:600;color:#3D5A85;text-transform:lowercase;">${esc(T.obMaterialsHistory)} #${i + 1}</span>
            ${dateStr ? `<span style="font-size:.74rem;color:#58575E;">${esc(dateStr)}</span>` : ""}
          </div>
          <div class="kv" style="font-size:.82rem;">
            ${hasWeb && m.domain ? `<div class="kv-row"><span>${esc(T.obLblDomain)}</span><span class="kv-val">${esc(m.domain)}</span></div>` : ""}
            ${m.socials ? `<div class="kv-row"><span>${esc(T.obLblSocials)}</span><span class="kv-val">${esc(m.socials)}</span></div>` : ""}
            ${urlLink ? `<div class="kv-row"><span>${esc(T.obMaterialsUrl)}</span><span class="kv-val" style="word-break:break-all;"><a href="${esc(urlLink)}" target="_blank" rel="noopener noreferrer" style="color:#3D5A85;text-decoration:underline;">${esc(urlLink)}</a></span></div>` : ""}
            ${fileLink ? `<div class="kv-row"><span>${esc(T.obMaterialsFile)}</span><span class="kv-val"><a class="pill-link" href="${esc(fileLink)}" target="_blank" rel="noopener noreferrer">${esc(m.filename || T.obFileDownload)}</a></span></div>` : ""}
          </div>
          ${m.notes ? `<div class="phase-note" style="margin-top:.55rem;">${esc(m.notes)}</div>` : ""}
        </div>`;
    })
  );

  const referencesItemsHtml = await Promise.all(
    referencesList.map(async (r, i) => {
      const dateStr = r.createdAt ? fmtDate(r.createdAt, L) : "";
      const urlLink = cleanHttpsUrl(r.url || "", 500);
      let fileLink = "";
      if (r.fileId) {
        fileLink = await fileDownloadUrl(env, token, "ref", r.fileId);
      } else if (r.fileUrl) {
        fileLink = r.fileUrl;
      }
      return `
        <div class="history-item">
          <div class="history-head">
            <span style="font-size:.78rem;font-weight:600;color:#825008;text-transform:lowercase;">${esc(T.obReferencesHistory)} #${i + 1}</span>
            ${dateStr ? `<span style="font-size:.74rem;color:#58575E;">${esc(dateStr)}</span>` : ""}
          </div>
          <div class="kv" style="font-size:.82rem;">
            ${urlLink ? `<div class="kv-row"><span>${esc(T.obRefUrl)}</span><span class="kv-val" style="word-break:break-all;"><a href="${esc(urlLink)}" target="_blank" rel="noopener noreferrer" style="color:#3D5A85;text-decoration:underline;">${esc(urlLink)}</a></span></div>` : ""}
            ${fileLink ? `<div class="kv-row"><span>${esc(T.obRefFile)}</span><span class="kv-val"><a class="pill-link" href="${esc(fileLink)}" target="_blank" rel="noopener noreferrer">${esc(r.filename || T.obFileDownload)}</a></span></div>` : ""}
          </div>
          ${r.notes ? `<div class="phase-note" style="margin-top:.55rem;">${esc(r.notes)}</div>` : ""}
        </div>`;
    })
  );

  const materialsBox = materialsItemsHtml.length
    ? `<div class="box">
        <span class="eyebrow">${esc(T.obMaterialsHistory)}</span>
        ${materialsItemsHtml.join("")}
      </div>`
    : "";

  const referencesBox = referencesItemsHtml.length
    ? `<div class="box">
        <span class="eyebrow">${esc(T.obReferencesHistory)}</span>
        ${referencesItemsHtml.join("")}
      </div>`
    : "";

  let addFormHtml = "";
  if (!allDone) {
    const isFirstSubmission = materialsList.length === 0;
    const defaultDomain = proj.domain || proj.onboarding?.domain || (materialsList.find((m) => m?.domain)?.domain) || "";
    const draft = proj.draft || null;
    const hasDraft = Boolean(draft);

    const domainRequired = hasWeb && isFirstSubmission;
    const domainInputValue = draft?.domain || (isFirstSubmission ? defaultDomain : "");
    const domainPlaceholder = defaultDomain || T.obDomainPh;

    const socialsValue = draft?.socials || "";
    const matUrlValue = draft?.materials_url || "";
    const matNotesValue = draft?.materials_notes || "";
    const refUrlValue = draft?.reference_url || "";
    const refNotesValue = draft?.reference_notes || "";

    const matPrevFileNote = draft?.materials_filename && typeof T.obPrevFile === "function"
      ? `<span class="file-note" style="color:#825008;margin-bottom:.35rem;display:block;">${esc(T.obPrevFile(draft.materials_filename))}</span>`
      : "";
    const refPrevFileNote = draft?.reference_filename && typeof T.obPrevRef === "function"
      ? `<span class="file-note" style="color:#825008;margin-bottom:.35rem;display:block;">${esc(T.obPrevRef(draft.reference_filename))}</span>`
      : "";

    const formFields = `
      <form method="POST" enctype="multipart/form-data" style="text-align:left;">
        <input type="hidden" name="op" value="onboarding">

        <div class="section-subheading">${esc(T.blockAMaterials)}</div>
        ${hasWeb ? `
        <label for="domain">${esc(T.obDomain)}${domainRequired ? ` <span style="color:#cf172f;font-weight:600;">(${esc(T.obDomainRequired)})</span>` : ""}</label>
        <input id="domain" name="domain" type="text" maxlength="200" value="${esc(domainInputValue)}" placeholder="${esc(domainPlaceholder)}" ${domainRequired ? "required" : ""}>` : ""}

        <label for="socials">${esc(T.obSocials)}</label>
        <input id="socials" name="socials" type="text" maxlength="250" value="${esc(socialsValue)}" placeholder="${esc(T.obSocialsPh)}">

        <label for="materials_url">${esc(T.obMaterialsUrl)}</label>
        <input id="materials_url" name="materials_url" type="url" maxlength="500" value="${esc(matUrlValue)}" placeholder="${esc(T.obMaterialsUrlPh)}">

        <label for="materials_file">${esc(T.obMaterialsFile)}</label>
        ${matPrevFileNote}
        <input id="materials_file" name="materials_file" type="file">
        <span class="file-note">${esc(T.obMaterialsFileNote)}</span>

        <label for="materials_notes">${esc(T.obMaterialsNotes)}</label>
        <textarea id="materials_notes" name="materials_notes" rows="3" maxlength="1000" placeholder="${esc(T.obMaterialsNotesPh)}">${esc(matNotesValue)}</textarea>

        <div class="section-subheading">${esc(T.blockBRefs)}</div>

        <label for="reference_url">${esc(T.obRefUrl)}</label>
        <input id="reference_url" name="reference_url" type="url" maxlength="500" value="${esc(refUrlValue)}" placeholder="${esc(T.obRefUrlPh)}">

        <label for="reference_file">${esc(T.obRefFile)}</label>
        ${refPrevFileNote}
        <input id="reference_file" name="reference_file" type="file">
        <span class="file-note">${esc(T.obMaterialsFileNote)}</span>

        <label for="reference_notes">${esc(T.obRefNotes)}</label>
        <textarea id="reference_notes" name="reference_notes" rows="3" maxlength="1000" placeholder="${esc(T.obRefNotesPh)}">${esc(refNotesValue)}</textarea>

        <button type="submit">${esc(T.obSubmit)}</button>
      </form>`;

    if (!isFirstSubmission) {
      addFormHtml = `
        <details class="add-materials-slider"${hasDraft ? " open" : ""}>
          <summary class="slider-summary">${esc(T.obAccordionTitle)}</summary>
          <div class="slider-body">
            <div class="slider-warning"><p>${esc(T.obDelayWarning)}</p></div>
            ${formFields}
          </div>
        </details>`;
    } else {
      addFormHtml = `
        <div class="box accent">
          <span class="eyebrow">${esc(T.obEyebrow)}</span>
          <h2>${esc(T.obTitle)}</h2>
          <p class="lead" style="margin-bottom:1.15rem;font-size:.85rem;">${esc(T.obIntro)}</p>
          ${formFields}
        </div>`;
    }
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
        const maxR = ph.maxRevisions || MAX_PHASE_REVISIONS;
        const rUsed = Math.min(maxR, Math.max(0, Number(ph.revisionsUsed) || 0));
        meta = rUsed > 0 ? T.activeRev(rUsed, maxR) : T.active;
      }

      const safeDeliv = cleanHttpsUrl(ph.deliverableUrl || "", 500);
      const noteHtml = ph.note
        ? `<div class="phase-note"><strong>${esc(T.studioNote)}:</strong> ${esc(ph.note)}</div>`
        : "";

      const actions = [];
      if (safeDeliv) {
        const delivLabel = ph.deliverableFilename
          ? `${esc(T.deliverable)} (${esc(ph.deliverableFilename)})`
          : esc(T.deliverable);
        actions.push(
          `<a class="pill-link" href="${esc(safeDeliv)}" target="_blank" rel="noopener noreferrer">${delivLabel}</a>`
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

  let postDeliveryHtml = "";
  if (allDone) {
    const workItems = Array.isArray(proj.extraWork) ? proj.extraWork : [];
    const workHistoryHtml = workItems.length
      ? `<div style="margin-top:1rem;border-top:1px solid #E4DED0;padding-top:.85rem;">
          <span style="font-size:11px;font-family:ui-monospace,monospace;letter-spacing:.05em;color:#58575E;text-transform:lowercase;display:block;margin-bottom:.5rem;">${esc(T.extraWorkHistory)}</span>
          ${workItems.map((w) => `
            <div style="background:rgba(255,255,255,.7);border:1px solid #E4DED0;border-radius:10px;padding:.75rem .9rem;margin-bottom:.5rem;font-size:13px;">
              <div style="display:flex;justify-content:space-between;color:#58575E;font-size:11px;margin-bottom:.25rem;">
                <span>${esc(fmtDate(w.date, L))}</span>
                <span style="color:#3D5A85;font-weight:600;">${esc(T.extraWorkStatusReceived)}</span>
              </div>
              <div style="color:#17171A;white-space:pre-wrap;">${esc(w.notes)}</div>
            </div>
          `).join("")}
        </div>`
      : "";

    postDeliveryHtml = `
      <div id="extra-work" class="box" style="margin-top:1.25rem;">
        <span class="eyebrow">${esc(T.extraWorkEyebrow)}</span>
        <h2>${esc(T.extraWorkTitle)}</h2>
        <p class="lead" style="margin-bottom:1rem;font-size:.85rem;">${esc(T.extraWorkDesc)}</p>
        <form method="POST" action="${esc(projectPageUrl)}#extra-work">
          <input type="hidden" name="op" value="extra_work">
          <label for="extra-notes" style="display:block;font-size:12px;color:#58575E;margin-bottom:.4rem;text-transform:lowercase;">${esc(T.extraWorkPh)}</label>
          <textarea id="extra-notes" name="notes" rows="3" maxlength="1500" required placeholder="${esc(T.extraWorkPh)}" style="width:100%;margin-bottom:.75rem;padding:.75rem;border-radius:10px;border:1px solid #E4DED0;background:rgba(255,255,255,.9);font-family:inherit;font-size:13px;"></textarea>
          <button type="submit" class="btn">${esc(T.extraWorkBtn)}</button>
        </form>
        ${workHistoryHtml}
      </div>`;
  }

  let reviewCardHtml = "";
  if (allDone && !proj.reviewSubmitted) {
    const revUrl = await reviewUrl(env, token);
    if (revUrl) {
      reviewCardHtml = `
        <div class="box accent" style="margin-top:1.25rem;">
          <span class="eyebrow">${esc(PG[L].rv?.eyebrow || "opinión verificada")}</span>
          <h2>${esc(PG[L].rv?.heading || "cuéntanos qué tal ha ido")}</h2>
          <p class="lead" style="margin-bottom:1.15rem;font-size:.85rem;">${esc(PG[L].rv?.intro || "gracias por confiar en nosotros.")}</p>
          <a class="btn" href="${esc(revUrl)}">${esc(PG[L].common?.openReview || "dejar valoración del proyecto")}</a>
        </div>`;
    }
  }

  // ── SISTEMA DE CHAT HÍBRIDO (BRANDI IA + EQUIPO HUMANO) ──
  const chatKey = `project_chat:${token}`;
  const humanChatHistory = (await env.LEADS_KV.get(chatKey, { type: "json" })) || [];

  if (L !== "es" && humanChatHistory.length && env.GROQ_API_KEY) {
    let missingTrans = false;
    for (const m of humanChatHistory) {
      if (m && m.sender === "studio" && m.text && (!m.translations || !m.translations[L])) {
        missingTrans = true;
        break;
      }
    }
    if (missingTrans) {
      await Promise.all(
        humanChatHistory.map(async (m) => {
          if (m && m.sender === "studio" && m.text && (!m.translations || !m.translations[L])) {
            const tr = await translateMessageText(env, m.text, "es", L);
            if (tr && tr !== m.text) {
              m.translations = m.translations || {};
              m.translations[L] = tr;
            }
          }
        })
      );
      await env.LEADS_KV.put(chatKey, JSON.stringify(humanChatHistory.slice(-100))).catch(() => {});
    }
  }

  const humanMessagesHtml = humanChatHistory.length
    ? humanChatHistory
        .map((m) => {
          const isClient = m.sender === "client";
          const author = isClient ? T.chatYou : T.chatStudio;
          const cls = isClient ? "is-client" : "is-studio";
          const hasTrans = !isClient && L !== "es" && m.translations && m.translations[L] && m.translations[L] !== m.text;
          const displayText = hasTrans ? m.translations[L] : m.text;
          const toggleHtml = hasTrans
            ? `<div class="chat-trans-wrap">
                <button type="button" class="chat-trans-toggle" data-orig="${esc(m.text)}" data-trans="${esc(m.translations[L])}" data-showing="trans">
                  <svg class="chat-trans-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>
                  <span class="chat-trans-label">${esc(T.chatTransIndicator)}</span>
                </button>
              </div>`
            : "";
          return `<div class="chat-msg-row ${cls}">
            <div class="chat-msg-bubble">
              <div class="chat-msg-head">
                <span class="chat-msg-author">${esc(author)}</span>
                <span class="chat-msg-date">${esc(fmtDate(m.date, L))}</span>
              </div>
              <div class="chat-msg-text">${esc(displayText)}</div>
              ${toggleHtml}
            </div>
          </div>`;
        })
        .join("")
    : `<div class="chat-empty" id="human-empty-msg">${esc(T.chatNoMessages)}</div>`;

  const brandiWelcomeMsg = T.brandiWelcome(proj.brand);

  const msgSentBanner = url.searchParams.get("msg_sent") === "1"
    ? `<div class="banner-ok" style="margin-bottom:1rem;"><p>${esc(T.humanSentSuccess)}</p></div>`
    : "";

  const chatSectionHtml = `
    <section id="chat" class="chat-section">
      <div class="chat-header">
        <div class="chat-header-info">
          <span class="eyebrow" style="margin-bottom:.2rem;">${esc(T.chatEyebrow)}</span>
          <h3 style="margin-bottom:0;">${esc(T.chatHeading)}</h3>
        </div>
        <div class="chat-mode-tabs" role="tablist">
          <button type="button" class="chat-tab-btn is-active" id="tab-brandi" role="tab" aria-selected="true" aria-controls="panel-brandi" data-chat-tab="brandi">
            <span class="tab-dot ai"></span>
            <span>${esc(T.chatTabBrandi)}</span>
          </button>
          <button type="button" class="chat-tab-btn" id="tab-human" role="tab" aria-selected="false" aria-controls="panel-human" data-chat-tab="human">
            <span class="tab-dot human"></span>
            <span>${esc(T.chatTabHuman)}</span>
          </button>
        </div>
      </div>

      <div id="panel-brandi" class="chat-panel is-active" role="tabpanel" aria-labelledby="tab-brandi">
        <div class="chat-intro-banner">
          <p>${esc(T.brandiIntro)}</p>
          <button type="button" class="btn-switch-human" id="btn-switch-human">${esc(T.switchToHuman)} →</button>
        </div>
        <div class="chat-msg-list" id="brandi-msg-list">
          <div class="chat-msg-row is-ai">
            <div class="chat-msg-bubble">
              <div class="chat-msg-head">
                <span class="chat-msg-author">${esc(T.chatBrandi)}</span>
              </div>
              <div class="chat-msg-text">${esc(brandiWelcomeMsg)}</div>
            </div>
          </div>
        </div>
        <form id="brandi-chat-form" method="POST" action="${esc(projectPageUrl)}#chat">
          <input type="hidden" name="op" value="brandi_chat">
          <div class="chat-input-wrap">
            <textarea name="message" id="brandi-input" placeholder="${esc(T.brandiPlaceholder)}" maxlength="1000" rows="1" required></textarea>
            <button type="submit" class="chat-send-btn btn-ai" aria-label="${esc(T.sendBtn)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            </button>
          </div>
        </form>
      </div>

      <div id="panel-human" class="chat-panel" role="tabpanel" aria-labelledby="tab-human">
        <div class="chat-intro-banner human-banner">
          <p>${esc(T.humanIntro)}</p>
        </div>
        ${msgSentBanner}
        <div class="chat-msg-list" id="human-msg-list">
          ${humanMessagesHtml}
        </div>
        <form id="human-chat-form" method="POST" action="${esc(projectPageUrl)}#chat">
          <input type="hidden" name="op" value="human_chat">
          <div class="chat-input-wrap">
            <textarea name="message" id="human-input" placeholder="${esc(T.humanPlaceholder)}" maxlength="2000" rows="2" required></textarea>
            <button type="submit" class="chat-send-btn" aria-label="${esc(T.sendBtn)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            </button>
          </div>
        </form>
      </div>
    </section>

    <script>
      (function(){
        var tabBrandi = document.getElementById("tab-brandi");
        var tabHuman = document.getElementById("tab-human");
        var panelBrandi = document.getElementById("panel-brandi");
        var panelHuman = document.getElementById("panel-human");
        var switchBtn = document.getElementById("btn-switch-human");
        var brandiForm = document.getElementById("brandi-chat-form");
        var humanForm = document.getElementById("human-chat-form");
        var brandiInput = document.getElementById("brandi-input");
        var humanInput = document.getElementById("human-input");
        var brandiList = document.getElementById("brandi-msg-list");
        var humanList = document.getElementById("human-msg-list");

        var brandiHistory = [];

        function activateTab(tab) {
          if (tab === "human") {
            tabBrandi.classList.remove("is-active");
            tabBrandi.setAttribute("aria-selected", "false");
            tabHuman.classList.add("is-active");
            tabHuman.setAttribute("aria-selected", "true");
            panelBrandi.classList.remove("is-active");
            panelHuman.classList.add("is-active");
            if (humanList) humanList.scrollTop = humanList.scrollHeight;
            if (humanInput) humanInput.focus();
          } else {
            tabHuman.classList.remove("is-active");
            tabHuman.setAttribute("aria-selected", "false");
            tabBrandi.classList.add("is-active");
            tabBrandi.setAttribute("aria-selected", "true");
            panelHuman.classList.remove("is-active");
            panelBrandi.classList.add("is-active");
            if (brandiList) brandiList.scrollTop = brandiList.scrollHeight;
            if (brandiInput) brandiInput.focus();
          }
        }

        if (tabBrandi) tabBrandi.addEventListener("click", function(){ activateTab("brandi"); });
        if (tabHuman) tabHuman.addEventListener("click", function(){ activateTab("human"); });
        if (switchBtn) switchBtn.addEventListener("click", function(){ activateTab("human"); });

        if (window.location.search.indexOf("msg_sent=1") !== -1 || window.location.hash === "#chat-human") {
          activateTab("human");
        }

        function createMsgRow(authorText, text, cls, dateText) {
          var row = document.createElement("div");
          row.className = "chat-msg-row " + cls;
          var bubble = document.createElement("div");
          bubble.className = "chat-msg-bubble";
          var head = document.createElement("div");
          head.className = "chat-msg-head";
          var authorSpan = document.createElement("span");
          authorSpan.className = "chat-msg-author";
          authorSpan.textContent = authorText;
          head.appendChild(authorSpan);
          if (dateText) {
            var dateSpan = document.createElement("span");
            dateSpan.className = "chat-msg-date";
            dateSpan.textContent = dateText;
            head.appendChild(dateSpan);
          }
          var textDiv = document.createElement("div");
          textDiv.className = "chat-msg-text";
          textDiv.textContent = text;
          bubble.appendChild(head);
          bubble.appendChild(textDiv);
          row.appendChild(bubble);
          return row;
        }

        var youLabel = ${JSON.stringify(T.chatYou)};
        var brandiLabel = ${JSON.stringify(T.chatBrandi)};
        var chatErrMsg = ${JSON.stringify(T.chatErr)};

        if (brandiForm) {
          brandiForm.addEventListener("submit", function(e){
            var text = (brandiInput.value || "").trim();
            if (!text) return;
            if (!window.fetch) return;
            e.preventDefault();

            var userRow = createMsgRow(youLabel, text, "is-client");
            brandiList.appendChild(userRow);
            brandiInput.value = "";
            brandiList.scrollTop = brandiList.scrollHeight;

            var typingRow = document.createElement("div");
            typingRow.className = "chat-msg-row is-ai";
            var typingBubble = document.createElement("div");
            typingBubble.className = "chat-msg-bubble";
            var typingDiv = document.createElement("div");
            typingDiv.className = "chat-typing";
            typingDiv.appendChild(document.createElement("span"));
            typingDiv.appendChild(document.createElement("span"));
            typingDiv.appendChild(document.createElement("span"));
            typingBubble.appendChild(typingDiv);
            typingRow.appendChild(typingBubble);
            brandiList.appendChild(typingRow);
            brandiList.scrollTop = brandiList.scrollHeight;

            brandiHistory.push({ role: "user", text: text });

            fetch(window.location.href, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Accept": "application/json" },
              body: JSON.stringify({ op: "brandi_chat", message: text, history: brandiHistory })
            })
            .then(function(r){
              if (!r.ok) throw new Error("status " + r.status);
              return r.json();
            })
            .then(function(res){
              if (typingRow && typingRow.parentNode) typingRow.parentNode.removeChild(typingRow);
              var replyText = res && res.reply ? res.reply : "no se ha podido procesar la respuesta.";
              brandiHistory.push({ role: "assistant", text: replyText, sig: res && res.sig ? res.sig : "" });

              var aiRow = createMsgRow(brandiLabel, replyText, "is-ai");
              brandiList.appendChild(aiRow);
              brandiList.scrollTop = brandiList.scrollHeight;
            })
            .catch(function(err){
              if (typingRow && typingRow.parentNode) typingRow.parentNode.removeChild(typingRow);
              if (userRow && userRow.parentNode) userRow.parentNode.removeChild(userRow);
              brandiHistory.pop();
              brandiInput.value = text;
              var errRow = createMsgRow(brandiLabel, chatErrMsg, "is-ai");
              brandiList.appendChild(errRow);
              brandiList.scrollTop = brandiList.scrollHeight;
            });
          });
        }

        if (humanForm) {
          humanForm.addEventListener("submit", function(e){
            var text = (humanInput.value || "").trim();
            if (!text) return;
            if (!window.fetch) return;
            e.preventDefault();

            var emptyMsg = document.getElementById("human-empty-msg");
            if (emptyMsg) emptyMsg.style.display = "none";

            var nowStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            var userRow = createMsgRow(youLabel, text, "is-client", nowStr);
            humanList.appendChild(userRow);
            humanInput.value = "";
            humanList.scrollTop = humanList.scrollHeight;

            fetch(window.location.href, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Accept": "application/json" },
              body: JSON.stringify({ op: "human_chat", message: text })
            })
            .then(function(r){
              if (!r.ok) throw new Error("status " + r.status);
              return r.json();
            })
            .catch(function(err){
              console.error("human chat error:", err);
              if (userRow && userRow.parentNode) userRow.parentNode.removeChild(userRow);
              humanInput.value = text;
              var errMsg = document.createElement("div");
              errMsg.className = "chat-intro-banner human-banner";
              errMsg.style.borderColor = "#E8A33D";
              var pErr = document.createElement("p");
              pErr.style.color = "#E8A33D";
              pErr.textContent = chatErrMsg;
              errMsg.appendChild(pErr);
              humanList.appendChild(errMsg);
              humanList.scrollTop = humanList.scrollHeight;
            });
          });
        }

        document.addEventListener("click", function(e){
          var btn = e.target.closest(".chat-trans-toggle");
          if (!btn) return;
          var bubble = btn.closest(".chat-msg-bubble");
          if (!bubble) return;
          var textEl = bubble.querySelector(".chat-msg-text");
          var labelEl = btn.querySelector(".chat-trans-label");
          if (!textEl) return;
          var orig = btn.getAttribute("data-orig") || "";
          var trans = btn.getAttribute("data-trans") || "";
          var showing = btn.getAttribute("data-showing") || "trans";
          if (showing === "trans") {
            textEl.textContent = orig;
            btn.setAttribute("data-showing", "orig");
            if (labelEl) labelEl.textContent = ${JSON.stringify(T.chatViewTrans)};
          } else {
            textEl.textContent = trans;
            btn.setAttribute("data-showing", "trans");
            if (labelEl) labelEl.textContent = ${JSON.stringify(T.chatTransIndicator)};
          }
        });
      })();
    </script>
  `;

  const fullHtml = `
    ${bannerHtml}
    ${headerHtml}
    <h3>${esc(T.state)}</h3>
    <div class="timeline">${phaseCards.join("")}</div>
    ${postDeliveryHtml}
    ${chatSectionHtml}
    ${reviewCardHtml}
    ${materialsBox}
    ${referencesBox}
    ${addFormHtml}`;

  return htmlResponse(
    page(`${T.title} — ${proj.brand}`, T.heading, "", {
      lang: L,
      eyebrow: T.eyebrow,
      wide: true,
      html: fullHtml,
      overlay: undoHtml,
    }),
    200
  );
}

// ── GESTIÓN Y RESPUESTA DE CHAT DEL ESTUDIO (/responder-chat) ──
async function handleStudioChat(request, env, url) {
  if (!env.LEADS_KV || !env.RESEND_API_KEY) {
    return htmlResponse(page("configuración", "error de configuración", "faltan variables en el servidor."), 500);
  }

  const p = url.searchParams.get("p");
  const t = url.searchParams.get("t");
  if (!p || !/^[a-f0-9]{64}$/.test(p) || !t || !/^[a-f0-9]{64}$/.test(t)) {
    return htmlResponse(page("enlace inválido", "enlace inválido", "el enlace de gestión del chat no es válido."), 400);
  }

  const key = await getKey(env);
  const ok = await verifyRaw(key, `adminchat|${p}`, t);
  if (!ok) {
    return htmlResponse(page("no autorizado", "enlace caducado o alterado", "el token de seguridad no coincide."), 403);
  }

  const rawProj = await env.LEADS_KV.get(`project:${p}`);
  if (!rawProj) {
    return htmlResponse(page("no encontrado", "proyecto no encontrado", "no hemos encontrado este proyecto."), 404);
  }
  const proj = JSON.parse(rawProj);
  const projectPageUrl = buildUrl("/proyecto", { token: p });
  const chatKey = `project_chat:${p}`;
  const chatHistory = (await env.LEADS_KV.get(chatKey, { type: "json" })) || [];

  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    const replyText = cleanInput(form?.get("reply") || "", 2500);
    if (!replyText) {
      return htmlResponse(
        page("mensaje vacío", "falta el texto de la respuesta", "escribe un mensaje para enviar al cliente.", {
          eyebrow: "panel interno del estudio",
          footerUrl: url.href,
          footerLabel: "volver al chat",
        }),
        400
      );
    }

    const lang = pickLang(proj.lang);
    let translatedToClient = null;
    if (lang !== "es" && env.GROQ_API_KEY) {
      try {
        translatedToClient = await translateMessageText(env, replyText, "es", lang);
      } catch (e) {
        console.warn("translateMessageText to client failed:", e?.message);
      }
    }

    const msgId = randomHex(8);
    const newMsg = {
      id: msgId,
      sender: "studio",
      text: replyText,
      date: new Date().toISOString(),
      ...(translatedToClient && translatedToClient !== replyText ? { translations: { [lang]: translatedToClient } } : {}),
    };
    chatHistory.push(newMsg);
    await env.LEADS_KV.put(chatKey, JSON.stringify(chatHistory.slice(-100)));

    const emChat = EM[lang].chat;
    const clientQuote = translatedToClient && translatedToClient !== replyText
      ? translatedToClient
      : replyText;
    const clientNote = translatedToClient && translatedToClient !== replyText
      ? `${emChat.autoTranslatedNotice}. ${emChat.confirmSoon}`
      : emChat.confirmSoon;

    try {
      await resendSend(
        env,
        {
          to: [proj.clientEmail],
          reply_to: "hola@rebrandyourbrand.es",
          subject: emChat.replySubject(proj.brand),
          ...renderEmail(lang, {
            paras: [
              emChat.hello,
              emChat.replyIntro(bold(proj.brand)),
            ],
            quote: clientQuote,
            cta: { label: emChat.viewPortal, url: projectPageUrl + "#chat-human" },
            note: clientNote,
          }),
        },
        `chat-reply-${p}-${msgId}`
      );
    } catch (e) {
      console.error("error sending studio chat reply email:", e?.message);
    }
    return redirectTo(buildUrl("/responder-chat", { p, t, sent: "1" }));
  }

  const sentNotice = url.searchParams.get("sent") === "1"
    ? `<div class="banner-ok" style="margin-bottom:1.25rem;"><p>respuesta enviada con éxito a ${esc(proj.clientEmail)}. el cliente ha recibido la notificación por correo y el mensaje se ha guardado en su panel.</p></div>`
    : "";

  if (proj.lang !== "es" && chatHistory.length && env.GROQ_API_KEY) {
    let missingTrans = false;
    for (const m of chatHistory) {
      if (m && m.sender === "client" && m.text && (!m.translations || !m.translations.es)) {
        missingTrans = true;
        break;
      }
    }
    if (missingTrans) {
      await Promise.all(
        chatHistory.map(async (m) => {
          if (m && m.sender === "client" && m.text && (!m.translations || !m.translations.es)) {
            const tr = await translateMessageText(env, m.text, proj.lang, "es");
            if (tr && tr !== m.text) {
              m.translations = m.translations || {};
              m.translations.es = tr;
            }
          }
        })
      );
      await env.LEADS_KV.put(chatKey, JSON.stringify(chatHistory.slice(-100))).catch(() => {});
    }
  }

  const historyHtml = chatHistory.length
    ? chatHistory
        .map((m) => {
          const isStudio = m.sender === "studio";
          const author = isStudio ? "estudio (gael y bernat)" : `cliente (${proj.brand})`;
          const cls = isStudio ? "is-studio" : "is-client";
          const hasTrans = !isStudio && proj.lang !== "es" && m.translations && m.translations.es && m.translations.es !== m.text;
          const displayText = hasTrans ? m.translations.es : m.text;
          const toggleHtml = hasTrans
            ? `<div class="chat-trans-wrap">
                <button type="button" class="chat-trans-toggle" data-orig="${esc(m.text)}" data-trans="${esc(m.translations.es)}" data-showing="trans">
                  <svg class="chat-trans-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>
                  <span class="chat-trans-label">traducido automáticamente, haz clic para ver el mensaje original</span>
                </button>
              </div>`
            : "";
          return `<div class="chat-msg-row ${cls}" style="margin-bottom:.75rem;">
            <div class="chat-msg-bubble">
              <div class="chat-msg-head">
                <span class="chat-msg-author">${esc(author)}</span>
                <span class="chat-msg-date">${esc(fmtDate(m.date, "es"))}</span>
              </div>
              <div class="chat-msg-text">${esc(displayText)}</div>
              ${toggleHtml}
            </div>
          </div>`;
        })
        .join("")
    : `<div class="chat-empty">no hay mensajes en el historial todavía.</div>`;
  const html = `
    ${sentNotice}
    <div class="box" style="margin-bottom:1.5rem;">
      <div class="kv">
        <div class="kv-row"><span>marca</span><span class="kv-val">${esc(proj.brand)}</span></div>
        <div class="kv-row"><span>correo del cliente</span><span class="kv-val">${esc(proj.clientEmail)}</span></div>
        <div class="kv-row"><span>servicios</span><span class="kv-val">${esc(svcLabel(proj.services, "es"))}</span></div>
        <div class="kv-row"><span>estado</span><span class="kv-val">${esc(proj.status)}</span></div>
      </div>
    </div>
    <h3>conversación con el cliente</h3>
    <div class="chat-msg-list" style="margin-bottom:1.5rem;background:rgba(255,255,255,.5);padding:1rem;border-radius:14px;border:1px solid rgba(228,222,208,.8);">
      ${historyHtml}
    </div>
    <form method="POST">
      <label for="reply-input">responder a ${esc(proj.brand)}:</label>
      <textarea id="reply-input" name="reply" rows="4" placeholder="escribe tu respuesta para el cliente..." required></textarea>
      <button type="submit">enviar respuesta al cliente</button>
    </form>
    <script>
      (function(){
        document.addEventListener("click", function(e){
          var btn = e.target.closest(".chat-trans-toggle");
          if (!btn) return;
          var bubble = btn.closest(".chat-msg-bubble");
          if (!bubble) return;
          var textEl = bubble.querySelector(".chat-msg-text");
          var labelEl = btn.querySelector(".chat-trans-label");
          if (!textEl) return;
          var orig = btn.getAttribute("data-orig") || "";
          var trans = btn.getAttribute("data-trans") || "";
          var showing = btn.getAttribute("data-showing") || "trans";
          if (showing === "trans") {
            textEl.textContent = orig;
            btn.setAttribute("data-showing", "orig");
            if (labelEl) labelEl.textContent = "ver traducción automática";
          } else {
            textEl.textContent = trans;
            btn.setAttribute("data-showing", "trans");
            if (labelEl) labelEl.textContent = "traducido automáticamente, haz clic para ver el mensaje original";
          }
        });
      })();
    </script>
  `;

  return htmlResponse(
    page(`chat con ${proj.brand}`, `chat — ${proj.brand}`, "historial y respuesta directa al cliente.", {
      eyebrow: "panel interno del estudio",
      wide: true,
      html,
      footerUrl: projectPageUrl,
      footerLabel: "ver panel público del cliente",
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

  let finished =
    proj.paid &&
    Array.isArray(proj.phases) &&
    proj.phases.length > 0 &&
    proj.phases.every((ph) => ph.status === "done");
  if (!finished) {
    if (checkAllServicesApproved(proj)) {
      await finalizeProjectClosure(env, proj, p);
      finished = true;
    } else {
      return msgPage(L, "rvNotReady", 403, { footerUrl: trackingUrl, footerLabel: PG[L].common.openTracker });
    }
  }
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
  await saveProject(env, p, proj);
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
    if (env.CHAT_LIMITER) {
      const { success } = await env.CHAT_LIMITER.limit({ key: `e:${ipKey(ip)}` });
      if (!success) throw new HttpError(429, "rate_limited", { "Retry-After": "60" });
    }
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
