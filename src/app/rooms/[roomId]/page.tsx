import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { RoomView } from "@/components/room/RoomView";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/rooms/${roomId}`);

  const { data: room } = await supabase
    .from("rooms")
    .select("id, name, dm_id")
    .eq("id", roomId)
    .maybeSingle();

  if (!room) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-lg font-semibold text-red-400">Room not found</h1>
        <p className="mt-2 text-sm text-neutral-400">
          You may not be a member of this room, or it no longer exists.
        </p>
        <Link href="/rooms" className="mt-4 inline-block text-sm text-amber-400">
          ← Back to rooms
        </Link>
      </main>
    );
  }

  const { data: membership } = await supabase
    .from("room_members")
    .select("role")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();

  const role = room.dm_id === user.id ? "dm" : membership?.role;
  if (!role) redirect("/rooms");

  return (
    <RoomView
      roomId={roomId}
      roomName={room.name}
      userId={user.id}
      role={role}
    />
  );
}
