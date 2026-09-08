// Pings the Supabase database with a lightweight query so the free-tier
// project doesn't pause after a week of inactivity.
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/heartbeat.mjs
//
// Runs on a cron from .github/workflows/heartbeat.yml.
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_KEY.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

const { count, error } = await supabase
  .from("rooms")
  .select("id", { count: "exact", head: true })
  .limit(1);

if (error) {
  console.error("Ping failed:", error);
  process.exit(1);
}

console.log("Ping successful:", count);
