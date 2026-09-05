"use client";

import { useEffect, useRef, useState } from "react";

import type DiceBox from "@3d-dice/dice-box";
import DiceParser from "@3d-dice/dice-parser-interface";

import { useToast } from "@/components/toast";
import type { RoomStore } from "@/lib/room/useRoomState";
import type { DiceDetail } from "@/lib/database.types";

const DICE = [4, 6, 8, 10, 12, 20, 100] as const;

type RollRow = {
  id: string;
  user_id: string | null;
  actor_name: string;
  notation: string;
  detail: DiceDetail[];
  total: number;
  created_at: string;
};

type AdvMode = "normal" | "adv" | "dis";

// Roll20-syntax notation (understood by @3d-dice/dice-parser-interface):
// advantage/disadvantage is "2d20kh1" / "2d20kl1" — roll 2, keep the
// highest/lowest 1. Everything else is a plain "NdS" term.
function buildNotation(pool: Record<number, number>, mod: number, advMode: AdvMode) {
  const parts: string[] = [];
  for (const s of DICE) {
    if (s === 20 && advMode !== "normal") {
      parts.push(`2d20${advMode === "adv" ? "kh1" : "kl1"}`);
    } else if (pool[s]) {
      parts.push(`${pool[s]}d${s}`);
    }
  }
  let notation = parts.join(" + ");
  // Append separately rather than joining an already-signed "+1"/"-1" string
  // in with the rest — that doubled up as "+ +1" and silently dropped the
  // modifier (the parser didn't recognize it, so mods came back empty).
  if (mod) notation += mod > 0 ? ` + ${mod}` : ` - ${Math.abs(mod)}`;
  return notation;
}

// Walk a dice-parser-interface FinalRollResult tree, collecting every
// individual die roll (kept or dropped by a kh/kl modifier) grouped by
// die size, for display in the shared roll log.
function collectDetail(node: unknown): DiceDetail[] {
  const bySides = new Map<number, number[]>();
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const obj = n as { rolls?: unknown; dice?: unknown };
    if (Array.isArray(obj.rolls)) {
      for (const r of obj.rolls as { die?: number; roll?: number }[]) {
        if (typeof r.die === "number" && typeof r.roll === "number") {
          const arr = bySides.get(r.die) ?? [];
          arr.push(r.roll);
          bySides.set(r.die, arr);
        }
      }
    }
    if (Array.isArray(obj.dice)) obj.dice.forEach(walk);
  };
  walk(node);
  return [...bySides.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([sides, values]) => ({ sides, values }));
}

export function DiceTray({ room }: { room: RoomStore }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pool, setPool] = useState<Record<number, number>>({});
  const [modifier, setModifier] = useState(0);
  const [advMode, setAdvMode] = useState<AdvMode>("normal");
  const [rolling, setRolling] = useState(false);
  const [log, setLog] = useState<RollRow[]>([]);

  const boxRef = useRef<DiceBox | null>(null);
  const loadingRef = useRef(false);
  const [boxReady, setBoxReady] = useState(false);
  const dpRef = useRef<DiceParser | null>(null);
  if (!dpRef.current) dpRef.current = new DiceParser();
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearHideTimer() {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }

  // The 3D dice sit on a fixed full-screen overlay — fade them out a few
  // seconds after they land instead of leaving them blocking the map.
  useEffect(() => clearHideTimer, []);

  // Lazily spin up the 3D dice engine the first time the tray is opened.
  // `toast` deliberately excluded from deps below — useToast() returns a new
  // object every render, and including it re-fires this effect (and, before
  // init resolves, spawns a duplicate DiceBox/asset fetch) on every re-render.
  useEffect(() => {
    if (!open || boxRef.current || loadingRef.current) return;
    loadingRef.current = true;
    let cancelled = false;
    (async () => {
      const { default: DiceBox } = await import("@3d-dice/dice-box");
      const box = new DiceBox({
        container: "#mv-dice-overlay",
        id: "mv-dice-canvas",
        assetPath: "/assets/dice-box/",
        scale: 4,
        gravity: 2,
        theme: "default",
        themeColor: "#f59e0b",
      });
      await box.init();
      if (cancelled) return;
      boxRef.current = box;
      setBoxReady(true);
    })()
      .catch(() => toast.error("Dice engine failed to load"))
      .finally(() => {
        loadingRef.current = false;
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Recent rolls + live feed for the whole room.
  // `toast` deliberately excluded from deps below — useToast() returns a new
  // object every render, and including it tears down and recreates this
  // realtime channel on every re-render. Since channel resubscription is
  // async, a roll INSERT landing in that gap is silently missed (Postgres
  // realtime doesn't replay events), which is why other viewers could miss
  // the "someone rolled" toast entirely.
  useEffect(() => {
    const roomId = room.room?.id;
    if (!roomId) return;
    let active = true;

    room.supabase
      .from("dice_rolls")
      .select("*")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(25)
      .then(({ data }) => {
        if (active && data) setLog(data as RollRow[]);
      });

    const channel = room.supabase
      .channel(`dice:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "dice_rolls",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const row = payload.new as RollRow;
          setLog((l) =>
            l.some((r) => r.id === row.id) ? l : [row, ...l].slice(0, 50),
          );
          if (row.user_id !== room.userId) {
            toast.info(`🎲 ${row.actor_name}: ${row.notation} = ${row.total}`);
          }
        },
      )
      .subscribe();

    return () => {
      active = false;
      room.supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.room?.id, room.supabase, room.userId]);

  // Advantage/disadvantage always rolls the d20 as a pair, regardless of the
  // manually-clicked d20 count in the pool.
  const notation = buildNotation(pool, modifier, advMode);
  const diceCount = DICE.reduce(
    (a, s) =>
      a + (s === 20 && advMode !== "normal" ? 2 : (pool[s] ?? 0)),
    0,
  );

  function bump(sides: number, delta: number) {
    setPool((p) => {
      const next = { ...p, [sides]: Math.max(0, (p[sides] ?? 0) + delta) };
      if (!next[sides]) delete next[sides];
      return next;
    });
  }

  async function roll() {
    if (diceCount === 0 || rolling) return;
    const box = boxRef.current;
    if (!box) {
      toast.info("Dice still loading…");
      return;
    }
    const dp = dpRef.current!;
    // A previous roll may be mid-fade-out (or already hidden) — cancel that
    // and bring the dice back before rolling again.
    clearHideTimer();
    box.show();
    setRolling(true);
    try {
      // Parse the roll20-style notation into the plain {qty,sides,mods}
      // groups dice-box's physics engine expects, roll them for real, then
      // feed the actual rolled values back through the parser so it can
      // apply kh1/kl1 (and any future modifiers) to the true 3D results —
      // the parser never invents its own numbers.
      const dieGroups = dp.parseNotation(notation);
      const raw = await box.roll(dieGroups);
      // Dice have landed — fade them out after a few seconds so they stop
      // sitting on top of the map.
      hideTimerRef.current = setTimeout(() => {
        box.hide("dice-box-canvas--hide");
        hideTimerRef.current = null;
      }, 4000);
      const results = Array.isArray(raw)
        ? raw
        : ((raw as { rolls?: typeof raw })?.rolls ?? []);

      // Our own notation builder never emits two groups with the same
      // `sides` in one roll, so grouping the flat physics output back up
      // by side count is an unambiguous way to match it to its group.
      const bySides = new Map<number, { sides: number; value: number }[]>();
      for (const r of results) {
        const sides = Number(r.sides);
        const arr = bySides.get(sides) ?? [];
        arr.push({ sides, value: r.value });
        bySides.set(sides, arr);
      }
      const groupsForParser = dieGroups.map((g) => ({
        ...g,
        rolls: bySides.get(Number(g.sides)) ?? [],
      }));
      const finalResults = dp.parseFinalResults(groupsForParser);

      const detail = collectDetail(finalResults);
      const total = finalResults.value;

      const actorName =
        room.members.find((m) => m.user_id === room.userId)?.display_name ??
        "Someone";

      const { error } = await room.supabase.from("dice_rolls").insert({
        room_id: room.room!.id,
        user_id: room.userId,
        actor_name: actorName,
        notation,
        detail,
        total,
      });
      if (error) toast.error(error.message);
    } catch {
      toast.error("Roll failed");
    } finally {
      setRolling(false);
    }
  }

  function closeTray() {
    setOpen(false);
    clearHideTimer();
    boxRef.current?.hide();
  }

  return (
    <>
      <div
        id="mv-dice-overlay"
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[60]"
      />

      <button
        type="button"
        onClick={() => (open ? closeTray() : setOpen(true))}
        aria-label="Dice roller"
        className="fixed bottom-4 right-4 z-[62] flex h-12 w-12 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900 text-xl shadow-lg transition-colors hover:bg-neutral-800"
      >
        🎲
      </button>

      {open && (
        <div className="fixed bottom-20 right-4 z-[62] flex max-h-[70vh] w-[17rem] flex-col rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl">
          <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Dice roller
            </span>
            <button
              type="button"
              onClick={closeTray}
              className="text-neutral-500 hover:text-neutral-200"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="space-y-2 p-3">
            <div className="grid grid-cols-4 gap-1">
              {DICE.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => bump(s, 1)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    bump(s, -1);
                  }}
                  title="Click to add · right-click to remove"
                  className="relative rounded-md border border-neutral-700 bg-neutral-800 py-2 text-xs font-semibold hover:bg-neutral-700"
                >
                  d{s}
                  {pool[s] ? (
                    <span className="absolute -right-1 -top-1 rounded-full bg-amber-500 px-1 text-[10px] font-bold text-neutral-950">
                      {pool[s]}
                    </span>
                  ) : null}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setPool({});
                  setModifier(0);
                  setAdvMode("normal");
                }}
                className="rounded-md border border-neutral-700 py-2 text-xs text-neutral-400 hover:bg-neutral-800"
              >
                clear
              </button>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-400">d20</span>
              <div className="flex gap-1">
                {(
                  [
                    ["normal", "Normal"],
                    ["adv", "Adv"],
                    ["dis", "Dis"],
                  ] as const
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setAdvMode(m)}
                    className={`rounded px-2 py-1 text-xs font-semibold ${
                      advMode === m
                        ? "bg-amber-500 text-neutral-950"
                        : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-400">Modifier</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setModifier((m) => m - 1)}
                  className="h-6 w-6 rounded bg-neutral-800 hover:bg-neutral-700"
                >
                  −
                </button>
                <span className="w-9 text-center tabular-nums">
                  {modifier > 0 ? `+${modifier}` : modifier}
                </span>
                <button
                  type="button"
                  onClick={() => setModifier((m) => m + 1)}
                  className="h-6 w-6 rounded bg-neutral-800 hover:bg-neutral-700"
                >
                  +
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={roll}
              disabled={diceCount === 0 || rolling || !boxReady}
              className="w-full rounded-md bg-amber-500 py-2 text-sm font-semibold text-neutral-950 hover:bg-amber-400 disabled:opacity-50"
            >
              {!boxReady
                ? "Loading dice…"
                : rolling
                  ? "Rolling…"
                  : notation
                    ? `Roll  ${notation}`
                    : "Roll"}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto border-t border-neutral-800 p-2">
            {log.length === 0 ? (
              <p className="p-2 text-xs text-neutral-500">No rolls yet.</p>
            ) : (
              <ul className="space-y-1">
                {log.map((r) => (
                  <li
                    key={r.id}
                    className={`rounded px-2 py-1 text-xs ${
                      r.user_id === room.userId
                        ? "bg-amber-500/10"
                        : "bg-neutral-800/40"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium text-neutral-200">
                        {r.actor_name}
                      </span>
                      <span className="shrink-0 text-sm font-bold text-amber-300">
                        {r.total}
                      </span>
                    </div>
                    <div className="truncate text-[10px] text-neutral-500">
                      {r.notation}
                      {r.detail.length > 0 && (
                        <>
                          {" · "}
                          {r.detail
                            .map((g) => `d${g.sides}[${g.values.join(",")}]`)
                            .join(" ")}
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
