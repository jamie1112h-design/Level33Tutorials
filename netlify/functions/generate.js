// Level 33 Tutorials — generate.js
// Validates subscriber access code against Supabase, then proxies to Anthropic API
//
// Required environment variables (set in Netlify dashboard):
//   ANTHROPIC_API_KEY       — your Anthropic key (sk-ant-...)
//   SUPABASE_URL            — your Supabase project URL
//   SUPABASE_SERVICE_KEY    — your Supabase secret key (server-side only)

exports.handler = async (event) => {

  // ── CORS preflight ───────────────────────────────────────────────────────────
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
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

  const { accessCode, model, max_tokens, messages } = payload;

  // ── Validate access code against Supabase ────────────────────────────────────
  const supabaseUrl  = process.env.SUPABASE_URL;
  const supabaseKey  = process.env.SUPABASE_SERVICE_KEY;
  const codeClean    = (accessCode || "").trim().toUpperCase();

  if (!codeClean) {
    return {
      statusCode: 401,
      headers: corsJson(),
      body: JSON.stringify({ error: { message: "No access code provided." } })
    };
  }

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
        body: JSON.stringify({
          error: { message: "Invalid access code. Visit level33tutorials.com to purchase access." }
        })
      };
    }

    if (rows[0].status !== "active") {
      return {
        statusCode: 403,
        headers: corsJson(),
        body: JSON.stringify({
          error: { message: "Your subscription is no longer active. Please renew at level33tutorials.com." }
        })
      };
    }

  } catch (err) {
    console.error("Supabase validation error:", err);
    return {
      statusCode: 500,
      headers: corsJson(),
      body: JSON.stringify({ error: { message: "Could not verify access. Please try again." } })
    };
  }

  // ── Forward to Anthropic ─────────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model:      model      || "claude-haiku-4-5-20251001",
        max_tokens: max_tokens || 6000,
        messages
      })
    });

    const data = await anthropicRes.json();

    return {
      statusCode: anthropicRes.status,
      headers:    corsJson(),
      body:       JSON.stringify(data)
    };

  } catch (err) {
    console.error("Anthropic proxy error:", err);
    return {
      statusCode: 502,
      headers:    corsJson(),
      body:       JSON.stringify({ error: { message: "Could not reach the AI service. Please try again." } })
    };
  }
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function corsJson() {
  return {
    "Content-Type":                "application/json",
    "Access-Control-Allow-Origin": "*"
  };
}
