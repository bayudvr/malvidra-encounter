import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = url.searchParams.get("next");
  const target = next && /^\/rooms(?:\/|\?|$)/.test(next) && !next.includes("\\") ? next : "/rooms";
  const fail = () => NextResponse.redirect(new URL("/login?error=discord", url.origin));
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.has("error")) return fail();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user || data.user.is_anonymous) return fail();
  const { data: { user }, error: verifyError } = await supabase.auth.getUser();
  if (verifyError || !user || user.id !== data.user.id || !user.identities?.some(i => i.provider === "discord")) {
    await supabase.auth.signOut({ scope: "local" });
    return fail();
  }
  const response = NextResponse.redirect(new URL(target, url.origin));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
