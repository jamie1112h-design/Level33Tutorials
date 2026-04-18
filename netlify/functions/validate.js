// Level 33 Tutorials — validate.js
// Lightweight access code validation against Supabase.
// Used by the auto-login check on page load — no Anthropic call involved.
//
// Required environment variables (set in Netlify dashboard):
//   SUPABASE_URL          — your Supabase project URL
//   SUPABASE_SERVICE_KEY  — your Supabase secret key (server-side only)

exports.handler = async (event) => {

  // ── CORS preflight ──────────────────────────────────────────────────────────
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
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

// ── Helpers ─────────────────────────────────────────────────────────────────
function corsJson() {
  return {
    "Content-Type":                "application/json",
    "Access-Control-Allow-Origin": "*"
  };
}
