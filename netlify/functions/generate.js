// PrecisionSteps Tutorials – generate.js (version 2, Stage 0 hardening)
// Deploy this file to Netlify as netlify/functions/generate.js (the "_v2" is only the download name).
//
// What changed from version 1 (BDL v3, Decision 35):
//   1. CORS is limited to your own site(s) instead of "*", and requests from other origins are refused.
//   2. The browser can no longer choose the model. The model is fixed on the server.
//   3. max_tokens is clamped (never above 8000), so a caller cannot ask for huge outputs.
//   4. Request size, message count, field lengths, frame count and language are validated.
//   5. Best-effort rate limits per access code and per IP address (per warm server instance).
//   6. Free trial: valid-email check, upsert fixed with on_conflict=email, and the lesson is
//      claimed BEFORE generation (atomic compare-and-set) and refunded if generation fails.
//
// Still to do (Stage 0, next patch): build the prompt on the server from subject, frameCount,
// eduLevel, learnLevel and language, instead of accepting browser-built messages. That needs the
// current index.html prompt text.
//
// Required environment variables (Netlify dashboard):
//   ANTHROPIC_API_KEY      – your Anthropic key (sk-ant-...)
//   SUPABASE_URL           – your Supabase project URL
//   SUPABASE_SERVICE_KEY   – your Supabase secret key (server-side only)
// Optional environment variables:
//   ALLOWED_ORIGINS        – comma-separated list of allowed origins
//                            (default: https://precisionstepstutorials.com and https://www.precisionstepstutorials.com)
//   ANTHROPIC_MODEL        – model name (default: claude-sonnet-5)

const DEFAULT_ORIGINS = [
  "https://precisionstepstutorials.com",
  "https://www.precisionstepstutorials.com"
];

const MODEL            = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const MAX_TOKENS_CAP   = 8000;
const MAX_TOKENS_FLOOR = 500;
const MAX_TOKENS_DEFAULT = 6000;   // matches what index.html sends today
const MAX_BODY_CHARS   = 60000;
const MAX_MESSAGES     = 6;
const MAX_MESSAGE_CHARS = 40000;   // total across all messages
const FREE_LIMIT       = 5;
const LANGUAGES        = ["en", "fr", "es"];

// ── Best-effort rate limiting (memory of one warm function instance) ─────────────
const hits = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (recent.length >= max) { hits.set(key, recent); return true; }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {            // keep memory bounded
    for (const [k, v] of hits) { if (!v.some(t => now - t < windowMs)) hits.delete(k); }
  }
  return false;
}

exports.handler = async (event) => {

  const allowed = (process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map(s => s.trim()).filter(Boolean)
    : DEFAULT_ORIGINS);
  const origin = event.headers["origin"] || event.headers["Origin"] || "";
  const originOk = allowed.includes(origin);

  // ── CORS preflight ───────────────────────────────────────────────────────────
  if (event.httpMethod === "OPTIONS") {
    if (!originOk) return { statusCode: 403, body: "" };
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin":  origin,
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

  // Only our own pages may call this function from a browser.
  if (!originOk) {
    return { statusCode: 403, body: JSON.stringify({ error: { message: "Forbidden." } }) };
  }

  const cors = () => ({
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin"
  });
  const fail = (statusCode, message, extra = {}) => ({
    statusCode, headers: cors(), body: JSON.stringify({ error: { message }, ...extra })
  });

  const ip = (event.headers["x-nf-client-connection-ip"] ||
              (event.headers["x-forwarded-for"] || "").split(",")[0] || "unknown").trim();

  // ── Parse and validate the request ───────────────────────────────────────────
  if (!event.body || event.body.length > MAX_BODY_CHARS) {
    return fail(413, "Request too large.");
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return fail(400, "Invalid request body."); }

  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

  const codeClean   = str(payload.accessCode, 40).toUpperCase();
  const subject     = str(payload.subject, 200);
  const eduLevel    = str(payload.eduLevel, 40);
  const learnLevel  = str(payload.learnLevel, 40) || "intermediate";
  const language    = LANGUAGES.includes(payload.language) ? payload.language : "en";
  const frameCount  = Math.min(Math.max(parseInt(payload.frameCount, 10) || 10, 1), 30);
  const maxTokens   = Math.min(Math.max(parseInt(payload.max_tokens, 10) || MAX_TOKENS_DEFAULT, MAX_TOKENS_FLOOR), MAX_TOKENS_CAP);

  if (!codeClean) return fail(401, "No access code provided.");

  // messages: 1 to 6 items, role user/assistant, text only, bounded total size
  const messages = [];
  let totalChars = 0;
  if (!Array.isArray(payload.messages) || payload.messages.length < 1 || payload.messages.length > MAX_MESSAGES) {
    return fail(400, "Invalid request.");
  }
  for (const m of payload.messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return fail(400, "Invalid request.");
    let text = "";
    if (typeof m.content === "string") {
      text = m.content;
    } else if (Array.isArray(m.content) && m.content.every(b => b && b.type === "text" && typeof b.text === "string")) {
      text = m.content.map(b => b.text).join("\n");
    } else {
      return fail(400, "Invalid request.");
    }
    totalChars += text.length;
    if (totalChars > MAX_MESSAGE_CHARS) return fail(413, "Request too large.");
    messages.push({ role: m.role, content: text });
  }
  if (messages[0].role !== "user") return fail(400, "Invalid request.");

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const sbHeaders = {
    "apikey":        supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type":  "application/json"
  };

  async function callAnthropic() {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: maxTokens,
        thinking:   { type: "disabled" },
        messages
      })
    });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  }

  // ── Free trial path ──────────────────────────────────────────────────────────
  // lessons_used in Supabase is the server-side source of truth.
  if (codeClean === "TRIAL-FREE") {
    const emailClean = str(payload.trialEmail, 254).toLowerCase();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailClean);
    if (!emailOk) return fail(400, "A valid email address is required for the free trial.");

    // 10 trial generations per IP per day (best effort), plus a short burst limit.
    if (rateLimited(`trial-ip:${ip}`, 10, 24 * 60 * 60 * 1000) ||
        rateLimited(`trial-burst:${ip}`, 3, 60 * 1000)) {
      return fail(429, "Too many requests. Please try again later.");
    }

    try {
      // Create the trial user if new; refresh last_seen_at if returning.
      const upsertRes = await fetch(`${supabaseUrl}/rest/v1/trial_users?on_conflict=email`, {
        method: "POST",
        headers: { ...sbHeaders, "Prefer": "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({ email: emailClean, last_seen_at: new Date().toISOString() })
      });
      const upsertRows = await upsertRes.json();
      if (!Array.isArray(upsertRows) || upsertRows.length === 0) throw new Error("Upsert returned no rows.");

      const lessonsUsed = upsertRows[0].lessons_used || 0;

      if (lessonsUsed >= FREE_LIMIT) {
        return fail(403, "Your 5 free lessons are complete. Subscribe to continue.", { trialComplete: true });
      }

      // Claim the lesson first. The filter on the old value makes this a compare-and-set,
      // so two simultaneous requests cannot both use the same remaining lesson.
      const claimRes = await fetch(
        `${supabaseUrl}/rest/v1/trial_users?email=eq.${encodeURIComponent(emailClean)}&lessons_used=eq.${lessonsUsed}`,
        {
          method: "PATCH",
          headers: { ...sbHeaders, "Prefer": "return=representation" },
          body: JSON.stringify({ lessons_used: lessonsUsed + 1 })
        }
      );
      const claimRows = await claimRes.json();
      if (!Array.isArray(claimRows) || claimRows.length === 0) {
        return fail(409, "Another lesson is already being prepared. Please wait a moment and try again.");
      }

      const result = await callAnthropic();

      if (!result.ok) {
        // Generation failed: give the lesson back.
        await fetch(
          `${supabaseUrl}/rest/v1/trial_users?email=eq.${encodeURIComponent(emailClean)}&lessons_used=eq.${lessonsUsed + 1}`,
          { method: "PATCH", headers: sbHeaders, body: JSON.stringify({ lessons_used: lessonsUsed }) }
        ).catch(() => {});
        return { statusCode: result.status, headers: cors(), body: JSON.stringify({ ...result.data, lessonsUsed }) };
      }

      return { statusCode: 200, headers: cors(), body: JSON.stringify({ ...result.data, lessonsUsed: lessonsUsed + 1 }) };

    } catch (err) {
      console.error("Trial path error:", err);
      return fail(502, "Could not process your trial request. Please try again.");
    }
  }

  // ── Subscriber path ──────────────────────────────────────────────────────────
  if (!/^PST-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(codeClean)) {
    return fail(401, "Invalid access code. Visit precisionstepstutorials.com to purchase access.");
  }

  // 40 lessons per code per hour and 60 per IP per hour (best effort).
  if (rateLimited(`code:${codeClean}`, 40, 60 * 60 * 1000) ||
      rateLimited(`ip:${ip}`, 60, 60 * 60 * 1000)) {
    return fail(429, "Too many requests. Please try again later.");
  }

  let subscriberId = null;
  try {
    const supaRes = await fetch(
      `${supabaseUrl}/rest/v1/subscribers?access_code=eq.${encodeURIComponent(codeClean)}&select=id,status`,
      { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
    );
    const rows = await supaRes.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      return fail(401, "Invalid access code. Visit precisionstepstutorials.com to purchase access.");
    }
    if (rows[0].status !== "active") {
      return fail(403, "Your subscription is no longer active. Please renew at precisionstepstutorials.com.");
    }
    subscriberId = rows[0].id;
  } catch (err) {
    console.error("Supabase validation error:", err);
    return fail(500, "Could not verify access. Please try again.");
  }

  // ── Log session to Supabase (non-fatal) ──────────────────────────────────────
  let sessionId = null;
  try {
    const sessionRes = await fetch(`${supabaseUrl}/rest/v1/sessions`, {
      method: "POST",
      headers: { ...sbHeaders, "Prefer": "return=representation" },
      body: JSON.stringify({
        subscriber_id: subscriberId,
        subject,
        frame_count:   frameCount,
        edu_level:     eduLevel,
        learn_level:   learnLevel,
        language,
        completed:     false
      })
    });
    const sessionRows = await sessionRes.json();
    if (Array.isArray(sessionRows) && sessionRows.length > 0) sessionId = sessionRows[0].id;
  } catch (err) {
    console.error("Session logging error:", err);
  }

  // ── Generate ─────────────────────────────────────────────────────────────────
  try {
    const result = await callAnthropic();
    return { statusCode: result.status, headers: cors(), body: JSON.stringify({ ...result.data, sessionId }) };
  } catch (err) {
    console.error("Anthropic proxy error:", err);
    return fail(502, "Could not reach the AI service. Please try again.");
  }
};
