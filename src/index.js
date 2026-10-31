const HTML_CLIENT_PATHS = new Set(["/verify", "/valorar", "/approve-phase", "/cancel-renewal"]);

const HTML_ADMIN_PATHS = new Set(["/testimonial", "/testimonial-delete", "/advance-phase", "/responder-chat"]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/webhook/stripe") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "method_not_allowed" }, 405, null, { Allow: "POST" });
      }
      try {
        return await handleStripeWebhook(request, env);
      } catch (e) {
        console.error("stripe webhook failed:", e?.message);
        return jsonResponse({ error: "webhook_failed" }, 500, null);
      }
    }

    if (HTML_CLIENT_PATHS.has(url.pathname) || HTML_ADMIN_PATHS.has(url.pathname)) {
      try {
        if (url.pathname === "/verify") return await handleVerify(request, env, ctx, url);
        if (url.pathname === "/testimonial") return await handleTestimonialReview(request, env, url);
        if (url.pathname === "/testimonial-delete") return await handleTestimonialDelete(request, env, url);
        if (url.pathname === "/advance-phase") return await handlePhaseAdvance(request, env, url);
        if (url.pathname === "/responder-chat") return await handleStudioChat(request, env, url);
        if (url.pathname === "/approve-phase") return await handlePhaseApprove(request, env, url);
        if (url.pathname === "/cancel-renewal") return await handleCancelRenewal(request, env, url);
        if (url.pathname === "/valorar") return await handleReview(request, env, url);
      } catch (e) {
        console.error("html route failed:", e?.message);
        return errorPage(HTML_CLIENT_PATHS.has(url.pathname) ? langFromRequest(request) : "es");
      }
    }

    if (url.pathname === "/file") {
      try {
        return await handleFileDownload(request, env, url);
      } catch (e) {
        console.error("file route failed:", e?.message);
        return new Response("error al procesar el archivo", { status: 500 });
      }
    }

    if (url.pathname === "/proyecto") {
      try {
        return await handleProject(request, env, url);
      } catch (e) {
        console.error("project page failed:", e?.message);
        return errorPage(langFromRequest(request));
      }
    }

    const origin = request.headers.get("Origin");
    const originOk = ALLOWED_ORIGINS.includes(origin);
    const o = originOk ? origin : request.method === "GET" ? "*" : null;

    if (request.method === "OPTIONS") {
      return originOk
        ? new Response(null, { status: 204, headers: corsHeaders(origin) })
        : new Response(null, { status: 403 });
    }

    if (url.pathname === "/webhook/email") return handleEmailForm(request, env, originOk, o);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/testimonials")) {
      try {
        const approved = (await env.LEADS_KV.get(APPROVED_KEY, { type: "json", cacheTtl: 60 })) || [];
        const publicList = approved.map(({ name, business, rating, comment }) => ({
          name,
          business,
          rating,
          comment,
        }));
        return jsonResponse(publicList, 200, originOk ? origin : "*", {
          "Cache-Control": "public, max-age=60",
        });
      } catch (e) {
        console.error("testimonials failed:", e?.message);
        return jsonResponse([], 200, originOk ? origin : "*", { "Cache-Control": "no-store" });
      }
    }

    if (!originOk) return jsonResponse({ error: "forbidden_origin" }, 403, null);
    if (request.method !== "POST") {
      return jsonResponse({ error: "method_not_allowed" }, 405, o, { Allow: "GET, POST, OPTIONS" });
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

    return handleChatPost(request, env, body, o);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(handleScheduled(controller, env, ctx));
  },
};
