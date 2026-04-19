// Level 33 Tutorials — resend-code.js
// Self-service access code recovery.
// Looks up the subscriber by email and resends their access code via Resend.
//
// Security note: always returns 200 regardless of whether the email exists
// to prevent email enumeration attacks.
//
// Required environment variables:
//   SUPABASE_URL          — your Supabase project URL
//   SUPABASE_SERVICE_KEY  — your Supabase secret key
//   RESEND_API_KEY        — your Resend API key
//   RESEND_FROM_ADDRESS   — your verified sending address

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

  const email = (payload.email || "").trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return {
      statusCode: 400,
      headers: corsJson(),
      body: JSON.stringify({ error: { message: "A valid email address is required." } })
    };
  }

  // ── Look up subscriber in Supabase ───────────────────────────────────────────
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  try {
    const supaRes = await fetch(
      `${supabaseUrl}/rest/v1/subscribers?email=eq.${encodeURIComponent(email)}&status=eq.active&select=email,access_code`,
      {
        headers: {
          "apikey":        supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    const rows = await supaRes.json();

    // If no active subscriber found — return 200 silently (no email enumeration)
    if (!Array.isArray(rows) || rows.length === 0) {
      return {
        statusCode: 200,
        headers: corsJson(),
        body: JSON.stringify({ ok: true })
      };
    }

    const { access_code } = rows[0];

    // ── Send recovery email via Resend ─────────────────────────────────────────
    const resendKey  = process.env.RESEND_API_KEY;
    const fromAddr   = process.env.RESEND_FROM_ADDRESS;

    const emailBody = {
      from:    fromAddr,
      to:      [email],
      subject: "Your Level 33 access code",
      html: `
        <div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:2rem;color:#2a1f0e;background:#f5f0e8;">
          <p style="font-size:0.7rem;letter-spacing:0.4em;text-transform:uppercase;color:#9a7a45;margin-bottom:0.5rem;">Level 33 Mastermind</p>
          <h1 style="font-size:1.6rem;font-weight:400;margin-bottom:1.5rem;border-bottom:1px solid #b8965a;padding-bottom:1rem;">Your access code</h1>
          <p style="font-size:1rem;font-weight:300;line-height:1.7;margin-bottom:1.5rem;">Here is your access code for the Level 33 Programmed Learning Machine:</p>
          <div style="background:#fff;border:1px solid rgba(155,120,65,0.3);border-radius:4px;padding:1.2rem 1.8rem;font-size:1.5rem;font-family:monospace;letter-spacing:0.15em;color:#2a1f0e;text-align:center;margin-bottom:1.5rem;">
            ${access_code}
          </div>
          <p style="font-size:0.9rem;font-weight:300;line-height:1.7;margin-bottom:1.5rem;">
            <a href="https://level33tutorials.com" style="color:#9a7a45;">Return to level33tutorials.com</a> and enter this code at the gate to begin your session.
          </p>
          <p style="font-size:0.8rem;color:#8a7050;font-style:italic;">If you did not request this email, you can safely ignore it.</p>
        </div>
      `
    };

    await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type":  "application/json"
      },
      body: JSON.stringify(emailBody)
    });

  } catch (err) {
    console.error("resend-code error:", err);
    // Still return 200 — don't expose internal errors to the client
  }

  // Always return 200 with the same message whether or not the email was found
  return {
    statusCode: 200,
    headers: corsJson(),
    body: JSON.stringify({ ok: true })
  };
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function corsJson() {
  return {
    "Content-Type":                "application/json",
    "Access-Control-Allow-Origin": "*"
  };
}
