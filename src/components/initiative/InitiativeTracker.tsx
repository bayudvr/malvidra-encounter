"use client";

import { useState } from "react";

import { Button, Input, Panel } from "@/components/ui";
import { useToast } from "@/components/toast";
import { colorFromString } from "@/lib/utils";
import type { RoomStore } from "@/lib/room/useRoomState";
import type { CombatantUpdate, Scene } from "@/lib/room/types";

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
      sort_order: list.length,
    });
    if (error) return toast.error(error.message);
    setName("");
    setInit("");
    setHp("");
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

  async function nextTurn() {
    if (list.length === 0) return;
    const idx = list.findIndex((c) => c.id === activeId);
    const nextIdx = idx < 0 ? 0 : (idx + 1) % list.length;
    const wrapped = idx >= 0 && nextIdx === 0;
    await room.supabase
      .from("scenes")
      .update({
        active_combatant_id: list[nextIdx].id,
        round: wrapped ? scene.round + 1 : scene.round,
      })
      .eq("id", scene.id);
  }

  async function resetCombat() {
    if (!confirm("Remove all combatants from this scene?")) return;
    await room.supabase.from("combatants").delete().eq("scene_id", scene.id);
    await room.supabase
      .from("scenes")
      .update({ active_combatant_id: null, round: 1 })
      .eq("id", scene.id);
  }

  return (
    <Panel
      title={`Initiative · round ${scene.round}`}
      action={
        isDM ? (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={sortByInitiative}>
              Sort
            </Button>
            <Button size="sm" onClick={nextTurn}>
              Next ▸
            </Button>
          </div>
        ) : null
      }
    >
      <ul className="space-y-1">
        {list.map((c) => {
          const isActive = c.id === activeId;
          return (
            <li
              key={c.id}
              className={`rounded border px-2 py-1.5 text-sm ${
                isActive
                  ? "border-amber-500 bg-amber-500/10"
                  : "border-neutral-800"
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
                      patch(c.id, {
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
                    onClick={() => remove(c.id)}
                    aria-label="Remove combatant"
                  >
                    ✕
                  </button>
                )}
              </div>

              {(c.hp != null || isDM) && (
                <div className="mt-1 flex items-center gap-1 pl-4 text-xs text-neutral-400">
                  <span>HP</span>
                  {isDM ? (
                    <>
                      <input
                        type="number"
                        value={c.hp ?? ""}
                        onChange={(e) =>
                          patch(c.id, {
                            hp:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          })
                        }
                        className="w-12 rounded bg-neutral-800 px-1 py-0.5 text-center"
                      />
                      <span>/ {c.max_hp ?? "?"}</span>
                    </>
                  ) : (
                    <span>
                      {c.hp ?? "?"} / {c.max_hp ?? "?"}
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {list.length === 0 && (
          <li className="text-xs text-neutral-500">
            No combatants yet. Players are added automatically when combat starts.
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
