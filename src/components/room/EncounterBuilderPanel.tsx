"use client";

import { useEffect, useMemo, useState } from "react";

import { useToast } from "@/components/toast";
import type { RoomStore } from "@/lib/room/useRoomState";
import { loadEncounterShapes, loadReferenceDetail, loadReferenceIndex } from "@/lib/reference/fetch";
import type { EncounterShapeEntry, ReferenceDetail, ReferenceIndexEntry } from "@/lib/reference/types";
import {
  computeEncounterPlan,
  xpForCr,
  type EncounterDifficulty,
  type EncounterGroupPlan,
} from "@/lib/encounter-math";
import { FloatingPanel } from "@/components/room/FloatingPanel";

const MAX_RESULTS = 20;
const TOKEN_IMG_BASE = "https://raw.githubusercontent.com/5etools-mirror-3/5etools-img/main/bestiary/tokens/";

type MonsterEntry = Extract<ReferenceIndexEntry, { type: "monster" }>;

type Pick = { groupIndex: number; entry: MonsterEntry; quantity: number };

function tokenImageUrl(entry: MonsterEntry): string {
  return `${TOKEN_IMG_BASE}${encodeURIComponent(entry.source)}/${encodeURIComponent(entry.name)}.webp`;
}

function hpFromDetail(detail: ReferenceDetail): number {
  const hp = detail.hp as { average?: number } | undefined;
  return hp?.average ?? 1;
}

function acFromDetail(detail: ReferenceDetail): number {
  const ac = detail.ac;
  if (!Array.isArray(ac) || ac.length === 0) return 10;
  const first = ac[0];
  return typeof first === "number" ? first : ((first as { ac?: number })?.ac ?? 10);
}

/** One group's inline "add a creature" search + picked-creature chips. */
function GroupPicker({
  group,
  groupIndex,
  monsters,
  picks,
  onAdd,
  onRemove,
  onQuantity,
}: {
  group: EncounterGroupPlan;
  groupIndex: number;
  monsters: MonsterEntry[];
  picks: Pick[];
  onAdd: (entry: MonsterEntry) => void;
  onRemove: (entry: MonsterEntry) => void;
  onQuantity: (entry: MonsterEntry, quantity: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);

  // Sorted by closeness to the group's suggested CR — a starting point, not a hard filter, so
  // the DM can still search for anything by name.
  const results = useMemo(() => {
    const targetXp = xpForCr(group.targetCr);
    const q = query.trim().toLowerCase();
    const filtered = q ? monsters.filter((m) => m.name.toLowerCase().includes(q)) : monsters;
    return [...filtered]
      .sort((a, b) => Math.abs(xpForCr(a.cr) - targetXp) - Math.abs(xpForCr(b.cr) - targetXp))
      .slice(0, MAX_RESULTS);
  }, [monsters, query, group.targetCr]);

  const groupPicks = picks.filter((p) => p.groupIndex === groupIndex);

  return (
    <div className="mb-2 rounded border border-neutral-800 p-2">
      <div className="mb-1 flex items-center justify-between text-xs text-neutral-400">
        <span>
          {group.count}× ~CR {group.targetCr}
        </span>
      </div>

      {groupPicks.map((p) => (
        <div key={`${p.entry.source}-${p.entry.name}`} className="mb-1 flex items-center gap-1 text-xs">
          <span className="flex-1 truncate text-neutral-200">
            {p.entry.name} <span className="text-neutral-500">{p.entry.source}</span>
          </span>
          <input
            type="number"
            min={1}
            value={p.quantity}
            onChange={(e) => onQuantity(p.entry, Math.max(1, Number(e.target.value)))}
            className="w-12 rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-center text-neutral-200"
          />
          <button
            type="button"
            onClick={() => onRemove(p.entry)}
            className="text-neutral-500 hover:text-red-400"
            aria-label="Remove"
          >
            ✕
          </button>
        </div>
      ))}

      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSearching(true);
        }}
        onFocus={() => setSearching(true)}
        placeholder="+ Search a creature…"
        className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-200 focus:outline-none"
      />
      {searching && (
        <ul className="mt-1 max-h-32 overflow-y-auto text-xs">
          {results.map((m) => (
            <li key={`${m.source}-${m.name}`}>
              <button
                type="button"
                onClick={() => {
                  onAdd(m);
                  setQuery("");
                  setSearching(false);
                }}
                className="block w-full truncate rounded px-1 py-0.5 text-left text-neutral-300 hover:bg-neutral-800"
              >
                {m.name} <span className="text-neutral-500">CR {m.cr ?? "—"} · {m.source}</span>
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="px-1 py-0.5 text-neutral-500">No matches</li>}
        </ul>
      )}
    </div>
  );
}

export function EncounterBuilderPanel({ room, isDM }: { room: RoomStore; isDM: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState<ReferenceIndexEntry[] | null>(null);
  const [shapes, setShapes] = useState<EncounterShapeEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [partyLevel, setPartyLevel] = useState(4);
  const [partySize, setPartySize] = useState(4);
  const [difficulty, setDifficulty] = useState<EncounterDifficulty>("medium");
  const [shapeName, setShapeName] = useState<string | null>(null);
  const [variantIdx, setVariantIdx] = useState(0);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!open || !isDM) return;
    if (!index && !loadError) {
      Promise.all([loadReferenceIndex(), loadEncounterShapes()])
        .then(([idx, sh]) => {
          setIndex(idx);
          setShapes(sh);
          if (!shapeName && sh.length > 0) setShapeName(sh[0].name);
        })
        .catch((e) => setLoadError(e instanceof Error ? e.message : "Failed to load"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isDM]);

  const monsters = useMemo(
    () => (index ?? []).filter((e): e is MonsterEntry => e.type === "monster"),
    [index],
  );

  const shape = useMemo(() => shapes?.find((s) => s.name === shapeName) ?? null, [shapes, shapeName]);
  const variant = useMemo(() => shape?.shapeTemplate[variantIdx] ?? null, [shape, variantIdx]);

  const plan = useMemo(() => {
    if (!variant) return [];
    return computeEncounterPlan({ partyLevel, partySize, difficulty, variant });
  }, [variant, partyLevel, partySize, difficulty]);

  // A shape change invalidates old group indices — clear picks rather than let them silently
  // point at a group that no longer exists (or means something different).
  function pickShape(name: string) {
    setShapeName(name);
    setVariantIdx(0);
    setPicks([]);
  }

  function addPick(groupIndex: number, entry: MonsterEntry) {
    setPicks((prev) => {
      const existing = prev.find((p) => p.groupIndex === groupIndex && p.entry.name === entry.name && p.entry.source === entry.source);
      if (existing) {
        return prev.map((p) => (p === existing ? { ...p, quantity: p.quantity + 1 } : p));
      }
      return [...prev, { groupIndex, entry, quantity: 1 }];
    });
  }

  function removePick(groupIndex: number, entry: MonsterEntry) {
    setPicks((prev) => prev.filter((p) => !(p.groupIndex === groupIndex && p.entry.name === entry.name && p.entry.source === entry.source)));
  }

  function setPickQuantity(groupIndex: number, entry: MonsterEntry, quantity: number) {
    setPicks((prev) =>
      prev.map((p) =>
        p.groupIndex === groupIndex && p.entry.name === entry.name && p.entry.source === entry.source
          ? { ...p, quantity }
          : p,
      ),
    );
  }

  const totalCreatures = picks.reduce((sum, p) => sum + p.quantity, 0);

  async function addToScene() {
    const scene = room.activeScene;
    if (!scene) return toast.error("Open a scene first");
    if (picks.length === 0) return toast.error("Pick at least one creature");

    setAdding(true);
    try {
      // One label + full stat-block detail per instance (quantity expanded), in pick order.
      const instances: { entry: MonsterEntry; detail: ReferenceDetail; label: string }[] = [];
      for (const p of picks) {
        const detail = await loadReferenceDetail(p.entry);
        for (let i = 0; i < p.quantity; i++) {
          instances.push({
            entry: p.entry,
            detail,
            label: p.quantity > 1 ? `${p.entry.name} ${i + 1}` : p.entry.name,
          });
        }
      }

      const g = scene.grid_size;
      const cellsPerRow = 5;
      const tokensToInsert = instances.map((inst, i) => ({
        scene_id: scene.id,
        room_id: room.room!.id,
        label: inst.label,
        image_url: tokenImageUrl(inst.entry),
        x: g * (2 + (i % cellsPerRow)) + g / 2,
        y: g * (2 + Math.floor(i / cellsPerRow)) + g / 2,
        is_hidden: true,
        hp: hpFromDetail(inst.detail),
        ac: acFromDetail(inst.detail),
        monster_name: inst.entry.name,
        monster_source: inst.entry.source,
        monster_cr: inst.entry.cr != null ? String(inst.entry.cr) : null,
      }));

      const { data: insertedTokens, error: tokenError } = await room.supabase
        .from("tokens")
        .insert(tokensToInsert)
        .select();
      if (tokenError || !insertedTokens) {
        return toast.error(tokenError?.message ?? "Couldn't add tokens");
      }

      const base = room.combatants.length;
      const { error: combatantError } = await room.supabase.from("combatants").insert(
        insertedTokens.map((t, i) => ({
          scene_id: t.scene_id,
          room_id: t.room_id,
          name: t.label,
          is_player: false,
          token_id: t.id,
          sort_order: base + i,
          hp: t.hp,
          max_hp: t.hp,
          ac: t.ac,
        })),
      );
      if (combatantError) toast.error(combatantError.message);

      room.reloadScene();
      setPicks([]);
      toast.success(`Added ${insertedTokens.length} to the scene (hidden)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't build encounter");
    } finally {
      setAdding(false);
    }
  }

  if (!isDM) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-neutral-700 bg-neutral-900/90 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
      >
        ⚔️ Encounter
      </button>

      {open && (
        <FloatingPanel
          title="Encounter Builder"
          onClose={() => setOpen(false)}
          defaultX={160}
          defaultY={96}
          defaultWidth={360}
          defaultHeight={500}
        >
          <div className="flex flex-1 flex-col overflow-y-auto p-3 text-sm">
            {loadError && <div className="text-xs text-red-400">{loadError}</div>}
            {!index && !loadError && <div className="text-xs text-neutral-500">Loading…</div>}

            {index && shapes && (
              <>
                <div className="mb-2 grid grid-cols-3 gap-1 text-xs">
                  <label className="flex flex-col gap-0.5 text-neutral-500">
                    Level
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={partyLevel}
                      onChange={(e) => setPartyLevel(Number(e.target.value))}
                      className="rounded border border-neutral-700 bg-neutral-950 px-1 py-1 text-neutral-200"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 text-neutral-500">
                    Party size
                    <input
                      type="number"
                      min={1}
                      value={partySize}
                      onChange={(e) => setPartySize(Number(e.target.value))}
                      className="rounded border border-neutral-700 bg-neutral-950 px-1 py-1 text-neutral-200"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 text-neutral-500">
                    Difficulty
                    <select
                      value={difficulty}
                      onChange={(e) => setDifficulty(e.target.value as EncounterDifficulty)}
                      className="rounded border border-neutral-700 bg-neutral-950 px-1 py-1 text-neutral-200"
                    >
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                      <option value="deadly">Deadly</option>
                    </select>
                  </label>
                </div>

                <div className="mb-2 flex items-center gap-1 text-xs">
                  <select
                    value={shapeName ?? ""}
                    onChange={(e) => pickShape(e.target.value)}
                    className="flex-1 rounded border border-neutral-700 bg-neutral-950 px-1 py-1 text-neutral-200"
                  >
                    {shapes.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  {shape && shape.shapeTemplate.length > 1 && (
                    <select
                      value={variantIdx}
                      onChange={(e) => {
                        setVariantIdx(Number(e.target.value));
                        setPicks([]);
                      }}
                      className="rounded border border-neutral-700 bg-neutral-950 px-1 py-1 text-neutral-200"
                    >
                      {shape.shapeTemplate.map((_v, i) => (
                        <option key={i} value={i}>
                          Variant {i + 1}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <p className="mb-2 text-[10px] text-neutral-500">
                  Suggested CR per slot — a starting point, pick whatever fits the scene.
                </p>

                {plan.map((group, i) => (
                  <GroupPicker
                    key={i}
                    group={group}
                    groupIndex={i}
                    monsters={monsters}
                    picks={picks}
                    onAdd={(entry) => addPick(i, entry)}
                    onRemove={(entry) => removePick(i, entry)}
                    onQuantity={(entry, q) => setPickQuantity(i, entry, q)}
                  />
                ))}

                <button
                  type="button"
                  onClick={addToScene}
                  disabled={adding || totalCreatures === 0}
                  className="mt-2 w-full rounded bg-emerald-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                >
                  {adding
                    ? "Adding…"
                    : `Add ${totalCreatures || ""} to scene (hidden)`.trim()}
                </button>
              </>
            )}
          </div>
        </FloatingPanel>
      )}
    </>
  );
}
