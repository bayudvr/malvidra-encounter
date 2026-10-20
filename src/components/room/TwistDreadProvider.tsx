"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { RoomStore } from "@/lib/room/useRoomState";
import type { HouseSession, HousePlayer, HouseEvent, HouseReroll } from "@/lib/twist-dread";

type HouseState = {
  session: HouseSession | null; players: HousePlayer[]; events: HouseEvent[]; rerolls: HouseReroll[];
  loading: boolean; error: string | null;
};
const initial: HouseState = { session: null, players: [], events: [], rerolls: [], loading: true, error: null };
type Transaction = { kind: "twist" | "dread" | "distribute"; target?: string; amount?: number; roll?: string; mode?: "choose" | "lower" | "higher" };
const HouseContext = createContext<(HouseState & {
  refresh: () => void;
  rememberReroll: (row: HouseReroll) => void;
  setup: (quota: number, players: string[]) => Promise<void>;
  transact: (values: Transaction) => Promise<HouseEvent>;
}) | null>(null);

export function TwistDreadProvider({ room, children }: { room: RoomStore; children: ReactNode }) {
  const [state, setState] = useState(initial);
  const [revision, setRevision] = useState(0);
  const operations = useRef(new Map<string, string>());
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const roomId = room.room?.id;

  useEffect(() => {
    if (!roomId) return;
    let live = true;
    void (async () => {
      const { data: session, error } = await room.supabase.from("house_sessions").select("*")
        .eq("room_id", roomId).eq("active", true).maybeSingle();
      if (error) throw error;
      if (!session) {
        if (live) setState({ ...initial, loading: false });
        return;
      }
      const [players, events, pending, history] = await Promise.all([
        room.supabase.from("house_players").select("*").eq("session_id", session.id).order("user_id"),
        room.supabase.from("house_events").select("*").eq("session_id", session.id).order("created_at", { ascending: false }).limit(30),
        room.supabase.from("house_rerolls").select("*").eq("session_id", session.id).neq("status", "resolved").order("created_at"),
        room.supabase.from("house_rerolls").select("*").eq("session_id", session.id).eq("status", "resolved").order("created_at", { ascending: false }).limit(30),
      ]);
      const failed = players.error ?? events.error ?? pending.error ?? history.error;
      if (failed) throw failed;
      if (live) setState({ session, players: players.data ?? [], events: events.data ?? [],
        rerolls: [...(pending.data ?? []), ...(history.data ?? [])], loading: false, error: null });
    })().catch(() => {
      if (live) setState((prev) => ({ ...prev, loading: false, error: "Could not load Twist/Dread. Check the connection and try again." }));
    });
    return () => { live = false; };
  }, [roomId, room.supabase, revision]);

  useEffect(() => {
    if (!roomId) return;
    let channel = room.supabase.channel(`house-rules:${roomId}`);
    for (const table of ["house_sessions", "house_players", "house_events", "house_rerolls"]) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `room_id=eq.${roomId}` }, refresh);
    }
    channel.subscribe((status) => { if (status === "SUBSCRIBED") refresh(); });
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); void room.supabase.removeChannel(channel); };
  }, [roomId, room.supabase, refresh]);

  const rememberReroll = useCallback((row: HouseReroll) => {
    setState((prev) => ({ ...prev, rerolls: [row, ...prev.rerolls.filter((r) => r.id !== row.id)] }));
    refresh();
  }, [refresh]);

  function operationFor(key: string) {
    let id = operations.current.get(key);
    if (!id) { id = crypto.randomUUID(); operations.current.set(key, id); }
    return id;
  }

  async function setup(quota: number, players: string[]) {
    if (!roomId) throw new Error("Room is still loading");
    const key = JSON.stringify(["setup", roomId, quota, [...players].sort()]);
    const { error } = await room.supabase.rpc("setup_house_session", {
      p_room: roomId, p_quota: quota, p_players: players, p_operation: operationFor(key),
    });
    if (error) throw error;
    operations.current.delete(key);
    refresh();
  }

  async function transact(values: Transaction) {
    if (!state.session || state.session.room_id !== roomId) throw new Error("The DM must set up this session first");
    const args = { p_session: state.session.id, p_kind: values.kind, p_target: values.target ?? null,
      p_amount: values.amount ?? 1, p_roll: values.roll ?? null, p_mode: values.mode ?? null };
    const key = JSON.stringify(args);
    const { data, error } = await room.supabase.rpc("apply_house_event", { ...args, p_operation: operationFor(key) }).single();
    if (error) throw error;
    if (values.roll) {
      const { data: reroll, error: fetchError } = await room.supabase.from("house_rerolls").select("*").eq("id", data.id).single();
      if (fetchError) throw fetchError;
      rememberReroll(reroll);
    }
    operations.current.delete(key);
    refresh();
    return data;
  }

  const visible = state.session && state.session.room_id !== roomId ? initial : state;
  return <HouseContext.Provider value={{ ...visible, refresh, rememberReroll, setup, transact }}>{children}</HouseContext.Provider>;
}

export function useTwistDread() {
  const value = useContext(HouseContext);
  if (!value) throw new Error("TwistDreadProvider is missing");
  return value;
}
