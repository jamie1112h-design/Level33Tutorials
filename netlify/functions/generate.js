// Level 33 Tutorials — generate.js  (Fix 06 · SSE Streaming)
// Validates subscriber access code against Supabase, logs the session,
// then streams the course generation response from Anthropic to the client
// using Server-Sent Events — eliminating the Netlify 10-second timeout risk.
//
// Required environment variables (set in Netlify dashboard):
//   ANTHROPIC_API_KEY       — your Anthropic key (sk-ant-...)
//   SUPABASE_URL            — your Supabase project URL
//   SUPABASE_SERVICE_KEY    — your Supabase secret key (server-side only)
//
// Requires @netlify/functions v2.x in package.json (see note at bottom).

const { stream } = require("@netlify/functions");

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

// ── Helper: plain JSON error response ───────────────────────────────────────
function jsonError(status, message) {
  return new Response(
    JSON.stringify({ error: { message } }),
    { status, headers: { ...CORS, "Content-Type": "application/json" } }
  );
}

// ── Main handler (streaming) ─────────────────────────────────────────────────
exports.handler = stream(async (event) => {

  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return new Response("", { status: 200, headers: CORS });
  }

  if (event.httpMethod !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // ── Parse request ────────────────────────────────────────────────────────
  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return jsonError(400, "Invalid request body.");
  }

  const {
    accessCode, model, max_tokens, messages,
    subject, frameCount, eduLevel, learnLevel, language
  } = payload;

  // ── Validate access code against Supabase ────────────────────────────────
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const codeClean   = (accessCode || "").trim().toUpperCase();

  if (!codeClean) {
    return jsonError(401, "No access code provided.");
  }

  let subscriberId = null;

  try {
    const supaRes = await fetch(
      `${supabaseUrl}/rest/v1/subscribers?access_code=eq.${encodeURIComponent(codeClean)}&select=id,status`,
      { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
    );
    const rows = await supaRes.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      return jsonError(401, "Invalid access code. Visit level33tutorials.com to purchase access.");
    }
    if (rows[0].status !== "active") {
      return jsonError(403, "Your subscription is no longer active. Please renew at level33tutorials.com.");
    }

    subscriberId = rows[0].id;

  } catch (err) {
    console.error("Supabase validation error:", err);
    return jsonError(500, "Could not verify access. Please try again.");
  }

  // ── Log session to Supabase (non-fatal) ──────────────────────────────────
  let sessionId = null;

  try {
    const sessionRes = await fetch(`${supabaseUrl}/rest/v1/sessions`, {
      method:  "POST",
      headers: {
        "apikey":        supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type":  "application/json",
        "Prefer":        "return=representation"
      },
      body: JSON.stringify({
        subscriber_id: subscriberId,
        subject:       subject    || "",
        frame_count:   frameCount || 10,
        edu_level:     eduLevel   || "",
        learn_level:   learnLevel || "intermediate",
        language:      language   || "en",
        completed:     false
      })
    });
    const sessionRows = await sessionRes.json();
    if (Array.isArray(sessionRows) && sessionRows.length > 0) {
      sessionId = sessionRows[0].id;
    }
  } catch (err) {
    console.error("Session logging error:", err);
    // Non-fatal — continue without a sessionId
  }

  // ── Open streaming request to Anthropic ──────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  let anthropicRes;

  try {
    anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model:      model      || "claude-haiku-4-5-20251001",
        max_tokens: max_tokens || 6000,
        stream:     true,           // ← the key change from Fix 06
        messages
      })
    });
  } catch (err) {
    console.error("Anthropic connection error:", err);
    return jsonError(502, "Could not reach the AI service. Please try again.");
  }

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    console.error("Anthropic non-200:", anthropicRes.status, errText);
    return jsonError(anthropicRes.status, "AI service error. Please try again.");
  }

  // ── Build the outbound SSE stream ─────────────────────────────────────────
  // First event: session_start carries the sessionId so the client can mark
  // the session complete when the stream ends (same role as before).
  // Remaining events: raw SSE chunks forwarded unchanged from Anthropic.

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {

      // Emit session metadata before any content
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "session_start", sessionId })}\n\n`
        )
      );

      // Pipe Anthropic's SSE stream directly to the client
      const reader = anthropicRes.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } catch (err) {
        console.error("Stream pipe error:", err);
      } finally {
        controller.close();
      }
    }
  });

  return new Response(readable, {
    status: 200,
    headers: {
      ...CORS,
      "Content-Type":    "text/event-stream",
      "Cache-Control":   "no-cache",
      "X-Accel-Buffering": "no"   // prevents proxy-layer buffering
    }
  });

});

// ── Package note ─────────────────────────────────────────────────────────────
// This file uses the stream() wrapper from @netlify/functions v2.
// Make sure your package.json contains:
//   "@netlify/functions": "^2.0.0"
// If it currently shows "^1.x.x", update the version and push — Netlify will
// install the new package automatically on next deploy.
