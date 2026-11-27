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
    return window.location.origin + "/encounter/api/activity-reference/";
  }
  return "https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/";
}

export const imageHosts = new Set(["i.imgur.com","5e.tools","raw.githubusercontent.com","i.pinimg.com","encrypted-tbn0.gstatic.com","www.dndbeyond.com","dndplaybook.lon1.cdn.digitaloceanspaces.com","cdn.phototourl.com","media.discordapp.net","upload.wikimedia.org","images-ext-1.discordapp.net","i.redd.it","github.com"]);
export function activityImageUrl(value: string): string {
  if (!encounterBase || typeof window === "undefined" || window.location.hostname !== "1575922929303294143.discordsays.com") return value;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.port && !url.username && !url.password && imageHosts.has(url.hostname)) {
      return "/encounter/api/activity-image?url=" + encodeURIComponent(url.href);
    }
  } catch { /* use the original URL for local assets */ }
  return value;
}
