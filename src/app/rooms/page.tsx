import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { Panel } from "@/components/ui";
import { RoomsActions } from "./RoomsActions";
import { RoomRow } from "./RoomRow";
import { SignOutButton } from "./SignOutButton";

export default async function RoomsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const isGuest = user.is_anonymous === true;
  if (isGuest) {
    const { data: firstRoom } = await supabase
      .from("room_members")
      .select("room_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (firstRoom) redirect(`/rooms/${firstRoom.room_id}`);
    return (
      <main className="mx-auto max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold text-amber-400">You&apos;re a guest</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Ask your DM for an invite link to join a room.
        </p>
        <div className="mt-4">
          <SignOutButton />
        </div>
      </main>
    );
  }

  const [{ data: memberships }, { data: rooms }, { data: profile }] =
    await Promise.all([
      supabase
        .from("room_members")
        .select("room_id, role")
        .eq("user_id", user.id),
      supabase.from("rooms").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("display_name").eq("id", user.id).single(),
    ]);

  const roleByRoom = new Map(
    (memberships ?? []).map((m) => [m.room_id, m.role]),
  );

  const activeRooms = (rooms ?? []).filter((r) => !r.archived_at);
  const archivedRooms = (rooms ?? []).filter((r) => r.archived_at);

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-amber-400">Malvidra Encounter</h1>
          <p className="text-sm text-neutral-400">
            Signed in as {profile?.display_name ?? user.email}
          </p>
        </div>
        <SignOutButton />
      </header>

      <RoomsActions />

      <Panel title="Your rooms" className="mt-6">
        {activeRooms.length > 0 ? (
          <ul className="divide-y divide-neutral-800">
            {activeRooms.map((room) => (
              <RoomRow
                key={room.id}
                id={room.id}
                name={room.name}
                role={room.dm_id === user.id ? "dm" : (roleByRoom.get(room.id) ?? "player")}
                archived={false}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-500">
            No rooms yet. Create one as DM, or join with an invite code.
          </p>
        )}
      </Panel>

      {archivedRooms.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-neutral-500 hover:text-neutral-300">
            Archived ({archivedRooms.length})
          </summary>
          <Panel title="Archived rooms" className="mt-2">
            <ul className="divide-y divide-neutral-800 opacity-70">
              {archivedRooms.map((room) => (
                <RoomRow
                  key={room.id}
                  id={room.id}
                  name={room.name}
                  role={room.dm_id === user.id ? "dm" : (roleByRoom.get(room.id) ?? "player")}
                  archived
                />
              ))}
            </ul>
          </Panel>
        </details>
      )}
    </main>
  );
}
