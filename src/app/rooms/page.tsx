import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge, Panel } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { RoomsActions } from "./RoomsActions";
import { SignOutButton } from "./SignOutButton";

export default async function RoomsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: memberships, error } = await supabase
    .from("room_members")
    .select("room_id, display_name, role")
    .eq("user_id", user.id);

  if (error) {
    console.error("Failed to load memberships:", error);
  }

  const roomIds = (memberships ?? []).map(
    (membership) => membership.room_id,
  );

  const { data: rooms } =
    roomIds.length > 0
      ? await supabase
          .from("rooms")
          .select("id, name, room_code, created_at")
          .in("id", roomIds)
          .order("created_at", {
            ascending: false,
          })
      : { data: [] };

  const membershipByRoom = new Map(
    (memberships ?? []).map((membership) => [
      membership.room_id,
      membership,
    ]),
  );

  const displayName =
    memberships?.[0]?.display_name ||
    user.user_metadata?.display_name ||
    "Adventurer";

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-amber-400">
            Malvidra Encounter
          </h1>

          <p className="text-sm text-neutral-400">
            Welcome, {displayName}
          </p>
        </div>

        <SignOutButton />
      </header>

      <RoomsActions />

      <Panel title="Your rooms" className="mt-6">
        {rooms && rooms.length > 0 ? (
          <ul className="divide-y divide-neutral-800">
            {rooms.map((room) => {
              const membership =
                membershipByRoom.get(room.id);

              const isDM = membership?.role === "DM";

              return (
                <li key={room.id}>
                  <Link
                    href={`/rooms/${room.id}`}
                    className="flex items-center justify-between gap-4 px-1 py-3 hover:text-amber-300"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {room.name}
                      </div>

                      <div className="mt-1 font-mono text-xs text-neutral-500">
                        {room.room_code}
                      </div>
                    </div>

                    <Badge
                      className={
                        isDM
                          ? "bg-amber-500/15 text-amber-300"
                          : "bg-sky-500/15 text-sky-300"
                      }
                    >
                      {isDM ? "DM" : "Player"}
                    </Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-neutral-500">
            No rooms yet. Create one as DM, or join an
            existing room with its code.
          </p>
        )}
      </Panel>
    </main>
  );
}