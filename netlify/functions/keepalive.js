// PrecisionSteps Tutorials – keepalive.js (version 2)
// Deploy as netlify/functions/keepalive.js (the "_v2" is only the download name).
// Change from version 1: reads SUPABASE_SERVICE_KEY like every other function
// (falls back to SUPABASE_SERVICE_ROLE_KEY if that is the one you set), and
// does not need the supabase-js package: it makes one small REST call.

const handler = async () => {
  try {
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!process.env.SUPABASE_URL || !key) throw new Error("Supabase environment variables are missing.");

    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/subscribers?select=id&limit=1`, {
      headers: { "apikey": key, "Authorization": `Bearer ${key}` }
    });
    if (!res.ok) throw new Error(`Supabase responded ${res.status}`);

    console.log("Supabase keep-alive ping successful:", new Date().toISOString());
    return { statusCode: 200 };
  } catch (err) {
    console.error("Keep-alive ping failed:", err.message);
    return { statusCode: 500 };
  }
};

module.exports = { handler };
