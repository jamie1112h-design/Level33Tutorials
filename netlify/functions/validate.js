// PrecisionSteps Tutorials – validate.js (version 2). Deploy as netlify/functions/validate.js.
// Change: allowed origins only, and a best-effort rate limit per IP.
// Lightweight access code validation against Supabase.
// Used by the auto-login check on page load — no Anthropic call involved.
//
// Required environment variables (set in Netlify dashboard):
//   SUPABASE_URL          — your Supabase project URL
//   SUPABASE_SERVICE_KEY  — your Supabase secret key (server-side only)

// ── Origin allow-list and best-effort rate limiting (Stage 0 hardening, BDL v4 Decision 38) ──
const DEFAULT_ORIGINS = [
  "https://precisionstepstutorials.com",
  "https://www.precisionstepstutorials.com"
];
function allowedOrigins() {
  return process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map(s => s.trim()).filter(Boolean)
    : DEFAULT_ORIGINS;
}
let reqOrigin = "";   // set at the start of each request (one request at a time per instance)
const hits = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (recent.length >= max) { hits.set(key, recent); return true; }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) { if (!v.some(t => now - t < windowMs)) hits.delete(k); }
  }
  return false;
}
function clientIp(event) {
  return (event.headers["x-nf-client-connection-ip"] ||
          (event.headers["x-forwarded-for"] || "").split(",")[0] || "unknown").trim();
}

exports.handler = async (event) => {

  // ── CORS preflight ───────────────────────────────────────────────────────────
  reqOrigin = event.headers["origin"] || event.headers["Origin"] || "";
  const originOk = allowedOrigins().includes(reqOrigin);
  if (event.httpMethod === "OPTIONS") {
    if (!originOk) return { statusCode: 403, body: "" };
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin":  reqOrigin,
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Max-Age":       "600",
        "Vary": "Origin"
      },
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // Only our own pages may call this from a browser; 30 checks per IP per 10 minutes (best effort).
  if (!originOk) return { statusCode: 403, body: JSON.stringify({ error: { message: "Forbidden." } }) };
  if (rateLimited(`validate:${clientIp(event)}`, 30, 10 * 60 * 1000)) {
    return { statusCode: 429, headers: corsJson(), body: JSON.stringify({ error: { message: "Too many requests. Please try again later." } }) };
  }

  // ── Parse request ───────────────────────────────────────────────────────────
  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      headers: corsJson(),
      body: JSON.stringify({ error: { message: "Invalid request body." } })
    };
  }

  const { accessCode } = payload;
  const codeClean = (accessCode || "").trim().toUpperCase();

  if (!codeClean) {
    return {
      statusCode: 401,
      headers: corsJson(),
      body: JSON.stringify({ error: { message: "No access code provided." } })
    };
  }

  // ── Validate against Supabase ───────────────────────────────────────────────
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  try {
    const supaRes = await fetch(
      `${supabaseUrl}/rest/v1/subscribers?access_code=eq.${encodeURIComponent(codeClean)}&select=status`,
      {
        headers: {
          "apikey":        supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    const rows = await supaRes.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      return {
        statusCode: 401,
        headers: corsJson(),
        body: JSON.stringify({ error: { message: "Invalid access code." } })
      };
    }

    if (rows[0].status !== "active") {
      return {
        statusCode: 403,
        headers: corsJson(),
        body: JSON.stringify({ error: { message: "Subscription inactive." } })
      };
    }

    // ── Success ─────────────────────────────────────────────────────────────
    return {
      statusCode: 200,
      headers: corsJson(),
      body: JSON.stringify({ valid: true })
    };

  } catch (err) {
    console.error("Supabase validation error:", err);
    return {
      statusCode: 500,
      headers: corsJson(),
      body: JSON.stringify({ error: { message: "Could not verify access. Please try again." } })
    };
  }
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function corsJson() {
  const h = { "Content-Type": "application/json", "Vary": "Origin" };
  if (reqOrigin && allowedOrigins().includes(reqOrigin)) h["Access-Control-Allow-Origin"] = reqOrigin;
  return h;
}
