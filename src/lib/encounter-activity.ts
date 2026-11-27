// A separate opt-in build for the Discord proxy. Normal web builds keep root URLs and cookies.
export const encounterBase = process.env.NEXT_PUBLIC_ENCOUNTER_BASE_PATH === "/encounter" ? "/encounter" : "";
export const encounterPath = (path: string) => encounterBase + path;
export const encounterWebsite = "https://malvidra-encounter.vercel.app";
export const activityCookieOptions = encounterBase ? {
  name: "sb-malvidra-encounter-activity",
  path: "/encounter",
  sameSite: "none" as const,
  secure: true,
  partitioned: true,
} : undefined;
export function browserSupabaseUrl() {
  if (encounterBase && typeof window !== "undefined" && window.location.hostname === "1575922929303294143.discordsays.com") {
    return window.location.origin + "/encounter-supabase";
  }
  return process.env.NEXT_PUBLIC_SUPABASE_URL!;
}
export function externalReferenceBase() {
  if (encounterBase && typeof window !== "undefined" && window.location.hostname === "1575922929303294143.discordsays.com") {
    return window.location.origin + "/encounter-reference/5etools-mirror-3/5etools-src/main/data/";
  }
  return "https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/";
}
