// Level 33 Tutorials — complete-session.js
// Called by the client when a course is completed.
// Updates the session row: sets completed = true.
// Optionally accepts frame_scores and score_pct for in-lesson scoring.
//
// Required environment variables:
//   SUPABASE_URL          — your Supabase project URL
//   SUPABASE_SERVICE_KEY  — your Supabase secret key (server-side only)

exports.handler = async (event) => {

  // ── CORS preflight ───────────────────────────────────────────────────────────
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

  if (!sessionId) {
    return {
      statusCode: 400,
      headers: corsJson(),
      body: JSON.stringify({ error: { message: "No sessionId provided." } })
    };
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
  return {
    "Content-Type":                "application/json",
    "Access-Control-Allow-Origin": "*"
  };
}
