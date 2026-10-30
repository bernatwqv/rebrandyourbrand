const EMAIL_SIGN = {
  es: "— el equipo de rebrandyourbrand",
  ca: "— l'equip de rebrandyourbrand",
  eu: "— rebrandyourbrand taldea",
  en: "— the rebrandyourbrand team",
};

/**
 * Devuelve { html, text } con el diseño editorial de marca.
 *  paras:         párrafos en HTML ya escapado (usa bold() y lines())
 *  cta:           { label, url } botón principal (opcional)
 *  secondaryLink: { label, url } enlace secundario limpio (opcional)
 *  note:          texto pequeño antes de la firma, en HTML ya escapado (opcional)
 *  quote:         bloque de cita en texto plano (opcional)
 */
function renderEmail(lang, { paras = [], cta = null, secondaryLink = null, note = "", quote = "" }) {
  const l = pickLang(lang);
  const pStyle = "color:#58575E;font-size:14px;line-height:1.65;margin:0 0 20px;";
  const body = paras.map((p) => `<p style="${pStyle}">${p}</p>`).join("");
  const quoteHtml = quote
    ? `<blockquote style="margin:0 0 24px;padding:14px 16px;background-color:#FFFFFF;border-left:2px solid #8CA3C4;border-radius:0 8px 8px 0;color:#17171A;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;">${esc(quote)}</blockquote>`
    : "";
  const button = cta
    ? `<div style="text-align:center;margin:32px 0 20px;"><a href="${esc(cta.url)}" target="_blank" style="background-color:#8CA3C4;color:#0A0A0C;padding:14px 28px;text-decoration:none;font-weight:600;font-size:13px;border-radius:10px;display:inline-block;text-transform:lowercase;">${esc(cta.label)}</a></div>`
    : "";
  const secondary = secondaryLink
    ? `<p style="text-align:center;margin:0 0 24px;font-size:12px;"><a href="${esc(secondaryLink.url)}" target="_blank" style="color:#3D5A85;text-decoration:underline;text-transform:lowercase;">${esc(secondaryLink.label)}</a></p>`
    : "";
  const footer = `<p style="color:#58575E;font-size:12px;line-height:1.55;margin:32px 0 0;border-top:1px solid #E4DED0;padding-top:20px;">${note ? `${note}<br><br>` : ""}${EMAIL_SIGN[l]}</p>`;

  const html = `<!DOCTYPE html>
<html lang="${l}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"></head>
<body style="background-color:#FFFFFF;color:#17171A;font-family:'Inter',Arial,sans-serif;padding:40px 20px;margin:0;">
  <div style="max-width:560px;margin:0 auto;background-color:#EDE6D6;border:1px solid #E4DED0;padding:40px;border-radius:16px;">
    <h2 style="font-family:'Fraunces',Georgia,serif;font-size:22px;letter-spacing:-0.03em;margin:0 0 24px;color:#17171A;font-weight:400;text-transform:lowercase;">rebrandyourbrand</h2>
    ${body}${quoteHtml}${button}${secondary}${footer}
  </div>
</body></html>`;

  const text = [
    ...paras.map(htmlToText),
    quote,
    cta ? `${cta.label}:\n${cta.url}` : "",
    secondaryLink ? `${secondaryLink.label}:\n${secondaryLink.url}` : "",
    [note && htmlToText(note), EMAIL_SIGN[l]].filter(Boolean).join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n\n");

  return { html, text };
}

// Resend con soporte de Idempotency-Key
async function resendSend(env, payload, idempotencyKey) {
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${env.RESEND_API_KEY}` };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify({ from: "rebrandyourbrand <hola@rebrandyourbrand.es>", ...payload }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Resend error: ${res.status}`);
}

// Aviso interno con el mismo diseño. El asunto y el texto empiezan siempre en minúscula.
function alertAdmin(env, subject, text, ctx) {
  const p = resendSend(
    env,
    {
      to: ["hola@rebrandyourbrand.es"],
      subject: `aviso interno — ${lc1(subject)}`,
      ...renderEmail("es", { paras: [esc(lc1(text)).replace(/\n/g, "<br>")] }),
    },
    `alert-${Date.now()}-${randomHex(4)}`
  ).catch((e) => console.error("alertAdmin failed:", e?.message));
  if (ctx?.waitUntil) ctx.waitUntil(p);
  return p;
}

async function reviewUrl(env, projectToken) {
  return buildUrl("/valorar", { p: projectToken, t: await reviewSig(await getKey(env), projectToken) });
}

async function sendReviewInvite(env, proj, projectToken) {
  const lang = pickLang(proj.lang);
  const t = EM[lang].review;
  await resendSend(
    env,
    {
      to: [proj.clientEmail],
      subject: t.subject(proj.brand),
      ...renderEmail(lang, {
        paras: [t.hello, t.intro(bold(proj.brand)), t.ask, t.thanks],
        cta: { label: t.cta, url: await reviewUrl(env, projectToken) },
        note: t.note,
      }),
    },
    `review-invite-${projectToken}`
  );
}
