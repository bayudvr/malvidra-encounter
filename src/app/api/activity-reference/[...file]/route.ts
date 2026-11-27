import { allowedReference, fetchBounded, safeHeaders } from "@/lib/activity-media";
import { encounterBase } from "@/lib/encounter-activity";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ file: string[] }> }) {
  if (!encounterBase) return new Response(null, { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response(null, { status: 401 });
  const url = allowedReference((await params).file);
  if (!url) return new Response(null, { status: 400 });
  try {
    const { output } = await fetchBounded(url, new Set(["application/json","text/plain"]), 12 * 1024 * 1024);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(output));
    return new Response(JSON.stringify(parsed), { headers: safeHeaders("application/json; charset=utf-8") });
  } catch { return new Response(null, { status: 502 }); }
}
