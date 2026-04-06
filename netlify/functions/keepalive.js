const { createClient } = require("@supabase/supabase-js");

const handler = async () => {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const { error } = await supabase
      .from("subscribers")
      .select("id")
      .limit(1);

    if (error) throw error;
    console.log("Supabase keep-alive ping successful:", new Date().toISOString());
    return { statusCode: 200 };
  } catch (err) {
    console.error("Keep-alive ping failed:", err.message);
    return { statusCode: 500 };
  }
};

module.exports = { handler };
