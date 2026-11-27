import { allowedImage, fetchBounded, IMAGE_TYPES, safeHeaders } from "@/lib/activity-media";
import { encounterBase } from "@/lib/encounter-activity";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  if (!encounterBase) return new Response(null, { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response(null, { status: 401 });
  const url = allowedImage(new URL(request.url).searchParams.get("url"));
  if (!url) return new Response(null, { status: 400 });
  try {
    const { output, type } = await fetchBounded(url, IMAGE_TYPES, 10 * 1024 * 1024);
    return new Response(output, { headers: safeHeaders(type) });
  } catch { return new Response(null, { status: 502 }); }
}
