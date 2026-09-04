"use client";

import { useMemo } from "react";

import { useToast } from "@/components/toast";
import { colorFromString, initials } from "@/lib/utils";
import { conditionColor } from "@/lib/conditions";
import type { RoomStore } from "@/lib/room/useRoomState";
import type { Scene } from "@/lib/room/types";

function hpColor(ratio: number) {
  if (ratio > 0.5) return "#4ade80";
  if (ratio > 0.25) return "#fbbf24";
  return "#f87171";
}

/**
 * Foundry-style horizontal initiative strip floating over the top of the map.
 * Everyone sees the turn order; the DM can click any combatant to hand them the
 * turn (action-based initiative) and step the round.
 */
export function InitiativeBar({
  room,
  scene,
}: {
  room: RoomStore;
  scene: Scene;
}) {
  const toast = useToast();
  const isDM = room.role === "dm";
  const list = room.combatants;
  const activeId = scene.active_combatant_id;

  const tokenById = useMemo(
    () => new Map(room.tokens.map((t) => [t.id, t])),
    [room.tokens],
  );

  async function updateScene(patch: {
    active_combatant_id?: string | null;
    round?: number;
  }) {
    const { error } = await room.supabase
      .from("scenes")
      .update(patch)
      .eq("id", scene.id);
    if (error) toast.error(error.message);
  }

  function setActive(id: string) {
    if (!isDM || id === activeId) return;
    updateScene({ active_combatant_id: id });
  }

  function nextTurn() {
    if (!isDM || list.length === 0) return;
    const idx = list.findIndex((c) => c.id === activeId);
    const nextIdx = idx < 0 ? 0 : (idx + 1) % list.length;
    const wrapped = idx >= 0 && nextIdx === 0;
    updateScene({
      active_combatant_id: list[nextIdx].id,
      round: wrapped ? scene.round + 1 : scene.round,
    });
  }

  function nextRound() {
    if (!isDM || list.length === 0) return;
    const top = [...list].sort(
      (a, b) =>
        (b.initiative ?? -Infinity) - (a.initiative ?? -Infinity) ||
        a.sort_order - b.sort_order,
    )[0];
    updateScene({ active_combatant_id: top.id, round: scene.round + 1 });
  }

  if (list.length === 0) return null;

  return (
    <div className="pointer-events-auto absolute left-1/2 top-2 z-20 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-stretch gap-1.5 rounded-xl border border-neutral-700 bg-neutral-900/90 p-1.5 shadow-xl backdrop-blur">
      <span className="flex items-center px-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
        R{scene.round}
      </span>

      <ul className="flex items-stretch gap-1 overflow-x-auto">
        {list.map((c) => {
          const tok = c.token_id ? tokenById.get(c.token_id) : null;
          const showStats = isDM || c.is_player;
          const active = c.id === activeId;
          const ratio =
            c.max_hp && c.hp != null
              ? Math.max(0, Math.min(1, c.hp / c.max_hp))
              : null;
          const downed =
            !c.is_player && c.hp != null && c.hp <= 0;

          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setActive(c.id)}
                disabled={!isDM}
                title={isDM ? "Give this combatant the turn" : c.name}
                className={`flex w-16 flex-col items-center gap-0.5 rounded-lg border p-1 transition-colors ${
                  active
                    ? "border-amber-400 bg-amber-400/15"
                    : "border-transparent hover:border-neutral-600"
                } ${isDM ? "cursor-pointer" : "cursor-default"} ${
                  downed ? "opacity-50 grayscale" : ""
                }`}
              >
                <div
                  className="relative h-10 w-10 overflow-hidden rounded-full border border-neutral-600"
                  style={{
                    background: tok?.image_url
                      ? undefined
                      : colorFromString(c.name),
                  }}
                >
                  {tok?.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={tok.image_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-[10px] font-bold text-neutral-950">
                      {initials(c.name)}
                    </span>
                  )}
                  {c.initiative != null && (
                    <span className="absolute -bottom-0.5 -right-0.5 rounded bg-neutral-950 px-1 text-[10px] font-bold text-amber-300">
                      {c.initiative}
                    </span>
                  )}
                </div>

                <span className="w-full truncate text-center text-[10px] text-neutral-300">
                  {c.name}
                </span>

                {c.conditions.length > 0 && (
                  <span className="flex flex-wrap justify-center gap-0.5">
                    {c.conditions.map((cond, i) => (
                      <span
                        key={i}
                        title={cond}
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: conditionColor(cond) }}
                      />
                    ))}
                  </span>
                )}

                {showStats && ratio != null && (
                  <span className="block h-1 w-full overflow-hidden rounded-full bg-neutral-700">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${ratio * 100}%`,
                        background: hpColor(ratio),
                      }}
                    />
                  </span>
                )}

                {showStats && (c.hp != null || (c.temp_hp ?? 0) > 0) && (
                  <span className="text-[9px] leading-none text-neutral-400">
                    {c.hp ?? "?"}
                    {(c.temp_hp ?? 0) > 0 ? `+${c.temp_hp}` : ""}
                    {c.max_hp ? `/${c.max_hp}` : ""}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {isDM && (
        <div className="flex flex-col justify-center gap-1 pl-0.5">
          <button
            type="button"
            onClick={nextTurn}
            className="rounded bg-amber-500 px-2 py-1 text-[11px] font-semibold text-neutral-950 hover:bg-amber-400"
          >
            Next ▸
          </button>
          <button
            type="button"
            onClick={nextRound}
            className="rounded bg-neutral-700 px-2 py-1 text-[11px] font-medium text-neutral-100 hover:bg-neutral-600"
          >
            ↻ Round
          </button>
        </div>
      )}
    </div>
  );
}
