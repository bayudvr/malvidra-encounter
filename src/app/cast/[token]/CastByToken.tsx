"use client";

import { useEffect, useState } from "react";

import { createCastClient } from "@/lib/supabase/client";
import { CastView } from "@/components/room/CastView";
import { Logo } from "@/components/Logo";

type RoomRef = { id: string; name: string };

/**
 * Public projector screen reached by casting `/cast/<token>` to a device
 * (Chromecast / smart display) via the browser Presentation API. No Supabase
 * session — the token in the URL is sent as the `x-cast-token` header and
 * `cast_room_id()` (migration 0014) authorises read-only access to that one
 * room's player-perspective data.
 */
export function CastByToken({ token }: { token: string }) {
  const [room, setRoom] = useState<RoomRef | "loading" | "invalid">("loading");

  useEffect(() => {
    let cancelled = false;
    const supabase = createCastClient(token);
    supabase
      .from("rooms")
      .select("id, name")
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setRoom(data ? { id: data.id, name: data.name } : "invalid");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (room === "loading" || room === "invalid") {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-neutral-950 text-neutral-300">
        <Logo className="h-12 w-12" />
        <p className="text-sm">
          {room === "loading"
            ? "Connecting to the table…"
            : "This cast link is no longer valid. Ask the DM for a new one."}
        </p>
      </div>
    );
  }

  return (
    <CastView
      roomId={room.id}
      roomName={room.name}
      userId=""
      castToken={token}
    />
  );
}
