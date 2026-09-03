"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import type {
  Asset,
  Combatant,
  Member,
  Role,
  Room,
  Scene,
  Token,
} from "@/lib/room/types";

type State = {
  room: Room | null;
  scenes: Scene[];
  members: Member[];
  assets: Asset[];
  tokens: Token[];
  combatants: Combatant[];
  loading: boolean;
};

const EMPTY: State = {
  room: null,
  scenes: [],
  members: [],
  assets: [],
  tokens: [],
  combatants: [],
  loading: true,
};

export function useRoomState(roomId: string, userId: string, role: Role) {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<State>(EMPTY);
  const [previewSceneId, setPreviewSceneId] = useState<string | null>(null);

  // The scene everyone sees is room.active_scene_id. The DM may preview another.
  const activeSceneId =
    role === "dm" && previewSceneId
      ? previewSceneId
      : (state.room?.active_scene_id ?? null);

  // Mirror of activeSceneId for async guards / realtime handlers.
  const activeSceneRef = useRef<string | null>(null);
  useEffect(() => {
    activeSceneRef.current = activeSceneId;
  }, [activeSceneId]);

  const loadRoomBits = useCallback(async () => {
    const [rooms, scenes, members, assets] = await Promise.all([
      supabase.from("rooms").select("*").eq("id", roomId).single(),
      supabase
        .from("scenes")
        .select("*")
        .eq("room_id", roomId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("room_members")
        .select("id, user_id, role")
        .eq("room_id", roomId),
      supabase
        .from("assets")
        .select("*")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true }),
    ]);

    const userIds = (members.data ?? []).map((m) => m.user_id);
    const { data: profiles } = userIds.length
      ? await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", userIds)
      : { data: [] as { id: string; display_name: string }[] };
    const nameById = new Map(
      (profiles ?? []).map((p) => [p.id, p.display_name]),
    );

    setState((prev) => ({
      ...prev,
      room: rooms.data ?? prev.room,
      scenes: scenes.data ?? [],
      assets: assets.data ?? [],
      members: (members.data ?? []).map((m) => ({
        id: m.id,
        user_id: m.user_id,
        role: m.role,
        display_name: nameById.get(m.user_id) ?? "Adventurer",
      })),
      loading: false,
    }));
  }, [roomId, supabase]);

  const loadSceneBits = useCallback(
    async (sceneId: string | null) => {
      if (!sceneId) {
        setState((prev) => ({ ...prev, tokens: [], combatants: [] }));
        return;
      }
      const [tokens, combatants] = await Promise.all([
        supabase
          .from("tokens")
          .select("*")
          .eq("scene_id", sceneId)
          .order("created_at", { ascending: true }),
        supabase
          .from("combatants")
          .select("*")
          .eq("scene_id", sceneId)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true }),
      ]);
      // Ignore if the active scene changed while we were loading.
      if (activeSceneRef.current !== sceneId) return;
      setState((prev) => ({
        ...prev,
        tokens: tokens.data ?? [],
        combatants: combatants.data ?? [],
      }));
    },
    [supabase],
  );

  // Initial load
  useEffect(() => {
    loadRoomBits();
  }, [loadRoomBits]);

  // Reload scene contents whenever the active scene changes
  useEffect(() => {
    loadSceneBits(activeSceneId);
  }, [activeSceneId, loadSceneBits]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        (payload) => {
          setState((prev) => ({
            ...prev,
            room: (payload.new as Room) ?? prev.room,
          }));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "scenes",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          loadRoomBits();
          const changed = payload.new as Scene | undefined;
          if (changed && changed.id === activeSceneRef.current) {
            setState((prev) => ({
              ...prev,
              scenes: prev.scenes.map((s) =>
                s.id === changed.id ? changed : s,
              ),
            }));
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_members",
          filter: `room_id=eq.${roomId}`,
        },
        () => loadRoomBits(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "assets",
          filter: `room_id=eq.${roomId}`,
        },
        () => loadRoomBits(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tokens",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          setState((prev) => {
            const sceneId = activeSceneRef.current;
            if (payload.eventType === "DELETE") {
              return {
                ...prev,
                tokens: prev.tokens.filter(
                  (t) => t.id !== (payload.old as { id: string }).id,
                ),
              };
            }
            const row = payload.new as Token;
            if (row.scene_id !== sceneId) return prev;
            const exists = prev.tokens.some((t) => t.id === row.id);
            return {
              ...prev,
              tokens: exists
                ? prev.tokens.map((t) => (t.id === row.id ? row : t))
                : [...prev.tokens, row],
            };
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "combatants",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          setState((prev) => {
            const sceneId = activeSceneRef.current;
            if (payload.eventType === "DELETE") {
              return {
                ...prev,
                combatants: prev.combatants.filter(
                  (c) => c.id !== (payload.old as { id: string }).id,
                ),
              };
            }
            const row = payload.new as Combatant;
            if (row.scene_id !== sceneId) return prev;
            const exists = prev.combatants.some((c) => c.id === row.id);
            const next = exists
              ? prev.combatants.map((c) => (c.id === row.id ? row : c))
              : [...prev.combatants, row];
            next.sort(
              (a, b) =>
                a.sort_order - b.sort_order ||
                a.created_at.localeCompare(b.created_at),
            );
            return { ...prev, combatants: next };
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, supabase, loadRoomBits]);

  const activeScene =
    state.scenes.find((s) => s.id === activeSceneId) ?? null;

  // Optimistic local patch for a token (used during drag so it feels instant)
  const patchTokenLocal = useCallback((id: string, patch: Partial<Token>) => {
    setState((prev) => ({
      ...prev,
      tokens: prev.tokens.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  }, []);

  return {
    ...state,
    supabase,
    userId,
    role,
    activeScene,
    activeSceneId,
    previewSceneId,
    setPreviewSceneId,
    reload: loadRoomBits,
    reloadScene: () => loadSceneBits(activeSceneRef.current),
    patchTokenLocal,
  };
}

export type RoomStore = ReturnType<typeof useRoomState>;
