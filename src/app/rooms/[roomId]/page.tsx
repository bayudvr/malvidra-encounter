import Link from "next/link";
import { redirect } from "next/navigation";

import { RoomView } from "@/components/room/RoomView";
import { createClient } from "@/lib/supabase/server";

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

  if (!user) {
    redirect(`/login?next=/rooms/${roomId}`);
  }

  const { data: membership } = await supabase
    .from("room_members")
    .select("id, display_name, role")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-lg font-semibold text-red-400">
          You&apos;re not in this room
        </h1>

        <p className="mt-2 text-sm text-neutral-400">
          You may not be a member of this room, or the room
          no longer exists.
        </p>

        <Link
          href="/rooms"
          className="mt-4 inline-block text-sm text-amber-400"
        >
          ← Back to rooms
        </Link>
      </main>
    );
  }

  const { data: room } = await supabase
    .from("rooms")
    .select("id, name, room_code")
    .eq("id", roomId)
    .maybeSingle();

  if (!room) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-lg font-semibold text-red-400">
          Room not found
        </h1>

        <p className="mt-2 text-sm text-neutral-400">
          This room may have been deleted.
        </p>

        <Link
          href="/rooms"
          className="mt-4 inline-block text-sm text-amber-400"
        >
          ← Back to rooms
        </Link>
      </main>
    );
  }

  return (
    <RoomView
      roomId={room.id}
      roomName={room.name}
      userId={user.id}
      role={membership.role}
    />
  );
}