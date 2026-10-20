"use client";

import { useMemo, useState } from "react";

import { useToast } from "@/components/toast";
import { colorFromString, initials } from "@/lib/utils";
import { conditionColor } from "@/lib/conditions";
import type { RoomStore } from "@/lib/room/useRoomState";
import type { Combatant, Scene, Token } from "@/lib/room/types";

/** A fixed-size turn carousel. Only the DM's picker contains the full roster. */
export function InitiativeBar({ room, scene }: { room: RoomStore; scene: Scene }) {
  const toast = useToast();
  const isDM = room.role === "dm";
  // The signed-in projector can use the DM's session, so also enforce its player perspective here.
  const list = isDM ? room.combatants : room.combatants.filter((c) => !c.is_hidden);
  const activeId = scene.active_combatant_id;
  const activeIndex = list.findIndex((c) => c.id === activeId);
  const activeCombatant = activeIndex < 0 ? null : list[activeIndex];
  const isOwnTurn = room.role === "player" && !!activeCombatant?.is_player && activeCombatant.user_id === room.userId;
  const [busy, setBusy] = useState(false);
  // These are neighbours in the roster, not a prediction of who takes the next turn.
  // Keep the active portrait centred and never repeat a combatant in small parties.
  const leftCount = Math.min(2, Math.floor((list.length - 1) / 2));
  const rightCount = Math.min(2, list.length - 1 - leftCount);
  const left = Array.from({ length: 2 }, (_, i) => {
    const distance = 2 - i;
    return activeIndex < 0 || distance > leftCount ? null
      : list[(activeIndex - distance + list.length) % list.length];
  });
  const right = Array.from({ length: 2 }, (_, i) => {
    const distance = i + 1;
    return activeIndex < 0 || distance > rightCount ? null
      : list[(activeIndex + distance) % list.length];
  });
  const tokenById = useMemo(() => new Map(room.tokens.map((t) => [t.id, t])), [room.tokens]);

  async function updateScene(patch: { active_combatant_id?: string | null; round?: number }) {
    if (!isDM || busy) return;
    setBusy(true);
    try {
      const { error } = await room.supabase.from("scenes").update(patch).eq("id", scene.id);
      if (error) toast.error(error.message);
    } finally { setBusy(false); }
  }

  function nextTurn() {
    if (list.length === 0) return;
    const nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % list.length;
    void updateScene({
      active_combatant_id: list[nextIndex].id,
      round: activeIndex >= 0 && nextIndex === 0 ? scene.round + 1 : scene.round,
    });
  }

  function nextRound() {
    if (list.length === 0) return;
    const top = [...list].sort((a, b) =>
      (b.initiative ?? -Infinity) - (a.initiative ?? -Infinity) || a.sort_order - b.sort_order,
    )[0];
    void updateScene({ active_combatant_id: top.id, round: scene.round + 1 });
  }

  async function endOwnTurn() {
    if (!isOwnTurn || busy) return;
    setBusy(true);
    try {
      const { error } = await room.supabase.rpc("end_own_turn", { p_scene: scene.id });
      if (error) toast.error(error.message);
    } finally { setBusy(false); }
  }

  if (list.length === 0) return null;

  return (
    <section aria-label="Initiative" className="pointer-events-auto absolute left-1/2 top-2 z-20 w-96 max-w-[calc(100%-1rem)] -translate-x-1/2 rounded-xl border border-neutral-700 bg-neutral-900/95 p-2 shadow-xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Round {scene.round}</span>
        {isDM ? (
          <select aria-label="Give turn to combatant" value={activeCombatant?.id ?? ""} disabled={busy}
            onChange={(e) => void updateScene({ active_combatant_id: e.target.value })}
            className="min-w-0 max-w-40 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200 disabled:opacity-50">
            <option value="" disabled>Choose turn…</option>
            {list.map((c) => <option key={c.id} value={c.id}>{c.name}{c.initiative !== null ? ` · ${c.initiative}` : ""}{c.is_hidden ? " (hidden)" : ""}</option>)}
          </select>
        ) : <span className="text-[10px] text-neutral-500">Initiative</span>}
      </div>

      {activeCombatant ? (
        <div role="group" aria-label="Combatant carousel" className="grid grid-cols-[1fr_1fr_1.5fr_1fr_1fr] items-center gap-1.5">
          {left.map((c, i) => (
            <RosterPortrait key={c?.id ?? `left-${i}`} combatant={c} token={c?.token_id ? tokenById.get(c.token_id) : undefined} />
          ))}
          <div key={activeCombatant.id} className="initiative-turn-enter flex min-w-0 flex-col items-center gap-1 rounded-xl border border-amber-400/50 bg-amber-400/10 px-1 py-2">
            <p className="text-center text-[9px] font-semibold uppercase tracking-wide text-amber-300">{isOwnTurn ? "Your turn" : "Active"}</p>
            <Portrait combatant={activeCombatant} token={activeCombatant.token_id ? tokenById.get(activeCombatant.token_id) : undefined} active />
            <p title={activeCombatant.name} className="w-full truncate text-center text-xs font-semibold text-neutral-100">{activeCombatant.name}</p>
            {activeCombatant.conditions.length > 0 && (
              <div className="flex items-center justify-center gap-1" aria-label={`Conditions: ${activeCombatant.conditions.join(", ")}`}>
                {activeCombatant.conditions.slice(0, 4).map((condition, i) => <span key={`${condition}-${i}`} title={condition} className="h-1.5 w-1.5 rounded-full" style={{ background: conditionColor(condition) }} />)}
                {activeCombatant.conditions.length > 4 && <span className="text-[9px] text-neutral-400">+{activeCombatant.conditions.length - 4}</span>}
              </div>
            )}
          </div>
          {right.map((c, i) => (
            <RosterPortrait key={c?.id ?? `right-${i}`} combatant={c} token={c?.token_id ? tokenById.get(c.token_id) : undefined} />
          ))}
        </div>
      ) : <p className="py-3 text-center text-xs text-neutral-400">Waiting for the DM to choose a turn…</p>}

      {/* Announce only the committed turn, rather than the entire roster on every render. */}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {activeCombatant ? `Round ${scene.round}. ${activeCombatant.name}'s turn${isOwnTurn ? ". Your turn." : "."}` : "Waiting for a turn."}
      </span>
      {isDM ? <div className="mt-2 flex gap-1.5 border-t border-neutral-700/60 pt-2">
        <button type="button" onClick={nextTurn} disabled={busy} className="min-h-8 flex-1 rounded-md bg-amber-500 px-2 py-1 text-xs font-semibold text-neutral-950 hover:bg-amber-400 disabled:opacity-50">Next ▸</button>
        <button type="button" onClick={nextRound} disabled={busy} className="min-h-8 flex-1 rounded-md bg-neutral-700 px-2 py-1 text-xs font-medium text-neutral-100 hover:bg-neutral-600 disabled:opacity-50">↻ Round</button>
      </div> : isOwnTurn && <button type="button" onClick={() => void endOwnTurn()} disabled={busy}
        className="mt-2 min-h-9 w-full rounded-md bg-amber-500 px-3 py-1 text-xs font-bold text-neutral-950 hover:bg-amber-400 disabled:opacity-50">{busy ? "Ending turn…" : "End Turn"}</button>}
    </section>
  );
}

function RosterPortrait({ combatant, token }: { combatant: Combatant | null; token?: Token }) {
  if (!combatant) return <div aria-hidden="true" />;
  return (
    <div title={combatant.name} className="flex min-w-0 flex-col items-center gap-1 opacity-60">
      <Portrait combatant={combatant} token={token} />
      <span className="w-full truncate text-center text-[10px] text-neutral-400">{combatant.name}</span>
    </div>
  );
}

function Portrait({ combatant, token, active = false }: { combatant: Combatant; token?: Token; active?: boolean }) {
  const downed = !combatant.is_player && combatant.hp !== null && combatant.hp <= 0;
  return (
    <div aria-hidden="true" className={`shrink-0 overflow-hidden rounded-full border-2 ${active ? "h-14 w-14 border-amber-400" : "h-9 w-9 border-neutral-600"} ${downed ? "opacity-50 grayscale" : ""}`}
      style={{ background: token?.image_url ? undefined : colorFromString(combatant.name) }}>
      {token?.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={token.image_url} alt="" className="h-full w-full object-cover" />
      ) : <span className={`flex h-full w-full items-center justify-center font-bold text-neutral-950 ${active ? "text-sm" : "text-[10px]"}`}>{initials(combatant.name)}</span>}
    </div>
  );
}
