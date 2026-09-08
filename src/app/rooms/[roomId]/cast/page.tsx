import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { CastView } from "@/components/room/CastView";

// The projector view: the DM opens this in a second window and drops it on a
// projector / external display. DM-only — players already get this perspective
// on the normal room page.
export default async function CastPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/rooms/${roomId}/cast`);

  const { data: room } = await supabase
    .from("rooms")
    .select("id, name, dm_id")
    .eq("id", roomId)
    .maybeSingle();

  if (!room || room.dm_id !== user.id) redirect(`/rooms/${roomId}`);

  return <CastView roomId={roomId} roomName={room.name} userId={user.id} />;
}
