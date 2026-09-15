import { CastByToken } from "./CastByToken";

// Public — no auth. `/cast` is allow-listed in src/lib/supabase/middleware.ts.
// The receiver device (Chromecast / smart display) loads this URL itself with
// no Supabase session; the token authorises read-only access via RLS.
export default async function CastTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <CastByToken token={token} />;
}
