"use client";

import { useEffect, useRef, useState } from "react";

import type DiceBox from "@3d-dice/dice-box";
import DiceParser from "@3d-dice/dice-parser-interface";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { useToast } from "@/components/toast";
import type { RoomStore } from "@/lib/room/useRoomState";
import { useTwistDread } from "@/components/room/TwistDreadProvider";
import { houseError, type HouseReroll } from "@/lib/twist-dread";
import type { ActionRequest, DiceDetail } from "@/lib/database.types";

const DICE = [4, 6, 8, 10, 12, 20, 100] as const;

// Every dice-box theme whose diceAvailable includes the full standard D&D
// polyhedral set (d4/d6/d8/d10/d12/d20/d100) — vendored under
// public/assets/dice-box/themes/ from github.com/3d-dice/dice-themes.
// Deliberately excludes genesys (Genesys RPG's own custom dice),
// diceOfRolling-fate (Fate dice) and smooth-pip (pip-only d6) — none of
// those roll a d20.
const THEMES = [
  { id: "default", label: "Default" },
  { id: "gemstone", label: "Gemstone" },
  { id: "gemstoneMarble", label: "Gemstone Marble" },
  { id: "rust", label: "Rust" },
  { id: "rock", label: "Rock" },
  { id: "wooden", label: "Wooden" },
  { id: "smooth", label: "Smooth" },
  { id: "diceOfRolling", label: "Dice of Rolling" },
  { id: "blueGreenMetal", label: "Blue/Green Metal" },
] as const;

// Purely a local rendering preference (this app's 3D roll animation is
// already local-only — only the numeric result syncs to other players, see
// [[dice-roller]]) — no reason for this to live in Supabase.
const THEME_STORAGE_KEY = "mv-dice-theme";

function loadSavedTheme(): string {
  if (typeof window === "undefined") return "default";
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved && THEMES.some((t) => t.id === saved) ? saved : "default";
  } catch {
    return "default";
  }
}

type RollRow = {
  superseded_by: string | null;
  id: string;
  user_id: string | null;
  actor_name: string;
  notation: string;
  detail: DiceDetail[];
  total: number;
  created_at: string;
};

type AdvMode = "normal" | "adv" | "dis";
type RollVisibility = "public" | "dm" | "self";

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

type RequestRoll = { values: number[]; modifier: number; mode: AdvMode };

export function DiceTray({ room, request = null, onRequestClose, onRequestCompleted }: {
  room: RoomStore;
  request?: ActionRequest | null;
  onRequestClose?: () => void;
  onRequestCompleted?: (row: ActionRequest) => void;
}) {
  const toast = useToast();
  const house = useTwistDread();
  const [houseRollId, setHouseRollId] = useState<string | null>(null);
  const houseRoll = !request ? house.rerolls.find((r) => r.id === houseRollId && r.status !== "resolved") ?? null : null;
  const [houseResults, setHouseResults] = useState<Record<string, DiceDetail[]>>({});
  const retryHouse = houseRoll ? houseResults[houseRoll.id] : undefined;
  const ownTwist = house.players.find((p) => p.user_id === room.userId)?.twist ?? 0;
  const [open, setOpen] = useState(false);
  const [pool, setPool] = useState<Record<number, number>>({});
  const [modifier, setModifier] = useState(0);
  const [advMode, setAdvMode] = useState<AdvMode>("normal");
  const [visibility, setVisibility] = useState<RollVisibility>("public");
  const [rolling, setRolling] = useState(false);
  const rollLock = useRef(false);
  // Keep landed results on network failure: retry saving the same dice, never reroll.
  const [requestRolls, setRequestRolls] = useState<Record<string, RequestRoll>>({});
  const retryRoll = request ? requestRolls[request.id] : undefined;

  const [requestOptions, setRequestOptions] = useState<Record<string, { modifier: number; mode: AdvMode }>>({});
  const selectedModifier = request ? requestOptions[request.id]?.modifier ?? 0 : modifier;
  const selectedMode = request ? requestOptions[request.id]?.mode ?? "normal" : advMode;
  const trayOpen = open || !!request || !!houseRoll;

  function changeModifier(delta: number) {
    const value = Math.max(-1000, Math.min(1000, selectedModifier + delta));
    if (request) setRequestOptions((prev) => ({ ...prev, [request.id]: { modifier: value, mode: selectedMode } }));
    else setModifier(value);
  }

  function changeMode(mode: AdvMode) {
    if (request) setRequestOptions((prev) => ({ ...prev, [request.id]: { modifier: selectedModifier, mode } }));
    else setAdvMode(mode);
  }
  const [log, setLog] = useState<RollRow[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const boxRef = useRef<DiceBox | null>(null);
  const mountedRef = useRef(false);
  const loadingRef = useRef(false);
  const [boxReady, setBoxReady] = useState(false);
  const [theme, setTheme] = useState(loadSavedTheme);
  const dpRef = useRef<DiceParser | null>(null);
  if (dpRef.current === null) { dpRef.current = new DiceParser(); }
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearHideTimer() {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }

  // The 3D dice sit on a fixed full-screen overlay — fade them out a few
  // seconds after they land instead of leaving them blocking the map.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearHideTimer();
      boxRef.current?.hide();
    };
  }, []);

  // Lazily spin up the 3D dice engine the first time the tray is opened.
  // `toast` deliberately excluded from deps below — useToast() returns a new
  // object every render, and including it re-fires this effect (and, before
  // init resolves, spawns a duplicate DiceBox/asset fetch) on every re-render.
  useEffect(() => {
    if (!trayOpen || boxRef.current || loadingRef.current) return;
    loadingRef.current = true;
    (async () => {
      const { default: DiceBox } = await import("@3d-dice/dice-box");
      const box = new DiceBox({
        container: "#mv-dice-overlay",
        id: "mv-dice-canvas",
        assetPath: "/assets/dice-box/",
        scale: 4,
        gravity: 2,
        // Picks up whatever was saved from a previous session (loadSavedTheme,
        // read once into state before this effect ever runs) — deliberately
        // not a dep of this effect (see the `toast` note above); a change
        // afterward goes through handleThemeChange's updateConfig instead.
        theme,
        themeColor: "#f59e0b",
      });
      await box.init();
      if (!mountedRef.current) { box.hide(); return; }
      boxRef.current = box;
      box.hide();
      setBoxReady(true);
    })()
      .catch(() => toast.error("Dice engine failed to load"))
      .finally(() => {
        loadingRef.current = false;
      });
    // Closing while init is in flight must not discard the engine: a pending
    // Twist/Dread reroll can be resumed as soon as initialization finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trayOpen]);

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
          event: "*",
          schema: "public",
          table: "dice_rolls",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            setLog((prev) => prev.filter((row) => row.id !== (payload.old as { id: string }).id));
            return;
          }
          const row = payload.new as RollRow;
          setLog((prev) => [row, ...prev.filter((r) => r.id !== row.id)]
            .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50));
          if (payload.eventType === "INSERT" && row.user_id !== room.userId) {
            toast.info(`🎲 ${row.actor_name}: ${row.notation} = ${row.total}`);
          }
        },
      )
      // "DM roll" — never written to dice_rolls (that's the shared, permanent log; a private
      // roll must never land there), so it can only reach the DM as a live broadcast. NOTE:
      // this is a soft/informal privacy boundary, not a real access-control one — every room
      // member's client technically receives this broadcast (Realtime channels aren't scoped
      // per-role the way postgres_changes + RLS is), it's just that only a DM-role client acts
      // on it. Fine for "hide this from casual view during play", not a security guarantee.
      .on("broadcast", { event: "private-roll" }, ({ payload }) => {
        if (room.role !== "dm") return;
        const p = payload as {
          fromUserId: string;
          actorName: string;
          notation: string;
          total: number;
        };
        if (p.fromUserId === room.userId) return; // DM rolling for themself — already shown locally.
        toast.info(`🎲🔒 ${p.actorName} (private): ${p.notation} = ${p.total}`);
      })
      .subscribe();
    channelRef.current = channel;

    return () => {
      active = false;
      channelRef.current = null;
      room.supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.room?.id, room.supabase, room.userId]);

  // Other combat UI (for example Target / Attack Assist) can prefill the tray
  // without coupling SceneCanvas directly to DiceTray state.
  useEffect(() => {
    function onPrefill(event: Event) {
      const detail = (event as CustomEvent<{
        sides?: number;
        count?: number;
        modifier?: number;
        advMode?: AdvMode;
      }>).detail;
      const sides = detail?.sides ?? 20;
      const count = Math.max(1, detail?.count ?? 1);
      setPool({ [sides]: count });
      setModifier(detail?.modifier ?? 0);
      setAdvMode(detail?.advMode ?? "normal");
      setOpen(true);
    }
    window.addEventListener("mv:dice-prefill", onPrefill);
    return () => window.removeEventListener("mv:dice-prefill", onPrefill);
  }, []);

  // Advantage/disadvantage always rolls the d20 as a pair, regardless of the
  // manually-clicked d20 count in the pool.
  const notation = houseRoll?.notation ?? buildNotation(request ? { 20: 1 } : pool, selectedModifier, selectedMode);
  const diceCount = houseRoll ? 1 : request ? (selectedMode === "normal" ? 1 : 2) : DICE.reduce(
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

  async function saveRequestRoll(target: ActionRequest, result: RequestRoll) {
    const { data, error } = await room.supabase.rpc("complete_action_request", {
      p_request: target.id, p_values: result.values, p_modifier: result.modifier, p_mode: result.mode,
    }).single();
    if (error) throw error;
    setRequestRolls((prev) => {
      const next = { ...prev };
      delete next[target.id];
      return next;
    });
    toast.success(`Request completed: ${data.result_notation} = ${data.result_total}`);
    onRequestCompleted?.(data);
  }

  async function startHouseReroll(row: RollRow, resource: "twist" | "dread", mode: "choose" | "lower" | "higher") {
    if (rollLock.current) return;
    rollLock.current = true; setRolling(true);
    try {
      const event = await house.transact({ kind: resource, target: resource === "twist" ? room.userId : undefined, roll: row.id, mode });
      onRequestClose?.();
      setHouseRollId(event.id);
      setOpen(true);
    } catch (error) {
      house.refresh();
      toast.error(houseError(error, "Could not start reroll"));
    } finally { rollLock.current = false; setRolling(false); }
  }

  function acceptHouseReroll(row: HouseReroll) {
    house.rememberReroll(row);
    if (row.status === "resolved") {
      setHouseRollId(null);
      toast.success(`${row.resource.toUpperCase()}: kept ${row.chosen} result (${row.chosen_total})`);
    }
  }

  async function saveHouseRoll(target: HouseReroll, detail: DiceDetail[]) {
    const { data, error } = await room.supabase.rpc("submit_house_reroll", { p_reroll: target.id, p_detail: detail }).single();
    if (error) throw error;
    setHouseResults((prev) => { const next = { ...prev }; delete next[target.id]; return next; });
    acceptHouseReroll(data);
  }

  async function chooseHouseResult(target: HouseReroll, choice: "old" | "new") {
    if (rollLock.current) return;
    rollLock.current = true; setRolling(true);
    try {
      const { data, error } = await room.supabase.rpc("resolve_house_reroll", { p_reroll: target.id, p_choice: choice }).single();
      if (error) throw error;
      acceptHouseReroll(data);
    } catch (error) { toast.error(houseError(error, "Could not save result choice")); }
    finally { rollLock.current = false; setRolling(false); }
  }

  async function roll() {
    if (diceCount === 0 || rollLock.current || houseRoll?.status === "rolled") return;
    if (houseRoll && retryHouse) {
      rollLock.current = true; setRolling(true);
      try { await saveHouseRoll(houseRoll, retryHouse); }
      catch { toast.error("Could not save reroll. Retry submits the same landed dice."); }
      finally { rollLock.current = false; setRolling(false); }
      return;
    }
    if (!houseRoll && request && retryRoll) {
      rollLock.current = true;
      setRolling(true);
      try { await saveRequestRoll(request, retryRoll); }
      catch { toast.error("Could not save roll. Retry to submit the same result."); }
      finally { rollLock.current = false; setRolling(false); }
      return;
    }
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
    rollLock.current = true;
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

      // Only a public roll ever touches the shared/permanent log (dice_rolls) — "DM roll" and
      // "self roll" are relayed live (or, for self, not relayed at all) and never written
      // anywhere, per the ask: "yang masuk log cuma yang publik aja".
      if (houseRoll) {
        const result = [...bySides.entries()].sort((a, b) => a[0] - b[0])
          .map(([sides, dice]) => ({ sides, values: dice.map((die) => die.value) }));
        setHouseResults((prev) => ({ ...prev, [houseRoll.id]: result }));
        await saveHouseRoll(houseRoll, result);
      } else if (request) {
        const result: RequestRoll = {
          values: (bySides.get(20) ?? []).map((die) => die.value), modifier: selectedModifier, mode: selectedMode,
        };
        setRequestRolls((prev) => ({ ...prev, [request.id]: result }));
        await saveRequestRoll(request, result);
      } else if (visibility === "public") {
        const { error } = await room.supabase.from("dice_rolls").insert({
          room_id: room.room!.id,
          user_id: room.userId,
          actor_name: actorName,
          notation,
          detail,
          total,
        });
        if (error) toast.error(error.message);
      } else if (visibility === "dm") {
        if (room.role === "dm") {
          // The DM rolling "privately" has no one else to hide it from — just their own toast.
          toast.info(`🔒 ${notation} = ${total}`);
        } else {
          channelRef.current?.send({
            type: "broadcast",
            event: "private-roll",
            payload: { fromUserId: room.userId, actorName, notation, total },
          });
          toast.info(`Sent privately to the DM: ${notation} = ${total}`);
        }
      } else {
        toast.info(`🔒 ${notation} = ${total}`);
      }
    } catch {
      toast.error(houseRoll ? "Could not save reroll. If dice landed, retry saves the same values." : request ? "Could not finish request. If dice landed, retry saving the same result." : "Roll failed");
    } finally {
      rollLock.current = false;
      setRolling(false);
    }
  }

  function handleThemeChange(next: string) {
    setTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private browsing / storage disabled — theme just won't persist
      // across sessions, not worth surfacing to the user.
    }
    // Box may not exist yet (tray never opened) — the init effect above
    // reads the state we just set, so there's nothing else to do then.
    boxRef.current?.updateConfig({ theme: next });
  }

  function closeTray() {
    if (rollLock.current) return;
    onRequestClose?.();
    setHouseRollId(null);
    setOpen(false);
    clearHideTimer();
    boxRef.current?.hide();
  }

  return (
    <>
      <div
        id="mv-dice-overlay"
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[100]"
      />

      <button
        type="button"
        onClick={() => (trayOpen ? closeTray() : setOpen(true))}
        aria-label="Dice roller"
        className="fixed bottom-3 right-2 z-[62] flex h-10 w-10 items-center justify-center rounded-b-xl rounded-t-md border border-neutral-700 bg-neutral-900/95 text-lg shadow-lg backdrop-blur transition-colors hover:bg-neutral-800 sm:bottom-4 sm:right-4 sm:h-12 sm:w-12 sm:rounded-full sm:text-xl"
      >
        🎲
      </button>

      {trayOpen && (
        <div className="fixed inset-x-2 bottom-16 z-[62] flex max-h-[72%] flex-col rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl sm:inset-x-auto sm:bottom-20 sm:right-4 sm:max-h-[70vh] sm:w-[17rem]">
          <div className="flex items-center justify-between gap-2 border-b border-neutral-800 px-3 py-2">
            <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Dice roller
            </span>
            <select
              value={theme}
              disabled={rolling}
              onChange={(e) => handleThemeChange(e.target.value)}
              title="Dice skin"
              aria-label="Dice skin"
              className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5 text-[11px] text-neutral-300"
            >
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={closeTray}
              className="shrink-0 text-neutral-500 hover:text-neutral-200"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="space-y-2 p-3">
            {houseRoll && <div className="space-y-2 rounded border border-purple-500/30 bg-purple-500/10 p-2 text-xs text-purple-200">
              <p className="font-semibold">{houseRoll.resource.toUpperCase()} · {houseRoll.actor_name}</p>
              <p>{houseRoll.notation} · original {houseRoll.old_total}</p>
              <p className="text-neutral-400">Resource already spent. {houseRoll.choice_mode === "choose" ? "Choose the original or new result after rolling." : `The ${houseRoll.choice_mode} result will be selected automatically.`}</p>
              {retryHouse && <p>Dice landed; retry saves the same values.</p>}
              {houseRoll.status === "rolled" && <>
                <p>New result: <strong>{houseRoll.new_total}</strong></p>
                <p className="text-[10px] text-neutral-400">{houseRoll.new_detail?.map((d) => `d${d.sides}[${d.values.join(", ")}]`).join(" · ")}</p>
                <div className="flex gap-2">
                  <button type="button" disabled={rolling} onClick={() => void chooseHouseResult(houseRoll, "old")} className="flex-1 rounded bg-neutral-700 p-2 disabled:opacity-50">Keep {houseRoll.old_total}</button>
                  <button type="button" disabled={rolling} onClick={() => void chooseHouseResult(houseRoll, "new")} className="flex-1 rounded bg-purple-500 p-2 text-white disabled:opacity-50">Keep {houseRoll.new_total}</button>
                </div>
              </>}
            </div>}

            {request && <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
              <p className="whitespace-pre-wrap break-words">{request.prompt}</p>
              <p className="mt-1 text-neutral-400">Public d20 roll{request.dc !== null ? ` · DC ${request.dc}` : ""}. Add your modifier below.</p>
              {retryRoll && <p className="mt-1">Dice [{retryRoll.values.join(", ")}] saved locally. Retry submits these same dice.</p>}
            </div>}
            {!houseRoll && <fieldset disabled={rolling || !!retryRoll} className="space-y-2">
            {!request && <div className="grid grid-cols-4 gap-1">
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
            </div>}

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
                    onClick={() => changeMode(m)}
                    className={`rounded px-2 py-1 text-xs font-semibold ${
                      selectedMode === m
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
                  onClick={() => changeModifier(-1)}
                  aria-label="Decrease roll modifier"
                  className="h-6 w-6 rounded bg-neutral-800 hover:bg-neutral-700"
                >
                  −
                </button>
                <span className="w-9 text-center tabular-nums">
                  {selectedModifier > 0 ? `+${selectedModifier}` : selectedModifier}
                </span>
                <button
                  type="button"
                  onClick={() => changeModifier(1)}
                  aria-label="Increase roll modifier"
                  className="h-6 w-6 rounded bg-neutral-800 hover:bg-neutral-700"
                >
                  +
                </button>
              </div>
            </div>

            {!request && <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-400">Visible to</span>
              <div className="flex gap-1">
                {(
                  [
                    ["public", "Public"],
                    ["dm", "DM"],
                    ["self", "Self"],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVisibility(v)}
                    className={`rounded px-2 py-1 text-xs font-semibold ${
                      visibility === v
                        ? "bg-amber-500 text-neutral-950"
                        : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>}
            </fieldset>}

            {houseRoll?.status !== "rolled" && <button
              type="button"
              onClick={roll}
              disabled={diceCount === 0 || rolling || (!boxReady && !retryRoll && !retryHouse)}
              className="w-full rounded-md bg-amber-500 py-2 text-sm font-semibold text-neutral-950 hover:bg-amber-400 disabled:opacity-50"
            >
              {(retryHouse || retryRoll) && !rolling ? "Retry saving roll" : !boxReady
                ? "Loading dice…"
                : rolling
                  ? "Rolling…"
                  : notation
                    ? `Roll  ${notation}`
                    : "Roll"}
            </button>}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto border-t border-neutral-800 p-2">
            {house.rerolls.some((r) => r.status !== "resolved" && (r.actor_user_id === room.userId || room.role === "dm")) && (
              <div className="mb-2 space-y-2 rounded-lg border border-purple-500/30 p-2 text-xs">
                <p className="font-semibold text-purple-200">Pending rerolls</p>
                {house.rerolls.filter((r) => r.status !== "resolved" && (r.actor_user_id === room.userId || room.role === "dm")).map((r) => <div key={r.id} className="space-y-1">
                  <p className="truncate">{r.resource.toUpperCase()} · {r.actor_name} · {r.notation}</p>
                  <div className="flex flex-wrap gap-2">
                    {r.actor_user_id === room.userId && <button type="button" disabled={rolling} className="rounded bg-purple-500/20 px-2 py-1 text-purple-200 disabled:opacity-50" onClick={() => { onRequestClose?.(); setHouseRollId(r.id); }}>Resume</button>}
                    <button type="button" disabled={rolling} className="rounded bg-neutral-800 px-2 py-1 disabled:opacity-50" onClick={() => void chooseHouseResult(r, "old")}>Keep original / close</button>
                  </div>
                </div>)}
              </div>
            )}
            {house.rerolls.some((r) => r.status === "resolved") && <details className="mb-2 p-1 text-xs text-neutral-400">
              <summary className="cursor-pointer">Twist/Dread result history</summary>
              <ul className="mt-2 space-y-2">{house.rerolls.filter((r) => r.status === "resolved").map((r) => <li key={r.id}>
                <p className="text-purple-200">{r.actor_name} · {r.resource.toUpperCase()}</p>
                <p>{r.old_total} → {r.new_total ?? "not rolled"} · kept {r.chosen} ({r.chosen_total})</p>
              </li>)}</ul>
            </details>}

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
                      <span className={`shrink-0 text-sm font-bold ${r.superseded_by ? "text-neutral-500 line-through" : "text-amber-300"}`}>
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
                    {r.superseded_by && <p className="mt-1 text-[10px] text-purple-300">Replaced by selected reroll result</p>}
                    {house.session && !house.error && !r.superseded_by && !house.rerolls.some((pending) => pending.base_roll_id === r.id && pending.status !== "resolved") && Date.parse(r.created_at) >= Date.parse(house.session.created_at) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {r.user_id === room.userId && ownTwist > 0 && <button type="button" disabled={rolling} onClick={() => void startHouseReroll(r, "twist", "choose")} className="rounded bg-amber-500/15 px-2 py-1 text-amber-200 disabled:opacity-50">Use Twist</button>}
                        {room.role === "dm" && house.session.dread > 0 && (!room.members.some((m) => m.user_id === r.user_id && m.role === "player") || house.players.some((p) => p.user_id === r.user_id)) && (
                          room.members.some((m) => m.user_id === r.user_id && m.role === "player") ? <>
                            <button type="button" disabled={rolling} onClick={() => void startHouseReroll(r, "dread", "lower")} className="rounded bg-red-500/15 px-2 py-1 text-red-200 disabled:opacity-50">Dread ↓</button>
                            <button type="button" disabled={rolling} onClick={() => void startHouseReroll(r, "dread", "higher")} className="rounded bg-red-500/15 px-2 py-1 text-red-200 disabled:opacity-50">Dread ↑</button>
                          </> : <button type="button" disabled={rolling} onClick={() => void startHouseReroll(r, "dread", "choose")} className="rounded bg-red-500/15 px-2 py-1 text-red-200 disabled:opacity-50">Use Dread</button>
                        )}
                      </div>
                    )}
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
