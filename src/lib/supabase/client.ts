import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/database.types";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/**
 * Anonymous client for the public `/cast/<token>` screen. It carries no auth
 * session; every read is authorised by the `x-cast-token` header, which the
 * `cast_room_id()` RLS branch resolves to a single room (see migration 0014).
 * Read-only by construction — writes still fail the DM-only policies.
 */
export function createCastClient(castToken: string) {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Never share (or become) the app's cached singleton client — this one
      // carries an auth header the authed client must not inherit.
      isSingleton: false,
      global: { headers: { "x-cast-token": castToken } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
