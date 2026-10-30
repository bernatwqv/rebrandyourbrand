const enc = new TextEncoder();

let cachedSecret = "";
let cachedKeyPromise = null;

const getKey = (env) => {
  if (!env.CHAT_SIGNING_SECRET) throw new HttpError(500, "misconfigured");
  if (cachedSecret !== env.CHAT_SIGNING_SECRET || !cachedKeyPromise) {
    cachedSecret = env.CHAT_SIGNING_SECRET;
    cachedKeyPromise = crypto.subtle.importKey(
      "raw",
      enc.encode(cachedSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );
  }
  return cachedKeyPromise;
};

const toHex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

const fromHex = (h) => Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16));

const signRaw = async (key, text) => toHex(await crypto.subtle.sign("HMAC", key, enc.encode(text)));

const verifyRaw = async (key, text, sig) =>
  typeof sig === "string" &&
  /^[0-9a-f]{64}$/.test(sig) &&
  (await crypto.subtle.verify("HMAC", key, fromHex(sig), enc.encode(text)));

const randomHex = (bytes) => toHex(crypto.getRandomValues(new Uint8Array(bytes)));

const signMsg = (key, text) => signRaw(key, `msg|${text}`);

const verifyMsg = (key, text, sig) => verifyRaw(key, `msg|${text}`, sig);

const confirmPayload = (email, brand, plan) => `confirm|${email}|${brand}|${plan.ids.join(",")}`;

// Tokens deterministas firmados por HMAC (sin depender de claves temporales en KV)
const getActionToken = (key, projectToken, step) => signRaw(key, `action|${projectToken}|${step}`);

const approvePhaseToken = (key, projectToken, step) => signRaw(key, `approve|${projectToken}|${step}`);

const cancelRenewalToken = (key, projectToken, dueIso) => signRaw(key, `crenew|${projectToken}|${dueIso}`);

const testimonialDeleteToken = (key, id) => signRaw(key, `tdel|${id}`);

const reviewSig = (key, projectToken) => signRaw(key, `review|${projectToken}`);

const resumeSig = (key, verifyToken) => signRaw(key, `resume|${verifyToken}`);

async function advancePhaseUrl(env, projectToken, step) {
  const key = await getKey(env);
  const t = await getActionToken(key, projectToken, step);
  return buildUrl("/advance-phase", { p: projectToken, step, t });
}

async function approvePhaseUrl(env, projectToken, step) {
  const key = await getKey(env);
  const t = await approvePhaseToken(key, projectToken, step);
  return buildUrl("/approve-phase", { p: projectToken, step, t });
}

async function cancelRenewalUrl(env, projectToken, dueIso) {
  const key = await getKey(env);
  const t = await cancelRenewalToken(key, projectToken, dueIso);
  return buildUrl("/cancel-renewal", { p: projectToken, due: dueIso, t });
}

// Sesión de chat: se emite tras resolver Turnstile una vez. Va firmada (HMAC), caduca y está ligada a la IP.
async function makeSession(key, ip) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  return `${exp}.${await signRaw(key, `session|${exp}|${ipKey(ip)}`)}`;
}

async function verifySession(key, session, ip) {
  if (typeof session !== "string" || session.length > 100) return false;
  const [exp, sig] = session.split(".");
  if (!/^\d{10}$/.test(exp || "") || Number(exp) < Date.now() / 1000) return false;
  return verifyRaw(key, `session|${exp}|${ipKey(ip)}`, sig);
}

async function verifyTurnstile(env, token, ip, action = "brandi-chat") {
  if (typeof token !== "string" || !token || token.length > 2048) throw new HttpError(403, "captcha_failed");
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  if (ip) body.set("remoteip", ip);
  let res;
  try {
    res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new HttpError(503, "captcha_unavailable");
  }
  const r = await res.json().catch(() => null);
  if (!r?.success || !ALLOWED_HOSTNAMES.includes(r.hostname) || r.action !== action) {
    throw new HttpError(403, "captcha_failed");
  }
}

function ipKey(ip) {
  if (!ip) return "unknown";
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  return [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t]
    .slice(0, 4)
    .map((g) => g.padStart(4, "0"))
    .join(":");
}

async function parseResume(key, token) {
  if (typeof token !== "string" || token.length !== 129) return null;
  const [vt, sig] = token.split(".");
  if (!/^[a-f0-9]{64}$/.test(vt || "")) return null;
  return (await verifyRaw(key, `resume|${vt}`, sig)) ? vt : null;
}
