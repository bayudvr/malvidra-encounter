import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const url = request.nextUrl;
  const returnTo = (path: string) => NextResponse.redirect(new URL(path, url.origin));
  const { data: { user: before } } = await supabase.auth.getUser();
  // Identity linking must begin with an authenticated, non-guest Encounter account.
  if (!before || before.is_anonymous) return returnTo("/login");
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.has("error")) return returnTo("/account?error=link");
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return returnTo("/account?error=link");
  if (data.user.id !== before.id) {
    await supabase.auth.signOut({ scope: "local" });
    return returnTo("/login");
  }
  const { data: { user }, error: verifyError } = await supabase.auth.getUser();
  if (verifyError || user?.id !== before.id || !user.identities?.some(identity => identity.provider === "discord")) return returnTo("/account?error=link");
  return returnTo("/account?linked=1");
}
