// Envía (o reenvía) el correo de verificación. "attempt" distingue la clave de idempotencia de cada reenvío.
async function sendVerifyEmail(env, { lang, brand, clientEmail }, verifyToken, attempt = 0) {
  const l = pickLang(lang);
  const t = EM[l].verify;
  await resendSend(
    env,
    {
      to: [clientEmail],
      subject: t.subject,
      ...renderEmail(l, {
        paras: [t.hello, t.intro(brand ? bold(brand) : ""), t.ask],
        cta: { label: t.cta, url: buildUrl("/verify", { token: verifyToken }) },
        note: t.ignore,
      }),
    },
    `verify-${verifyToken}-${attempt}`
  );
}

async function startVerification(env, { lang, messages, plan, clientEmail, brand, domain }) {
  const cooldownKey = `cooldown:${clientEmail}`;
  if (await env.LEADS_KV.get(cooldownKey)) {
    throw new HttpError(429, "email_cooldown", { "Retry-After": String(EMAIL_COOLDOWN_SECONDS) });
  }
  if (!plan) throw new HttpError(400, "plan_required");

  const l = pickLang(lang);
  const verifyToken = randomHex(32);
  const pendingKey = `pending:${verifyToken}`;
  const pendingPayload = {
    lang: l,
    messages,
    services: plan.ids,
    clientEmail,
    brand,
    domain: domain || "",
    resends: 0,
    timestamp: new Date().toISOString(),
  };
  await Promise.all([
    env.LEADS_KV.put(pendingKey, JSON.stringify(pendingPayload), { expirationTtl: PENDING_VERIFY_TTL_SECONDS }),
    env.LEADS_KV.put(cooldownKey, "1", { expirationTtl: EMAIL_COOLDOWN_SECONDS }),
  ]);
  try {
    await sendVerifyEmail(env, pendingPayload, verifyToken);
  } catch (e) {
    await Promise.all([env.LEADS_KV.delete(pendingKey), env.LEADS_KV.delete(cooldownKey)]).catch(() => {});
    console.error("verification email failed:", e?.message);
    throw new HttpError(502, "email_error");
  }
  return verifyToken;
}

function formatTranscript(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && typeof m.text === "string" && m.text.trim())
    .map((m) => `${m.role === "user" ? "cliente" : "brandi"}: ${m.text}`)
    .join("\n\n");
}

async function deliverVerifiedLead(env, ctx, { lang, messages, clientEmail, brand, plan, projectToken }) {
  const l = pickLang(lang);
  const transcript = formatTranscript(messages);
  const planLine = plan ? `${svcLabel(plan.ids, "es")} — ${plan.total} €` : "";
  const projectPageUrl = projectToken ? buildUrl("/proyecto", { token: projectToken }) : SITE_URL;

  await resendSend(
    env,
    {
      to: ["hola@rebrandyourbrand.es"],
      subject: `lead verificado (${l.toUpperCase()}) — ${brand || "sin marca"} (${clientEmail})`,
      reply_to: clientEmail,
      ...renderEmail("es", {
        paras: [
          "cliente verificado.",
          lines(
            `— marca: ${bold(brand || "sin indicar")}`,
            `— correo: ${bold(clientEmail)}`,
            planLine && `— servicios: ${bold(planLine)}`,
            `— idioma del pedido: ${bold(l)}`
          ),
          transcript ? "conversación con brandi:" : "",
        ].filter(Boolean),
        quote: transcript,
        cta: projectToken ? { label: "ver ficha del proyecto", url: projectPageUrl } : null,
      }),
    },
    `lead-${projectToken || clientEmail}`
  );

  const t = EM[l].ack;
  const ack = resendSend(
    env,
    {
      to: [clientEmail],
      subject: t.subject(brand || ""),
      ...renderEmail(l, {
        paras: [t.hello, t.body(brand ? bold(brand) : ""), t.next],
        cta: { label: t.cta, url: projectPageUrl },
        note: t.note,
      }),
    },
    `ack-${projectToken || clientEmail}`
  ).catch((e) => console.error("ack email failed:", e?.message));
  if (ctx?.waitUntil) ctx.waitUntil(ack);
}
