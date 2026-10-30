async function inspectProjectDeadlines(env, keyName, nowMs) {
  const raw = await env.LEADS_KV.get(keyName);
  if (!raw) return;

  let proj;
  try {
    proj = JSON.parse(raw);
  } catch {
    return;
  }
  if (!proj || !proj.paid) return;

  const projectToken = proj.token || keyName.replace(/^project:/, "");
  if (!/^[a-f0-9]{64}$/.test(projectToken)) return;

  const lang = pickLang(proj.lang);
  const nowIso = new Date(nowMs).toISOString();
  let changed = false;

  // 1. Cláusula 3.3 — Recordatorio a los 15 días y aviso de aprobación tácita a los 20 días
  if (Array.isArray(proj.phases)) {
    for (const ph of proj.phases) {
      if (ph.status !== "review" || !ph.reviewSentAt) continue;
      const sentMs = new Date(ph.reviewSentAt).getTime();
      if (Number.isNaN(sentMs)) continue;
      const daysElapsed = (nowMs - sentMs) / DAY_MS;

      if (daysElapsed >= TACIT_REMINDER_DAYS && daysElapsed < TACIT_APPROVAL_DAYS && !ph.reminderSentAt) {
        const t = EM[lang].tacitReminder;
        const phName = phaseTitle(ph, lang);
        const appUrl = await approvePhaseUrl(env, projectToken, ph.step);
        const trackingUrl = buildUrl("/proyecto", { token: projectToken });
        try {
          await resendSend(
            env,
            {
              to: [proj.clientEmail],
              reply_to: "hola@rebrandyourbrand.es",
              subject: t.subject(proj.brand, phName),
              ...renderEmail(lang, {
                paras: [t.hello, t.intro(bold(proj.brand), bold(phName)), t.body],
                cta: { label: t.cta, url: appUrl },
                secondaryLink: {
                  label: ph.deliverableUrl ? EM[lang].proposal.openDeliverable : EM[lang].phase.cta,
                  url: ph.deliverableUrl || trackingUrl,
                },
                note: t.note,
              }),
            },
            `tacit-15d-${projectToken}-${ph.step}-${ph.reviewSentAt.slice(0, 10)}`
          );
          ph.reminderSentAt = nowIso;
          changed = true;
        } catch (e) {
          console.error("tacit 15d reminder failed:", e?.message);
        }
      }

      if (daysElapsed >= TACIT_APPROVAL_DAYS && !ph.tacitAlertSentAt) {
        const phNameEs = phaseTitle(ph, "es");
        const manageUrl = await advancePhaseUrl(env, projectToken, ph.step);
        try {
          await resendSend(
            env,
            {
              to: ["hola@rebrandyourbrand.es"],
              reply_to: proj.clientEmail,
              subject: `plazo de 20 días cumplido (aprobación tácita) — ${proj.brand}`,
              ...renderEmail("es", {
                paras: [
                  `han transcurrido al menos 20 días naturales desde el envío a revisión de ${bold(phNameEs)} en ${bold(proj.brand)}.`,
                  lines(
                    `— cliente: ${bold(proj.clientEmail)}`,
                    `— enviada a revisión: ${bold(fmtDate(ph.reviewSentAt, "es"))}`,
                    `— fase: ${bold(`paso ${ph.step} — ${phNameEs}`)}`
                  ),
                  "si el cliente no ha pedido cambios por correo, puedes cerrar la fase aplicando la cláusula 3.3 desde el botón inferior.",
                ],
                cta: { label: "abrir panel y avanzar fase", url: manageUrl },
              }),
            },
            `tacit-20d-${projectToken}-${ph.step}-${ph.reviewSentAt.slice(0, 10)}`
          );
          ph.tacitAlertSentAt = nowIso;
          changed = true;
        } catch (e) {
          console.error("tacit 20d studio alert failed:", e?.message);
        }
      }
    }
  }

  // 2. Cláusula 3.1 — Preaviso de 30 días para renovación anual de infraestructura web
  if (
    Array.isArray(proj.services) &&
    proj.services.includes("web") &&
    proj.nextRenewalAt &&
    !proj.renewalCanceled &&
    proj.renewalRemindedFor !== proj.nextRenewalAt
  ) {
    const dueMs = new Date(proj.nextRenewalAt).getTime();
    if (!Number.isNaN(dueMs)) {
      const daysUntil = (dueMs - nowMs) / DAY_MS;
      if (daysUntil <= RENEWAL_NOTICE_DAYS && daysUntil >= -7) {
        const cancelUrl = await cancelRenewalUrl(env, projectToken, proj.nextRenewalAt);
        const renewalEur = Number(env.WEB_RENEWAL_EUR || 0);

        if (renewalEur > 0 && env.STRIPE_SECRET_KEY) {
          const payUrl = await createRenewalCheckout(env, proj, renewalEur);
          if (payUrl) {
            const tr = EM[lang].renewal;
            const dueStr = fmtDate(proj.nextRenewalAt, lang);
            try {
              await resendSend(
                env,
                {
                  to: [proj.clientEmail],
                  reply_to: "hola@rebrandyourbrand.es",
                  subject: tr.subject(proj.brand),
                  ...renderEmail(lang, {
                    paras: [tr.hello, tr.intro(bold(proj.brand), bold(dueStr)), tr.body(bold(eur(renewalEur, lang)))],
                    cta: { label: tr.ctaPay, url: payUrl },
                    secondaryLink: { label: tr.cancelLine, url: cancelUrl },
                    note: tr.note,
                  }),
                },
                `renewal-client-${projectToken}-${proj.nextRenewalAt.slice(0, 10)}`
              );
              await alertAdmin(
                env,
                `preaviso automático de renovación enviado — ${proj.brand}`,
                `cliente: ${proj.clientEmail}\nvencimiento: ${fmtDate(proj.nextRenewalAt, "es")}\nimporte: ${renewalEur} €`
              );
              proj.renewalRemindedFor = proj.nextRenewalAt;
              changed = true;
            } catch (e) {
              console.error("renewal client email failed:", e?.message);
            }
          }
        } else {
          try {
            await resendSend(
              env,
              {
                to: ["hola@rebrandyourbrand.es"],
                reply_to: proj.clientEmail,
                subject: `preaviso de 30 días — renovación web de ${proj.brand}`,
                ...renderEmail("es", {
                  paras: [
                    `faltan menos de 30 días para el vencimiento anual de la infraestructura web de ${bold(proj.brand)}.`,
                    lines(
                      `— cliente: ${bold(proj.clientEmail)}`,
                      `— idioma del cliente: ${bold(lang)}`,
                      `— fecha de vencimiento: ${bold(fmtDate(proj.nextRenewalAt, "es"))}`
                    ),
                    "envía al cliente el importe actualizado del proveedor según la cláusula 3.1 (o configura la variable web_renewal_eur en el worker para automatizar el cobro en stripe). abajo tienes listo el enlace firmado de baja en un clic para incluirlo en el aviso:",
                  ],
                  cta: { label: "enlace firmado de baja en un clic", url: cancelUrl },
                }),
              },
              `renewal-admin-${projectToken}-${proj.nextRenewalAt.slice(0, 10)}`
            );
            proj.renewalRemindedFor = proj.nextRenewalAt;
            changed = true;
          } catch (e) {
            console.error("renewal admin reminder failed:", e?.message);
          }
        }
      }
    }
  }

  if (changed) {
    await env.LEADS_KV.put(keyName, JSON.stringify(proj));
  }
}

async function handleScheduled(controller, env, ctx) {
  if (!env.LEADS_KV || !env.RESEND_API_KEY || !env.CHAT_SIGNING_SECRET) {
    console.error("scheduled cron skipped: missing bindings");
    return;
  }

  const nowMs = controller?.scheduledTime ? Number(controller.scheduledTime) : Date.now();
  let cursor;
  do {
    const list = await env.LEADS_KV.list({ prefix: "project:", cursor });
    for (const item of list.keys) {
      await inspectProjectDeadlines(env, item.name, nowMs).catch((e) =>
        console.error("cron project check failed:", item.name, e?.message)
      );
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
}
