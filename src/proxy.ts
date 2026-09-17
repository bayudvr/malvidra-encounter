import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // reference-index.json (public/, fetched client-side by ReferencePanel) is a static asset
    // like the image extensions below — it must never round-trip through the auth session
    // check, or an expired/missing session serves the /login redirect's HTML in place of JSON.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|json)$).*)",
  ],
};
