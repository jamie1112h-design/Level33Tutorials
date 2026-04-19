// Level 33 Tutorials — get-code.js
// Polled by the welcome page after Stripe checkout.
// Looks up the access code by Stripe checkout session ID.
// Returns the code once the webhook has processed it, 404 if not yet ready.
//
// Required environment variables:
//   SUPABASE_URL          — your Supabase project URL
//   SUPABASE_SERVICE_KEY  — your Supabase secret key

exports.handler = async (event) => {

  // ── CORS preflight ───────────────────────────────────────────────────────────
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS"
      },
      body: ""
    };
  }

  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const sessionId = event.queryStringParameters?.session_id;

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
  return {
    "Content-Type":                "application/json",
    "Access-Control-Allow-Origin": "*"
  };
}
