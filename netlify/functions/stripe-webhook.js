// Level 33 Tutorials — stripe-webhook.js
// Handles Stripe subscription events:
//   checkout.session.completed       → generate access code, write to Supabase, email subscriber
//   customer.subscription.deleted    → mark subscriber as cancelled in Supabase
//   customer.subscription.updated    → handle trial-to-active conversion
//   customer.subscription.trial_will_end → send trial ending reminder email
//   invoice.payment_failed           → log payment failures
//
// Required environment variables (set in Netlify dashboard):
//   STRIPE_SECRET_KEY       — sk_live_... 
//   STRIPE_WEBHOOK_SECRET   — whsec_... (from Stripe webhook dashboard)
//   SUPABASE_URL            — your Supabase project URL
//   SUPABASE_SERVICE_KEY    — your Supabase secret key
//   RESEND_API_KEY          — your Resend API key
//   RESEND_FROM_ADDRESS     — e.g. access@level33tutorials.com

const stripe = require("stripe");

exports.handler = async (event) => {

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // ── Verify Stripe webhook signature ──────────────────────────────────────────
  const stripeClient  = stripe(process.env.STRIPE_SECRET_KEY);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature     = event.headers["stripe-signature"];

  let stripeEvent;
  try {
    stripeEvent = stripeClient.webhooks.constructEvent(
      event.body,
      signature,
      webhookSecret
    );
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

      const email          = session.customer_details?.email;
      const customerId     = session.customer;
      const subscriptionId = session.subscription;
      const sessionId      = session.id;                    // ← Fix 05: store this

      if (!email) {
        console.error("No email found in checkout session:", session.id);
        return { statusCode: 200, body: JSON.stringify({ received: true }) };
      }

      const accessCode = generateAccessCode();

      const supaRes = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/subscribers`,
        {
          method: "POST",
          headers: {
            "Content-Type":  "application/json",
            "apikey":        process.env.SUPABASE_SERVICE_KEY,
            "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
            "Prefer":        "return=minimal"
          },
          body: JSON.stringify({
            email,
            access_code:            accessCode,
            stripe_customer_id:     customerId,
            stripe_subscription_id: subscriptionId,
            stripe_session_id:      sessionId,             // ← Fix 05: stored here
            status:                 "active"
          })
        }
      );

      if (!supaRes.ok) {
        const errText = await supaRes.text();
        console.error("Supabase insert error:", errText);
        return { statusCode: 200, body: JSON.stringify({ received: true, warning: "db_error" }) };
      }

      await sendWelcomeEmail(email, accessCode);
      console.log(`New subscriber activated: ${email} → ${accessCode}`);

    // ── Subscription cancelled ──────────────────────────────────────────────────
    } else if (stripeEvent.type === "customer.subscription.deleted") {
      const subscription   = stripeEvent.data.object;
      const subscriptionId = subscription.id;

      const supaRes = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/subscribers?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type":  "application/json",
            "apikey":        process.env.SUPABASE_SERVICE_KEY,
            "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
            "Prefer":        "return=minimal"
          },
          body: JSON.stringify({ status: "cancelled" })
        }
      );

      if (!supaRes.ok) {
        console.error("Supabase cancellation update error:", await supaRes.text());
      } else {
        console.log(`Subscription cancelled: ${subscriptionId}`);
      }

    // ── Trial converted to paid (or other subscription update) ─────────────────
    } else if (stripeEvent.type === "customer.subscription.updated") {
      const subscription   = stripeEvent.data.object;
      const subscriptionId = subscription.id;

      // If trial has ended and subscription is now active, update status
      if (subscription.status === "active" && !subscription.trial_end) {
        const supaRes = await fetch(
          `${process.env.SUPABASE_URL}/rest/v1/subscribers?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type":  "application/json",
              "apikey":        process.env.SUPABASE_SERVICE_KEY,
              "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
              "Prefer":        "return=minimal"
            },
            body: JSON.stringify({ status: "active" })
          }
        );

        if (!supaRes.ok) {
          console.error("Supabase trial conversion error:", await supaRes.text());
        } else {
          console.log(`Trial converted to active: ${subscriptionId}`);
        }
      }

    // ── Trial ending in 3 days — send reminder email ────────────────────────────
    } else if (stripeEvent.type === "customer.subscription.trial_will_end") {
      const subscription   = stripeEvent.data.object;
      const subscriptionId = subscription.id;

      // Look up subscriber email
      const supaRes = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/subscribers?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=email`,
        {
          headers: {
            "apikey":        process.env.SUPABASE_SERVICE_KEY,
            "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
          }
        }
      );

      const rows = await supaRes.json();
      if (Array.isArray(rows) && rows.length > 0) {
        await sendTrialEndingEmail(rows[0].email);
        console.log(`Trial ending reminder sent to: ${rows[0].email}`);
      }

    // ── Payment failed — log for monitoring ────────────────────────────────────
    } else if (stripeEvent.type === "invoice.payment_failed") {
      const invoice = stripeEvent.data.object;
      console.log(`Payment failed for customer: ${invoice.customer}`);
    }

  } catch (err) {
    console.error("Webhook handler error:", err);
    return { statusCode: 200, body: JSON.stringify({ received: true, error: err.message }) };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

// ── Generate access code ──────────────────────────────────────────────────────
function generateAccessCode() {
  const chars   = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const segment = () =>
    Array.from({ length: 4 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  return `L33-${segment()}-${segment()}`;
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
      subject: "Your Level 33 Tutorials Access Code",
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
              <p style="margin:0;font-size:0.65rem;letter-spacing:0.45em;text-transform:uppercase;color:#9a7a45;">Level 33 Mastermind</p>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:1.8rem;border-bottom:1px solid rgba(155,120,65,0.2);">
              <h1 style="margin:0.4rem 0 0;font-size:1.7rem;font-weight:normal;color:#2a1f0e;">Programmed Learning Machine</h1>
            </td>
          </tr>
          <tr>
            <td style="padding-top:1.8rem;padding-bottom:1.4rem;">
              <p style="margin:0;font-size:1.05rem;line-height:1.75;color:#2a1f0e;">Welcome. Your subscription is confirmed. Below is your personal access code — keep it somewhere safe.</p>
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
                Visit <a href="https://level33tutorials.com" style="color:#9a7a45;text-decoration:none;border-bottom:1px solid rgba(155,120,65,0.4);">level33tutorials.com</a>, enter your code, and your first session begins. The app will remember your code on that device.
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
              <p style="margin:0;font-size:0.72rem;color:#9a7050;letter-spacing:0.05em;">Level 33 Mastermind &nbsp;&middot;&nbsp; level33tutorials.com</p>
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
    console.error("Resend welcome email error:", await res.text());
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
      subject: "Your Level 33 free trial ends in 3 days",
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
              <p style="margin:0;font-size:0.65rem;letter-spacing:0.45em;text-transform:uppercase;color:#9a7a45;">Level 33 Mastermind</p>
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
                Your free trial of the Level 33 Programmed Learning Machine ends in 3 days. No action is needed — your subscription will continue seamlessly and your card will be charged at that point.
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
              <p style="margin:0;font-size:0.72rem;color:#9a7050;letter-spacing:0.05em;">Level 33 Mastermind &nbsp;&middot;&nbsp; level33tutorials.com</p>
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
    console.error("Resend trial ending email error:", await res.text());
  }
}
