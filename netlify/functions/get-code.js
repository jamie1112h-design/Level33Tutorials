// PrecisionSteps Tutorials – get-code.js (version 2). Deploy as netlify/functions/get-code.js.
// Change: no more Access-Control-Allow-Origin "*"; session id format check; best-effort rate limit.
// Polled by the welcome page after Stripe checkout.
// Looks up the access code by Stripe checkout session ID.
// Returns the code once the webhook has processed it, 404 if not yet ready.
//
// Required environment variables:
//   SUPABASE_URL          — your Supabase project URL
//   SUPABASE_SERVICE_KEY  — your Supabase secret key

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
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Max-Age":       "600",
        "Vary": "Origin"
      },
      body: ""
    };
  }

  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  // GET from our own page needs no Origin header, so only the CORS reply is restricted here.

  const sessionId = event.queryStringParameters?.session_id;

  // Stripe checkout session ids look like cs_live_... / cs_test_...; reject anything else.
  if (sessionId && !/^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(sessionId)) {
    return { statusCode: 400, headers: corsJson(), body: JSON.stringify({ error: "Invalid session_id." }) };
  }
  // The welcome page polls this: allow plenty, but cap abuse (best effort).
  if (rateLimited(`getcode:${clientIp(event)}`, 120, 10 * 60 * 1000)) {
    return { statusCode: 429, headers: corsJson(), body: JSON.stringify({ error: "Too many requests." }) };
  }

  if (!sessionId) {
    return {
      statusCode: 400,
      headers: corsJson(),
      body: JSON.stringify({ error: "No session_id provided." })
    };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  try {
    const supaRes = await fetch(
      `${supabaseUrl}/rest/v1/subscribers?stripe_session_id=eq.${encodeURIComponent(sessionId)}&select=access_code,email`,
      {
        headers: {
          "apikey":        supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    const rows = await supaRes.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      // Webhook not yet processed — client should retry
      return {
        statusCode: 404,
        headers: corsJson(),
        body: JSON.stringify({ ready: false })
      };
    }

    return {
      statusCode: 200,
      headers: corsJson(),
      body: JSON.stringify({
        ready:       true,
        access_code: rows[0].access_code,
        email:       rows[0].email
      })
    };

  } catch (err) {
    console.error("get-code error:", err);
    return {
      statusCode: 500,
      headers: corsJson(),
      body: JSON.stringify({ error: "Could not retrieve access code." })
    };
  }
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function corsJson() {
  const h = { "Content-Type": "application/json", "Vary": "Origin" };
  if (reqOrigin && allowedOrigins().includes(reqOrigin)) h["Access-Control-Allow-Origin"] = reqOrigin;
  return h;
}
