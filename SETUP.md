# Level 33 Tutorials — Environment Variables & Setup Checklist
# Set ALL of these in Netlify: Site configuration → Environment variables

# ── ANTHROPIC ────────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-YOUR_KEY_HERE

# ── SUPABASE ─────────────────────────────────────────────────────────────────
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
SUPABASE_SERVICE_KEY=YOUR_SUPABASE_SECRET_KEY_HERE

# ── RESEND ───────────────────────────────────────────────────────────────────
RESEND_API_KEY=re_YOUR_RESEND_KEY_HERE
RESEND_FROM_ADDRESS=access@level33tutorials.com

# ── STRIPE ───────────────────────────────────────────────────────────────────
STRIPE_SECRET_KEY=sk_test_YOUR_KEY_HERE        # swap for sk_live_... when going live
STRIPE_WEBHOOK_SECRET=whsec_YOUR_SECRET_HERE   # generated after registering webhook URL


# ════════════════════════════════════════════════════════════════════════════
# COMPLETE SETUP CHECKLIST
# ════════════════════════════════════════════════════════════════════════════

## STEP A — Supabase: Create the subscribers table
# 1. Go to your Supabase project dashboard
# 2. Click SQL Editor in the left sidebar
# 3. Paste the entire contents of supabase-setup.sql
# 4. Click Run (green button)
# 5. Confirm you see "Success. No rows returned"

## STEP B — GitHub: Create repository and push files
# 1. Go to github.com → New repository → name it l33-tutorials → Create
# 2. On your Mac, open Terminal and run:
#
#    cd ~/Desktop          (or wherever you save this folder)
#    git init
#    git add .
#    git commit -m "Initial deploy"
#    git branch -M main
#    git remote add origin https://github.com/YOUR_USERNAME/l33-tutorials.git
#    git push -u origin main

## STEP C — Netlify: Connect repo and deploy
# 1. netlify.com → Add new site → Import an existing project → GitHub
# 2. Authorize GitHub → select l33-tutorials repo
# 3. Build settings auto-detected from netlify.toml — leave as-is
# 4. Click Deploy site
# 5. Note your temporary URL: something.netlify.app
# ✓ TEST CHECKPOINT 1: Visit the temporary URL — you should see the access code screen

## STEP D — Netlify: Set environment variables
# 1. Site configuration → Environment variables
# 2. Add all 7 variables from the list above (fill in your actual values)
# 3. Deploys → Trigger deploy → Deploy site
# ✓ TEST CHECKPOINT 2: Open the site — enter a test code (anything), confirm you get
#   an "Invalid access code" error (proves the Supabase connection is working)

## STEP E — Stripe: Create product and payment link
# 1. Stripe dashboard (sandbox mode) → Product catalog → Add product
#    Name: Level 33 Programmed Learning Machine
#    Price: $9.99 (or your chosen amount) → Recurring → Monthly
#    Save product
# 2. Payment Links → Create payment link → select your product
#    Copy the payment link URL
# 3. In index.html, replace YOUR_STRIPE_PAYMENT_LINK_HERE with that URL
# 4. git add . && git commit -m "Add Stripe payment link" && git push
#    (Netlify auto-redeploys in ~30 seconds)

## STEP F — Netlify: Connect custom domain
# 1. Site configuration → Domain management → Add custom domain
#    Enter: level33tutorials.com
# 2. Netlify shows you DNS records to add
# 3. Go to Cloudflare → level33tutorials.com → DNS → Records
#    Add the records Netlify specifies (usually 2: CNAME + TXT)
# 4. Back in Netlify, click Verify DNS configuration
# 5. Netlify auto-provisions SSL certificate (~5 minutes on Cloudflare)
# ✓ TEST CHECKPOINT 3: Visit https://level33tutorials.com — confirm HTTPS padlock

## STEP G — Stripe: Register webhook
# 1. Stripe dashboard → Developers → Webhooks → Add endpoint
#    Endpoint URL: https://level33tutorials.com/.netlify/functions/stripe-webhook
#    Events to listen for (select these 3):
#      ✓ checkout.session.completed
#      ✓ customer.subscription.deleted
#      ✓ invoice.payment_failed
# 2. Add endpoint → copy the Signing secret (whsec_...)
# 3. Add it to Netlify env vars as STRIPE_WEBHOOK_SECRET → redeploy

## STEP H — End-to-end test (Stripe test mode)
# 1. Visit https://level33tutorials.com → click "Subscribe here"
# 2. Use Stripe test card: 4242 4242 4242 4242, any future date, any CVC
# 3. Complete checkout
# 4. Check your email — welcome email should arrive with an L33-XXXX-XXXX code
# 5. Check Supabase table editor — confirm a new row appeared with status "active"
# 6. Enter the code at level33tutorials.com — confirm a course generates
# 7. Close browser and reopen level33tutorials.com — confirm it skips the code screen
# ✓ TEST CHECKPOINT 4: Full flow confirmed working

## STEP I — Go live
# 1. Stripe → toggle from Test mode to Live mode
# 2. Copy your live Secret key (sk_live_...) and live Webhook secret
# 3. Update STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in Netlify env vars
# 4. Update the Stripe webhook endpoint with your live URL (same URL, just live mode)
# 5. Redeploy
# 6. Make one real test purchase with your own card to confirm end-to-end
# ✓ LIVE — Level 33 Tutorials is open for business
