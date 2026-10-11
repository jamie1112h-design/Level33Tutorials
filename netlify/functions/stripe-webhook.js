// PrecisionSteps Tutorials – stripe-webhook.js (version 3, Stage 0 hardening)
// Deploy as netlify/functions/stripe-webhook.js (the "_v3" is only the download name).
//
// What changed from version 1 (BDL v3, Decision 37):
//   1. A repeat purchase by an email already in `subscribers` no longer fails silently.
//      The existing row is reactivated with the new Stripe ids and the SAME access code is re-sent.
//   2. Access codes use crypto.randomInt (cryptographically secure) instead of Math.random,
//      and a rare code collision is retried.
//   3. Real failures (database or email) now return HTTP 500 so Stripe retries the event
//      (it retries for up to three days) instead of the customer being charged with no code.
//      Every step is safe to repeat.
//   4. Raw body is decoded correctly if Netlify delivers it base64-encoded (signature check).
//   5. Emails are stored lowercase. Welcome and trial-ending email copy uses an en dash.
//
// Handles Stripe subscription events:
//   checkout.session.completed            -> create or reactivate subscriber, email the access code
//   customer.subscription.deleted         -> mark subscriber as cancelled
//   customer.subscription.updated         -> handle trial-to-active conversion
//   customer.subscription.trial_will_end  -> send trial ending reminder email
//   invoice.payment_failed                -> log payment failures
//
// Required environment variables (Netlify dashboard):
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY,
//   RESEND_API_KEY, RESEND_FROM_ADDRESS

const stripe = require("stripe");
const crypto = require("crypto");

function sbHeaders(extra = {}) {
  return {
    "Content-Type":  "application/json",
    "apikey":        process.env.SUPABASE_SERVICE_KEY,
    "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    ...extra
  };
}

// Case-insensitive exact match on email (escapes the LIKE wildcards % and _).
async function findSubscriberByEmail(email) {
  const pattern = encodeURIComponent(email.replace(/[\\%_]/g, "\\$&"));
  const res = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/subscribers?email=ilike.${pattern}&select=id,access_code&limit=1`,
    { headers: sbHeaders() }
  );
  if (!res.ok) throw new Error("Subscriber lookup failed: " + (await res.text()));
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function reactivateSubscriber(id, fields) {
  const res = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/subscribers?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: sbHeaders({ "Prefer": "return=minimal" }),
      body: JSON.stringify({ ...fields, status: "active" })
    }
  );
  if (!res.ok) throw new Error("Subscriber reactivation failed: " + (await res.text()));
}

exports.handler = async (event) => {

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // ── Verify Stripe webhook signature (needs the exact raw body) ───────────────
  const stripeClient  = stripe(process.env.STRIPE_SECRET_KEY);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature     = event.headers["stripe-signature"];
  const rawBody       = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripeClient.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Signature verification failed: ${err.message}` })
    };
  }

  // ── Handle events ────────────────────────────────────────────────────────────
  try {

    // ── New subscription / payment completed ────────────────────────────────────
    if (stripeEvent.type === "checkout.session.completed") {
      const session = stripeEvent.data.object;

      if (session.mode !== "subscription") {
        return { statusCode: 200, body: JSON.stringify({ received: true }) };
      }

      const email = (session.customer_details?.email || session.customer_email || "").trim().toLowerCase();
      const stripeFields = {
        stripe_customer_id:     session.customer,
        stripe_subscription_id: session.subscription,
        stripe_session_id:      session.id
      };

      if (!email) {
        console.error("No email found in checkout session:", session.id);
        return { statusCode: 200, body: JSON.stringify({ received: true }) };
      }

      let accessCode = null;

      // Returning customer (or a Stripe retry): reuse the existing row and code.
      const existing = await findSubscriberByEmail(email);
      if (existing) {
        await reactivateSubscriber(existing.id, stripeFields);
        accessCode = existing.access_code;
        console.log(`Existing subscriber reactivated: ${email}`);
      } else {
        // New customer: insert with a fresh code, retrying on the rare code collision.
        for (let attempt = 0; attempt < 5 && !accessCode; attempt++) {
          const code = generateAccessCode();
          const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/subscribers`, {
            method: "POST",
            headers: sbHeaders({ "Prefer": "return=minimal" }),
            body: JSON.stringify({ email, access_code: code, ...stripeFields, status: "active" })
          });
          if (res.ok) {
            accessCode = code;
          } else if (res.status === 409) {
            // Either a simultaneous request created this email, or the code collided.
            const again = await findSubscriberByEmail(email);
            if (again) {
              await reactivateSubscriber(again.id, stripeFields);
              accessCode = again.access_code;
            }
          } else {
            throw new Error("Supabase insert error: " + (await res.text()));
          }
        }
        if (!accessCode) throw new Error("Could not allocate a unique access code.");
      }

      await sendWelcomeEmail(email, accessCode);
      console.log(`Subscriber activated: ${email}`);

    // ── Subscription cancelled ──────────────────────────────────────────────────
    } else if (stripeEvent.type === "customer.subscription.deleted") {
      const subscriptionId = stripeEvent.data.object.id;

      const supaRes = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/subscribers?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}`,
        {
          method: "PATCH",
          headers: sbHeaders({ "Prefer": "return=minimal" }),
          body: JSON.stringify({ status: "cancelled" })
        }
      );
      if (!supaRes.ok) throw new Error("Supabase cancellation update error: " + (await supaRes.text()));
      console.log(`Subscription cancelled: ${subscriptionId}`);

    // ── Trial converted to paid (or other subscription update) ─────────────────
    } else if (stripeEvent.type === "customer.subscription.updated") {
      const subscription   = stripeEvent.data.object;
      const subscriptionId = subscription.id;

      if (subscription.status === "active" && !subscription.trial_end) {
        const supaRes = await fetch(
          `${process.env.SUPABASE_URL}/rest/v1/subscribers?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}`,
          {
            method: "PATCH",
            headers: sbHeaders({ "Prefer": "return=minimal" }),
            body: JSON.stringify({ status: "active" })
          }
        );
        if (!supaRes.ok) throw new Error("Supabase trial conversion error: " + (await supaRes.text()));
        console.log(`Trial converted to active: ${subscriptionId}`);
      }

    // ── Trial ending in 3 days – send reminder email ────────────────────────────
    } else if (stripeEvent.type === "customer.subscription.trial_will_end") {
      const subscriptionId = stripeEvent.data.object.id;

      const supaRes = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/subscribers?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=email`,
        { headers: sbHeaders() }
      );
      if (!supaRes.ok) throw new Error("Supabase trial lookup error: " + (await supaRes.text()));

      const rows = await supaRes.json();
      if (Array.isArray(rows) && rows.length > 0) {
        await sendTrialEndingEmail(rows[0].email);
        console.log(`Trial ending reminder sent to: ${rows[0].email}`);
      }

    // ── Payment failed – log for monitoring ────────────────────────────────────
    } else if (stripeEvent.type === "invoice.payment_failed") {
      console.log(`Payment failed for customer: ${stripeEvent.data.object.customer}`);
    }

  } catch (err) {
    // A real failure: answer 500 so Stripe retries. Every step above is safe to repeat.
    console.error("Webhook handler error:", err);
    return { statusCode: 500, body: JSON.stringify({ received: false, error: "handler_error" }) };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

// ── Generate access code (cryptographically secure) ──────────────────────────
function generateAccessCode() {
  const chars   = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const segment = () =>
    Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join("");
  return `PST-${segment()}-${segment()}`;
}

// ── Send welcome email via Resend ─────────────────────────────────────────────
async function sendWelcomeEmail(email, code) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from:    process.env.RESEND_FROM_ADDRESS,
      to:      email,
      subject: "Your PrecisionSteps Tutorials Access Code",
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:2rem 1rem;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0"
               style="background:#fff9f0;border:1px solid rgba(155,120,65,0.25);border-radius:4px;padding:2.5rem 2.8rem;max-width:520px;">
          <tr>
            <td style="padding-bottom:0.3rem;">
              <p style="margin:0;font-size:0.65rem;letter-spacing:0.45em;text-transform:uppercase;color:#9a7a45;">PrecisionSteps Tutorials</p>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:1.8rem;border-bottom:1px solid rgba(155,120,65,0.2);">
              <h1 style="margin:0.4rem 0 0;font-size:1.7rem;font-weight:normal;color:#2a1f0e;">Programmed Learning Service</h1>
            </td>
          </tr>
          <tr>
            <td style="padding-top:1.8rem;padding-bottom:1.4rem;">
              <p style="margin:0;font-size:1.05rem;line-height:1.75;color:#2a1f0e;">Welcome. Your subscription is confirmed. Below is your personal access code – keep it somewhere safe.</p>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:1.8rem;">
              <div style="background:#f5f0e8;border:1px solid rgba(155,120,65,0.35);border-radius:4px;padding:1.6rem;text-align:center;">
                <p style="margin:0 0 0.5rem;font-size:0.62rem;letter-spacing:0.4em;text-transform:uppercase;color:#9a7a45;">Your Access Code</p>
                <p style="margin:0;font-size:2rem;font-family:monospace;letter-spacing:0.18em;color:#2a1f0e;font-weight:bold;">${code}</p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:1.4rem;">
              <p style="margin:0;font-size:1rem;line-height:1.75;color:#2a1f0e;">
                Visit <a href="https://precisionstepstutorials.com" style="color:#9a7a45;text-decoration:none;border-bottom:1px solid rgba(155,120,65,0.4);">precisionstepstutorials.com</a>, enter your code, and your first session begins. The app will remember your code on that device.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:2rem;">
              <p style="margin:0;font-size:0.88rem;line-height:1.65;color:#6b5535;font-style:italic;">If you ever access the service from a new device or browser, enter this code again to restore your session.</p>
            </td>
          </tr>
          <tr>
            <td style="border-top:1px solid rgba(155,120,65,0.18);padding-top:1.2rem;">
              <p style="margin:0;font-size:0.72rem;color:#9a7050;letter-spacing:0.05em;">PrecisionSteps Tutorials &nbsp;&middot;&nbsp; precisionstepstutorials.com</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
    })
  });

  if (!res.ok) {
    throw new Error("Resend welcome email error: " + (await res.text()));
  }
}

// ── Send trial ending reminder via Resend ─────────────────────────────────────
async function sendTrialEndingEmail(email) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from:    process.env.RESEND_FROM_ADDRESS,
      to:      email,
      subject: "Your PrecisionSteps Tutorials free trial ends in 3 days",
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:2rem 1rem;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0"
               style="background:#fff9f0;border:1px solid rgba(155,120,65,0.25);border-radius:4px;padding:2.5rem 2.8rem;max-width:520px;">
          <tr>
            <td style="padding-bottom:0.3rem;">
              <p style="margin:0;font-size:0.65rem;letter-spacing:0.45em;text-transform:uppercase;color:#9a7a45;">PrecisionSteps Tutorials</p>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:1.8rem;border-bottom:1px solid rgba(155,120,65,0.2);">
              <h1 style="margin:0.4rem 0 0;font-size:1.7rem;font-weight:normal;color:#2a1f0e;">Your trial ends in 3 days</h1>
            </td>
          </tr>
          <tr>
            <td style="padding-top:1.8rem;padding-bottom:1.4rem;">
              <p style="margin:0;font-size:1.05rem;line-height:1.75;color:#2a1f0e;">
                Your free trial of the PrecisionSteps Tutorials Programmed Learning Service ends in 3 days. No action is needed – your subscription will continue seamlessly and your card will be charged at that point.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:1.4rem;">
              <p style="margin:0;font-size:1rem;line-height:1.75;color:#2a1f0e;">
                If you have any questions, reply to this email and we will get back to you promptly.
              </p>
            </td>
          </tr>
          <tr>
            <td style="border-top:1px solid rgba(155,120,65,0.18);padding-top:1.2rem;">
              <p style="margin:0;font-size:0.72rem;color:#9a7050;letter-spacing:0.05em;">PrecisionSteps Tutorials &nbsp;&middot;&nbsp; precisionstepstutorials.com</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
    })
  });

  if (!res.ok) {
    throw new Error("Resend trial ending email error: " + (await res.text()));
  }
}
