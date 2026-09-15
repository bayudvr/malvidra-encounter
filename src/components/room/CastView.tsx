"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";

import { useRoomState } from "@/lib/room/useRoomState";
import { createCastClient } from "@/lib/supabase/client";
import { InitiativeBar } from "@/components/initiative/InitiativeBar";
import { Logo } from "@/components/Logo";

const SceneCanvas = dynamic(
  () => import("@/components/scene/SceneCanvas").then((m) => m.SceneCanvas),
  { ssr: false, loading: () => <CastSkeleton /> },
);

function CastSkeleton() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-neutral-600">
      Loading map…
    </div>
  );
}

/**
 * The "Cast" screen — what the DM drops onto a projector / second display.
 * It renders the room's active scene from the *player's* perspective (fog
 * opaque, hidden tokens gone, monster stats hidden) with every local control
 * stripped out; the viewport mirrors whatever the DM is looking at.
 *
 * The authed route (`/rooms/<id>/cast`) is DM-only; the public
 * `/cast/<token>` route passes `castToken` and runs anonymously (header auth,
 * polling instead of Realtime). Either way the perspective is forced to
 * "player" here so nothing DM-only can leak onto the projector.
 */
export function CastView({
  roomId,
  roomName,
  userId,
  castToken,
}: {
  roomId: string;
  roomName: string;
  userId: string;
  castToken?: string;
}) {
  const castClient = useMemo(
    () => (castToken ? createCastClient(castToken) : undefined),
    [castToken],
  );
  const room = useRoomState(
    roomId,
    userId,
    "player",
    castClient ? { client: castClient, realtime: false } : undefined,
  );
  const scene = room.activeScene;
  const inCombat = scene?.mode === "combat";
  const spotlightName = scene?.spotlight_user_id
    ? (room.members.find((m) => m.user_id === scene.spotlight_user_id)
        ?.display_name ?? "someone")
    : null;

  return (
    <div className="relative flex h-dvh flex-col bg-neutral-950 text-neutral-100">
      {scene && (
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-md bg-black/50 px-2 py-1 text-xs text-neutral-300">
          <Logo className="h-3.5 w-3.5" />
          {roomName} · {scene.name}
          {inCombat ? ` · round ${scene.round}` : ""}
        </div>
      )}

      {scene && (scene.spotlight_user_id || scene.spotlight_note) && (
        <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-1.5 text-sm text-amber-200">
          👀 Waiting on{" "}
          {spotlightName && <strong>{spotlightName}</strong>}
          {scene.spotlight_note && (
            <>
              {scene.spotlight_user_id ? ": " : " "}
              {scene.spotlight_note}
            </>
          )}
        </div>
      )}

      <main className="relative min-h-0 flex-1">
        {inCombat && scene && <InitiativeBar room={room} scene={scene} />}
        {scene ? (
          <SceneCanvas room={room} scene={scene} castMode />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-neutral-600">
            {room.loading
              ? "Loading…"
              : "Waiting for the DM to open a scene…"}
          </div>
        )}
      </main>
    </div>
  );
}
