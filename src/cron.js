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

  // 0. Cierre automático y rescate si todos los servicios contratados están aprobados
  if (checkAllServicesApproved(proj) && (!proj.finishedAt || !proj.reviewInvited || proj.status !== "done")) {
    await finalizeProjectClosure(env, proj, projectToken);
    changed = true;
  }

  // 1. Cláusula 3.3 — Recordatorio amistoso a los 15 días si la fase sigue en espera de validación (el proyecto avanza al ritmo del cliente)
  if (Array.isArray(proj.phases)) {
    for (const ph of proj.phases) {
      if (ph.status !== "review" || !ph.reviewSentAt) continue;
      const sentMs = new Date(ph.reviewSentAt).getTime();
      if (Number.isNaN(sentMs)) continue;
      const daysElapsed = (nowMs - sentMs) / DAY_MS;

      if (daysElapsed >= CLIENT_PAUSE_REMINDER_DAYS && !ph.reminderSentAt) {
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
            `pause-15d-${projectToken}-${ph.step}-${ph.reviewSentAt.slice(0, 10)}`
          );
          ph.reminderSentAt = nowIso;
          changed = true;
        } catch (e) {
          console.error("pause 15d reminder failed:", e?.message);
        }
      }
    }
  }

  // 2. Cláusula 3.2 — Preaviso a los 30 días y rescisión por abandono a los 37 días sin actividad
  if (proj.status === "active") {
    const hasMaterials =
      (Array.isArray(proj.materialsList) && proj.materialsList.length > 0) ||
      Boolean(proj.onboarding && (proj.onboarding.materials || proj.onboarding.submittedAt || proj.onboarding.receivedAt));
    const waitingMaterials = !hasMaterials;
    const reviewPhase = Array.isArray(proj.phases)
      ? proj.phases.find((ph) => ph.status === "review" && ph.reviewSentAt)
      : null;
    const waitingReview = Boolean(reviewPhase);

    if (waitingMaterials || waitingReview) {
      const inactiveStart = waitingMaterials ? (proj.paidAt || proj.createdAt) : reviewPhase.reviewSentAt;
      const inactiveMs = new Date(inactiveStart).getTime();
      if (!Number.isNaN(inactiveMs)) {
        const daysInactive = (nowMs - inactiveMs) / DAY_MS;
        if (daysInactive >= ABANDON_WARNING_DAYS) {
          const trackingUrl = buildUrl("/proyecto", { token: projectToken });
          if (!proj.abandonWarningSentAt) {
            const tWarn = EM[lang].abandonWarning;
            try {
              await resendSend(
                env,
                {
                  to: [proj.clientEmail],
                  reply_to: "hola@rebrandyourbrand.es",
                  subject: tWarn.subject(proj.brand),
                  ...renderEmail(lang, {
                    paras: [tWarn.hello, tWarn.intro(bold(proj.brand)), tWarn.body],
                    cta: { label: tWarn.cta, url: trackingUrl },
                    note: tWarn.note,
                  }),
                },
                `abandon-warn-${projectToken}-${nowIso.slice(0, 10)}`
              );
              proj.abandonWarningSentAt = nowIso;
              changed = true;
            } catch (e) {
              console.error("abandon warning email failed:", e?.message);
            }
          } else {
            const warnMs = new Date(proj.abandonWarningSentAt).getTime();
            if (!Number.isNaN(warnMs)) {
              const daysSinceWarn = (nowMs - warnMs) / DAY_MS;
              if (daysSinceWarn >= ABANDON_GRACE_DAYS) {
                proj.status = "abandoned";
                proj.abandonedAt = nowIso;
                const tAb = EM[lang].abandoned;
                try {
                  await resendSend(
                    env,
                    {
                      to: [proj.clientEmail],
                      reply_to: "hola@rebrandyourbrand.es",
                      subject: tAb.subject(proj.brand),
                      ...renderEmail(lang, {
                        paras: [tAb.hello, tAb.intro(bold(proj.brand)), tAb.body],
                        cta: { label: tAb.cta, url: trackingUrl },
                        note: tAb.note,
                      }),
                    },
                    `abandon-client-${projectToken}-${nowIso.slice(0, 10)}`
                  );

                  await resendSend(
                    env,
                    {
                      to: ["hola@rebrandyourbrand.es"],
                      reply_to: proj.clientEmail,
                      subject: `expediente cerrado por abandono (cláusula 3.2) — ${proj.brand}`,
                      ...renderEmail("es", {
                        paras: [
                          `el expediente de ${bold(proj.brand)} ha sido cerrado definitivamente por abandono tras superar 37 días naturales sin actividad.`,
                          lines(
                            `— cliente: ${bold(proj.clientEmail)}`,
                            `— proyecto: ${bold(proj.brand)}`,
                            `— fecha de aviso inicial (30d): ${bold(fmtDate(proj.abandonWarningSentAt, "es"))}`,
                            `— fecha de rescisión (37d): ${bold(fmtDate(nowIso, "es"))}`
                          ),
                          "conforme a la cláusula 3.2, el importe abonado se conserva en compensación por los costes y la reserva de agenda.",
                        ],
                        cta: { label: "ver ficha del proyecto", url: trackingUrl },
                      }),
                    },
                    `abandon-admin-${projectToken}-${nowIso.slice(0, 10)}`
                  );
                  changed = true;
                } catch (e) {
                  console.error("abandon termination email failed:", e?.message);
                }
              }
            }
          }
        }
      }
    } else if (proj.abandonWarningSentAt) {
      delete proj.abandonWarningSentAt;
      changed = true;
    }
  }

  // 3. Cláusula 3.1 — Preaviso de 30 días para renovación anual de infraestructura web
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
        const rawRenewal =
          env.WEB_RENEWAL_EUR !== undefined && String(env.WEB_RENEWAL_EUR).trim() !== ""
            ? Number(env.WEB_RENEWAL_EUR)
            : WEB_RENEWAL_EUR;
        const renewalEur = Number.isFinite(rawRenewal) && rawRenewal >= 0 ? rawRenewal : WEB_RENEWAL_EUR;

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

  // 4. Alerta interna de renovación anual vencida sin pago ni cancelación
  const renewalDueDate = proj.renewalDueAt || proj.nextRenewalAt;
  if (
    Array.isArray(proj.services) &&
    proj.services.includes("web") &&
    renewalDueDate &&
    !proj.renewalCanceled &&
    !proj.renewalPaid &&
    !proj.renewalOverdueAlertSentAt
  ) {
    const dueMs = new Date(renewalDueDate).getTime();
    if (!Number.isNaN(dueMs) && nowMs > dueMs) {
      const trackingUrl = buildUrl("/proyecto", { token: projectToken });
      try {
        await resendSend(
          env,
          {
            to: ["hola@rebrandyourbrand.es"],
            reply_to: proj.clientEmail,
            subject: `alerta de vencimiento de renovación web — ${proj.brand}`,
            ...renderEmail("es", {
              paras: [
                `la infraestructura técnica web de ${bold(proj.brand)} ha superado su fecha de vencimiento sin haberse renovado ni cancelado.`,
                lines(
                  `— cliente: ${bold(proj.clientEmail)}`,
                  `— proyecto: ${bold(proj.brand)}`,
                  `— fecha de vencimiento: ${bold(fmtDate(renewalDueDate, "es"))}`,
                  `— estado actual: pendiente de revisión manual`
                ),
                "revisa el estado del dominio y servidor para gestionar la renovación o baja según corresponda.",
              ],
              cta: { label: "ver ficha del proyecto", url: trackingUrl },
            }),
          },
          `renewal-overdue-${projectToken}-${String(renewalDueDate).slice(0, 10)}`
        );
        proj.renewalOverdueAlertSentAt = nowIso;
        changed = true;
      } catch (e) {
        console.error("renewal overdue alert failed:", e?.message);
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
