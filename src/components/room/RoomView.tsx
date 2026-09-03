"use client";

import Link from "next/link";
import dynamic from "next/dynamic";

import { useRoomState } from "@/lib/room/useRoomState";
import type { Role } from "@/lib/room/types";
import { SceneList } from "@/components/room/SceneList";
import { MemberPanel } from "@/components/room/MemberPanel";
import { AssetPanel } from "@/components/room/AssetPanel";
import { SceneSettings } from "@/components/room/SceneSettings";
import { ModeToggle } from "@/components/room/ModeToggle";
import { InitiativeTracker } from "@/components/initiative/InitiativeTracker";

const SceneCanvas = dynamic(
  () => import("@/components/scene/SceneCanvas").then((m) => m.SceneCanvas),
  { ssr: false, loading: () => <CanvasSkeleton /> },
);

function CanvasSkeleton() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-neutral-600">
      Loading map…
    </div>
  );
}

export function RoomView({
  roomId,
  roomName,
  userId,
  role,
}: {
  roomId: string;
  roomName: string;
  userId: string;
  role: Role;
}) {
  const room = useRoomState(roomId, userId, role);
  const isDM = role === "dm";
  const scene = room.activeScene;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
        <div className="flex items-center gap-3">
          <Link href="/rooms" className="text-sm text-neutral-500 hover:text-neutral-300">
            ←
          </Link>
          <h1 className="text-sm font-semibold text-amber-400">{roomName}</h1>
          {scene && (
            <span className="text-xs text-neutral-500">
              / {scene.name} · {scene.mode}
              {scene.mode === "combat" ? ` · round ${scene.round}` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isDM && scene && <ModeToggle room={room} scene={scene} />}
          {!isDM && <span className="text-xs text-sky-300">Player view</span>}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 flex-col gap-3 overflow-y-auto border-r border-neutral-800 p-3">
          <SceneList room={room} />
          {isDM && scene && <SceneSettings room={room} scene={scene} />}
          {isDM && <AssetPanel room={room} />}
          <MemberPanel room={room} roomName={roomName} />
        </aside>

        <main className="relative min-w-0 flex-1 bg-neutral-950">
          {scene ? (
            <SceneCanvas room={room} scene={scene} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-neutral-600">
              {isDM
                ? "Create a scene and set it active to begin."
                : "Waiting for the DM to open a scene…"}
            </div>
          )}
        </main>

        {scene?.mode === "combat" && (
          <aside className="w-80 overflow-y-auto border-l border-neutral-800 p-3">
            <InitiativeTracker room={room} scene={scene} />
          </aside>
        )}
      </div>
    </div>
  );
}
