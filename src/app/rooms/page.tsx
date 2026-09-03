import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { Badge, Panel } from "@/components/ui";
import { RoomsActions } from "./RoomsActions";
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
        {rooms && rooms.length > 0 ? (
          <ul className="divide-y divide-neutral-800">
            {rooms.map((room) => {
              const role = room.dm_id === user.id ? "dm" : roleByRoom.get(room.id);
              return (
                <li key={room.id}>
                  <Link
                    href={`/rooms/${room.id}`}
                    className="flex items-center justify-between px-1 py-3 hover:text-amber-300"
                  >
                    <span className="font-medium">{room.name}</span>
                    <Badge
                      className={
                        role === "dm"
                          ? "bg-amber-500/15 text-amber-300"
                          : "bg-sky-500/15 text-sky-300"
                      }
                    >
                      {role === "dm" ? "DM" : "Player"}
                    </Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-neutral-500">
            No rooms yet. Create one as DM, or join with an invite code.
          </p>
        )}
      </Panel>
    </main>
  );
}
