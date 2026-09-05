"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import type {
  Asset,
  Combatant,
  FogPolygon,
  FogDoor,
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
  fogPolygons: FogPolygon[];
  fogDoors: FogDoor[];
  loading: boolean;
};

const EMPTY: State = {
  room: null,
  scenes: [],
  members: [],
  assets: [],
  tokens: [],
  combatants: [],
  fogPolygons: [],
  fogDoors: [],
  loading: true,
};

export function useRoomState(roomId: string, userId: string, role: Role) {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<State>(EMPTY);
  const [previewSceneId, setPreviewSceneId] = useState<string | null>(null);
  const [kicked, setKicked] = useState(false);

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
        setState((prev) => ({
          ...prev,
          tokens: [],
          combatants: [],
          fogPolygons: [],
          fogDoors: [],
        }));
        return;
      }
      const [tokens, combatants, fogPolygons, fogDoors] = await Promise.all([
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
        supabase.from("fog_polygons").select("*").eq("scene_id", sceneId),
        supabase.from("fog_doors").select("*").eq("scene_id", sceneId),
      ]);
      // Ignore if the active scene changed while we were loading.
      if (activeSceneRef.current !== sceneId) return;
      setState((prev) => ({
        ...prev,
        tokens: tokens.data ?? [],
        combatants: combatants.data ?? [],
        fogPolygons: fogPolygons.data ?? [],
        fogDoors: fogDoors.data ?? [],
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
        async () => {
          loadRoomBits();
          // A player who was just kicked should be bounced out of the room.
          if (role !== "dm") {
            const { data } = await supabase
              .from("room_members")
              .select("id")
              .eq("room_id", roomId)
              .eq("user_id", userId)
              .maybeSingle();
            if (!data) setKicked(true);
          }
        },
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
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "fog_polygons",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          setState((prev) => {
            const sceneId = activeSceneRef.current;
            if (payload.eventType === "DELETE") {
              return {
                ...prev,
                fogPolygons: prev.fogPolygons.filter(
                  (p) => p.id !== (payload.old as { id: string }).id,
                ),
              };
            }
            const row = payload.new as FogPolygon;
            if (row.scene_id !== sceneId) return prev;
            const exists = prev.fogPolygons.some((p) => p.id === row.id);
            return {
              ...prev,
              fogPolygons: exists
                ? prev.fogPolygons
                : [...prev.fogPolygons, row],
            };
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "fog_doors",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          setState((prev) => {
            const sceneId = activeSceneRef.current;
            if (payload.eventType === "DELETE") {
              return {
                ...prev,
                fogDoors: prev.fogDoors.filter(
                  (d) => d.id !== (payload.old as { id: string }).id,
                ),
              };
            }
            const row = payload.new as FogDoor;
            if (row.scene_id !== sceneId) return prev;
            const exists = prev.fogDoors.some((d) => d.id === row.id);
            return {
              ...prev,
              fogDoors: exists
                ? prev.fogDoors.map((d) => (d.id === row.id ? row : d))
                : [...prev.fogDoors, row],
            };
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, supabase, loadRoomBits, role, userId]);

  const activeScene =
    state.scenes.find((s) => s.id === activeSceneId) ?? null;

  // Optimistic local patch for a token (used during drag so it feels instant)
  const patchTokenLocal = useCallback((id: string, patch: Partial<Token>) => {
    setState((prev) => ({
      ...prev,
      tokens: prev.tokens.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  }, []);

  // Optimistic local insert (used right after creating a token, e.g. an
  // alt-drag duplicate) so it appears instantly instead of waiting on the
  // realtime round-trip. The later realtime INSERT is a no-op dedupe.
  const addTokenLocal = useCallback((token: Token) => {
    setState((prev) =>
      prev.tokens.some((t) => t.id === token.id)
        ? prev
        : { ...prev, tokens: [...prev.tokens, token] },
    );
  }, []);

  // Optimistic local polygon add/remove (drawing/deleting a room shape
  // should feel instant rather than waiting on the realtime round-trip).
  const addFogPolygonLocal = useCallback((polygon: FogPolygon) => {
    setState((prev) =>
      prev.fogPolygons.some((p) => p.id === polygon.id)
        ? prev
        : { ...prev, fogPolygons: [...prev.fogPolygons, polygon] },
    );
  }, []);

  const removeFogPolygonLocal = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      fogPolygons: prev.fogPolygons.filter((p) => p.id !== id),
    }));
  }, []);

  const patchFogDoorLocal = useCallback((id: string, patch: Partial<FogDoor>) => {
    setState((prev) => ({
      ...prev,
      fogDoors: prev.fogDoors.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    }));
  }, []);

  const addFogDoorLocal = useCallback((door: FogDoor) => {
    setState((prev) =>
      prev.fogDoors.some((d) => d.id === door.id)
        ? prev
        : { ...prev, fogDoors: [...prev.fogDoors, door] },
    );
  }, []);

  return {
    ...state,
    supabase,
    userId,
    role,
    kicked,
    activeScene,
    activeSceneId,
    previewSceneId,
    setPreviewSceneId,
    reload: loadRoomBits,
    reloadScene: () => loadSceneBits(activeSceneRef.current),
    patchTokenLocal,
    addTokenLocal,
    addFogPolygonLocal,
    removeFogPolygonLocal,
    patchFogDoorLocal,
    addFogDoorLocal,
  };
}

export type RoomStore = ReturnType<typeof useRoomState>;
