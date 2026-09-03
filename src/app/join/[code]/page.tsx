import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { GuestJoin } from "./GuestJoin";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not signed in → let them join as a guest (anonymous auth). No account needed.
  if (!user) {
    return (
      <main className="flex min-h-full items-center justify-center p-6">
        <GuestJoin code={code} />
      </main>
    );
  }

  const { data: roomId, error } = await supabase.rpc("join_room", {
    p_code: code,
  });

  if (error || !roomId) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-lg font-semibold text-red-400">
          Could not join room
        </h1>
        <p className="mt-2 text-sm text-neutral-400">
          {error?.message ?? "That invite code doesn't match any room."}
        </p>
        <Link href="/rooms" className="mt-4 inline-block text-sm text-amber-400">
          ← Back to rooms
        </Link>
      </main>
    );
  }

  redirect(`/rooms/${roomId}`);
}
