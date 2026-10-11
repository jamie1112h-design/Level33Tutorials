// PrecisionSteps Tutorials – complete-session.js (version 2). Deploy as netlify/functions/complete-session.js.
// Changes: allowed origins only; sessionId must be a UUID; score fields validated and size-limited;
// best-effort rate limit per IP.
// Called by the client when a course is completed.
// Updates the session row: sets completed = true.
// Optionally accepts frame_scores and score_pct for in-lesson scoring.
//
// Required environment variables:
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

  if (!originOk) return { statusCode: 403, body: JSON.stringify({ error: { message: "Forbidden." } }) };
  if (!event.body || event.body.length > 20000) {
    return { statusCode: 413, headers: corsJson(), body: JSON.stringify({ error: { message: "Request too large." } }) };
  }
  if (rateLimited(`complete:${clientIp(event)}`, 60, 10 * 60 * 1000)) {
    return { statusCode: 429, headers: corsJson(), body: JSON.stringify({ error: { message: "Too many requests." } }) };
  }

  // ── Parse request ────────────────────────────────────────────────────────────
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

  const { sessionId, frameScores, scorePct } = payload;

  if (typeof sessionId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
    return {
      statusCode: 400,
      headers: corsJson(),
      body: JSON.stringify({ error: { message: "No valid sessionId provided." } })
    };
  }
  if (scorePct !== undefined && (typeof scorePct !== "number" || !(scorePct >= 0 && scorePct <= 100))) {
    return { statusCode: 400, headers: corsJson(), body: JSON.stringify({ error: { message: "Invalid score." } }) };
  }
  if (frameScores !== undefined &&
      (typeof frameScores !== "object" || frameScores === null || JSON.stringify(frameScores).length > 4000)) {
    return { statusCode: 400, headers: corsJson(), body: JSON.stringify({ error: { message: "Invalid scores." } }) };
  }

  // ── Update session in Supabase ───────────────────────────────────────────────
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  const updateBody = { completed: true };
  if (frameScores !== undefined) updateBody.frame_scores = frameScores;
  if (scorePct    !== undefined) updateBody.score_pct    = scorePct;

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/sessions?id=eq.${encodeURIComponent(sessionId)}`,
      {
        method: "PATCH",
        headers: {
          "apikey":        supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type":  "application/json"
        },
        body: JSON.stringify(updateBody)
      }
    );

    if (!res.ok) {
      console.error("Supabase update failed:", res.status);
      return {
        statusCode: 500,
        headers: corsJson(),
        body: JSON.stringify({ error: { message: "Could not update session." } })
      };
    }

    return {
      statusCode: 200,
      headers: corsJson(),
      body: JSON.stringify({ ok: true })
    };

  } catch (err) {
    console.error("complete-session error:", err);
    return {
      statusCode: 500,
      headers: corsJson(),
      body: JSON.stringify({ error: { message: "Could not update session." } })
    };
  }
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function corsJson() {
  const h = { "Content-Type": "application/json", "Vary": "Origin" };
  if (reqOrigin && allowedOrigins().includes(reqOrigin)) h["Access-Control-Allow-Origin"] = reqOrigin;
  return h;
}
