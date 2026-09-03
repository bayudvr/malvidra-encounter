"use client";

import { useState } from "react";

import { Button, Input, Panel } from "@/components/ui";
import { useToast } from "@/components/toast";
import { colorFromString } from "@/lib/utils";
import type { RoomStore } from "@/lib/room/useRoomState";
import type { Combatant, CombatantUpdate, Scene } from "@/lib/room/types";

export function InitiativeTracker({
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

  const [name, setName] = useState("");
  const [init, setInit] = useState("");
  const [hp, setHp] = useState("");
  const [ac, setAc] = useState("");

  async function addCombatant(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const hpNum = hp ? Number(hp) : null;
    const { error } = await room.supabase.from("combatants").insert({
      scene_id: scene.id,
      room_id: room.room!.id,
      name: name.trim(),
      initiative: init ? Number(init) : null,
      hp: hpNum,
      max_hp: hpNum,
      ac: ac ? Number(ac) : null,
      sort_order: list.length,
    });
    if (error) return toast.error(error.message);
    setName("");
    setInit("");
    setHp("");
    setAc("");
    room.reloadScene();
  }

  async function patch(id: string, p: CombatantUpdate) {
    const { error } = await room.supabase
      .from("combatants")
      .update(p)
      .eq("id", id);
    if (error) toast.error(error.message);
  }

  async function remove(id: string) {
    const { error } = await room.supabase
      .from("combatants")
      .delete()
      .eq("id", id);
    if (error) toast.error(error.message);
    else room.reloadScene();
  }

  async function sortByInitiative() {
    const ordered = [...list].sort((a, b) => {
      const ai = a.initiative ?? -Infinity;
      const bi = b.initiative ?? -Infinity;
      return bi - ai || a.name.localeCompare(b.name);
    });
    await Promise.all(
      ordered.map((c, i) =>
        room.supabase
          .from("combatants")
          .update({ sort_order: i })
          .eq("id", c.id),
      ),
    );
    await room.supabase
      .from("scenes")
      .update({ active_combatant_id: ordered[0]?.id ?? null, round: 1 })
      .eq("id", scene.id);
  }

  async function resetCombat() {
    if (!confirm("Remove all combatants from this scene?")) return;
    await room.supabase.from("combatants").delete().eq("scene_id", scene.id);
    await room.supabase
      .from("scenes")
      .update({ active_combatant_id: null, round: 1 })
      .eq("id", scene.id);
    room.reloadScene();
  }

  return (
    <Panel
      title={`Initiative · round ${scene.round}`}
      action={
        isDM ? (
          <Button size="sm" variant="ghost" onClick={sortByInitiative}>
            Sort by init
          </Button>
        ) : null
      }
    >
      <ul className="space-y-1">
        {list.map((c) => (
          <CombatantRow
            key={c.id}
            combatant={c}
            active={c.id === activeId}
            isDM={isDM}
            onPatch={(p) => patch(c.id, p)}
            onRemove={() => remove(c.id)}
          />
        ))}
        {list.length === 0 && (
          <li className="text-xs text-neutral-500">
            No combatants yet. Tokens on the map are added automatically when
            combat starts.
          </li>
        )}
      </ul>

      {isDM && (
        <>
          <form
            onSubmit={addCombatant}
            className="mt-3 space-y-2 border-t border-neutral-800 pt-3"
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Combatant name"
            />
            <div className="flex gap-2">
              <Input
                type="number"
                value={init}
                onChange={(e) => setInit(e.target.value)}
                placeholder="Init"
              />
              <Input
                type="number"
                value={hp}
                onChange={(e) => setHp(e.target.value)}
                placeholder="HP"
              />
              <Input
                type="number"
                value={ac}
                onChange={(e) => setAc(e.target.value)}
                placeholder="AC"
              />
            </div>
            <Button type="submit" size="sm" className="w-full">
              Add combatant
            </Button>
          </form>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full"
            onClick={resetCombat}
          >
            Reset combat
          </Button>
        </>
      )}
    </Panel>
  );
}

function CombatantRow({
  combatant: c,
  active,
  isDM,
  onPatch,
  onRemove,
}: {
  combatant: Combatant;
  active: boolean;
  isDM: boolean;
  onPatch: (p: CombatantUpdate) => void;
  onRemove: () => void;
}) {
  // Players only see the numbers of player characters — a monster's HP/AC
  // stays hidden from them.
  const showStats = isDM || c.is_player;

  return (
    <li
      className={`rounded border px-2 py-1.5 text-sm ${
        active ? "border-amber-500 bg-amber-500/10" : "border-neutral-800"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: colorFromString(c.name) }}
        />
        <span className="flex-1 truncate">
          {c.name}
          {c.is_player && (
            <span className="ml-1 text-[10px] text-sky-300">PC</span>
          )}
        </span>

        {isDM ? (
          <input
            type="number"
            value={c.initiative ?? ""}
            onChange={(e) =>
              onPatch({
                initiative:
                  e.target.value === "" ? null : Number(e.target.value),
              })
            }
            className="w-12 rounded bg-neutral-800 px-1 py-0.5 text-center text-xs"
            placeholder="–"
          />
        ) : (
          <span className="w-8 text-right text-xs text-neutral-400">
            {c.initiative ?? "–"}
          </span>
        )}

        {isDM && (
          <button
            className="text-neutral-500 hover:text-red-400"
            onClick={onRemove}
            aria-label="Remove combatant"
          >
            ✕
          </button>
        )}
      </div>

      {showStats && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-4 text-xs text-neutral-400">
          <span className="flex items-center gap-1">
            <span className="text-neutral-500">AC</span>
            {isDM ? (
              <NumberCell
                value={c.ac}
                onCommit={(v) => onPatch({ ac: v })}
                width="w-9"
              />
            ) : (
              <span className="text-neutral-300">{c.ac ?? "–"}</span>
            )}
          </span>

          <span className="flex items-center gap-1">
            <span className="text-neutral-500">HP</span>
            {isDM ? (
              <>
                <NumberCell
                  value={c.hp}
                  onCommit={(v) => onPatch({ hp: v })}
                  width="w-11"
                />
                <span>/</span>
                <NumberCell
                  value={c.max_hp}
                  onCommit={(v) => onPatch({ max_hp: v })}
                  width="w-11"
                />
              </>
            ) : (
              <span className="text-neutral-300">
                {c.hp ?? "?"} / {c.max_hp ?? "?"}
              </span>
            )}
          </span>

          <span className="flex items-center gap-1">
            <span className="text-neutral-500">THP</span>
            {isDM ? (
              <NumberCell
                value={c.temp_hp}
                onCommit={(v) => onPatch({ temp_hp: v })}
                width="w-9"
              />
            ) : (
              <span className="text-neutral-300">{c.temp_hp ?? "–"}</span>
            )}
          </span>
        </div>
      )}
    </li>
  );
}

function NumberCell({
  value,
  onCommit,
  width,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  width: string;
}) {
  const [draft, setDraft] = useState(value?.toString() ?? "");

  // Keep the field in sync when the value changes elsewhere (realtime).
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value?.toString() ?? "");
  }

  return (
    <input
      type="number"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft === "" ? null : Number(draft);
        if (next !== value) onCommit(next);
      }}
      className={`${width} rounded bg-neutral-800 px-1 py-0.5 text-center text-neutral-100`}
      placeholder="–"
    />
  );
}
