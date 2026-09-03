"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

import { useRoomState } from "@/lib/room/useRoomState";
import type { Role } from "@/lib/room/types";
import { SceneList } from "@/components/room/SceneList";
import { MemberPanel } from "@/components/room/MemberPanel";
import { AssetPanel } from "@/components/room/AssetPanel";
import { SceneSettings } from "@/components/room/SceneSettings";
import { ModeToggle } from "@/components/room/ModeToggle";
import { InitiativeBar } from "@/components/initiative/InitiativeBar";
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

type Drawer = "panels" | "initiative" | null;

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
  const router = useRouter();
  const room = useRoomState(roomId, userId, role);
  const isDM = role === "dm";
  const scene = room.activeScene;
  const inCombat = scene?.mode === "combat";

  // The DM removed this player from the room.
  useEffect(() => {
    if (room.kicked) router.replace("/rooms");
  }, [room.kicked, router]);

  const [drawerState, setDrawer] = useState<Drawer>(null);
  // The initiative editor drawer is the DM's, and only during combat.
  const drawer =
    drawerState === "initiative" && !(inCombat && isDM) ? null : drawerState;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-neutral-800 px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => setDrawer((d) => (d === "panels" ? null : "panels"))}
            className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 lg:hidden"
            aria-label="Toggle panels"
          >
            <MenuIcon />
          </button>
          <Link
            href="/rooms"
            className="hidden text-sm text-neutral-500 hover:text-neutral-300 sm:inline"
          >
            ←
          </Link>
          <h1 className="truncate text-sm font-semibold text-amber-400">
            {roomName}
          </h1>
          {scene && (
            <span className="hidden truncate text-xs text-neutral-500 sm:inline">
              / {scene.name} · {scene.mode}
              {inCombat ? ` · round ${scene.round}` : ""}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isDM && scene && <ModeToggle room={room} scene={scene} />}
          {!isDM && (
            <span className="hidden text-xs text-sky-300 sm:inline">
              Player view
            </span>
          )}
          {inCombat && isDM && (
            <button
              type="button"
              onClick={() =>
                setDrawer((d) => (d === "initiative" ? null : "initiative"))
              }
              className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800 lg:hidden"
            >
              Combatants
            </button>
          )}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* Backdrop for mobile drawers */}
        {drawer && (
          <button
            type="button"
            aria-label="Close panel"
            onClick={() => setDrawer(null)}
            className="absolute inset-0 z-30 bg-black/60 lg:hidden"
          />
        )}

        {/* Left panels: drawer on mobile, static column on desktop */}
        <aside
          className={`absolute inset-y-0 left-0 z-40 flex w-[85vw] max-w-xs flex-col gap-3 overflow-y-auto border-r border-neutral-800 bg-neutral-950 p-3 transition-transform lg:static lg:z-auto lg:w-72 lg:max-w-none lg:translate-x-0 lg:bg-transparent lg:transition-none ${
            drawer === "panels" ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between lg:hidden">
            <Link href="/rooms" className="text-sm text-neutral-400">
              ← Rooms
            </Link>
            <button
              type="button"
              onClick={() => setDrawer(null)}
              className="rounded-md p-1 text-neutral-500 hover:text-neutral-200"
              aria-label="Close panels"
            >
              ✕
            </button>
          </div>
          <SceneList room={room} />
          {isDM && scene && <SceneSettings room={room} scene={scene} />}
          {isDM && <AssetPanel room={room} />}
          <MemberPanel room={room} roomName={roomName} />
        </aside>

        <main className="relative min-w-0 flex-1 bg-neutral-950">
          {inCombat && scene && <InitiativeBar room={room} scene={scene} />}
          {scene ? (
            <SceneCanvas room={room} scene={scene} />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-neutral-600">
              {isDM
                ? "Create a scene and set it active to begin."
                : "Waiting for the DM to open a scene…"}
            </div>
          )}
        </main>

        {/* DM's combatant editor: drawer on mobile, static column on desktop */}
        {inCombat && isDM && scene && (
          <aside
            className={`absolute inset-y-0 right-0 z-40 w-[85vw] max-w-xs overflow-y-auto border-l border-neutral-800 bg-neutral-950 p-3 transition-transform lg:static lg:z-auto lg:w-80 lg:max-w-none lg:translate-x-0 lg:bg-transparent lg:transition-none ${
              drawer === "initiative" ? "translate-x-0" : "translate-x-full"
            }`}
          >
            <div className="mb-2 flex justify-end lg:hidden">
              <button
                type="button"
                onClick={() => setDrawer(null)}
                className="rounded-md p-1 text-neutral-500 hover:text-neutral-200"
                aria-label="Close combatants"
              >
                ✕
              </button>
            </div>
            <InitiativeTracker room={room} scene={scene} />
          </aside>
        )}
      </div>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}
