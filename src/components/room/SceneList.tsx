"use client";

import { useState } from "react";

import { Button, Input, Panel } from "@/components/ui";
import { useToast } from "@/components/toast";
import type { RoomStore } from "@/lib/room/useRoomState";

export function SceneList({ room }: { room: RoomStore }) {
  const toast = useToast();
  const isDM = room.role === "dm";
  const [name, setName] = useState("");
  const [mapUrl, setMapUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function addScene(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { data, error } = await room.supabase
        .from("scenes")
        .insert({
          room_id: room.room!.id,
          name: name.trim(),
          map_url: mapUrl.trim() || null,
          position: room.scenes.length,
        })
        .select("id")
        .single();
      if (error) throw error;
      setName("");
      setMapUrl("");
      // First scene becomes active automatically.
      if (!room.room?.active_scene_id) {
        await room.supabase
          .from("rooms")
          .update({ active_scene_id: data.id })
          .eq("id", room.room!.id);
      }
      room.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add scene");
    } finally {
      setBusy(false);
    }
  }

  async function setActive(sceneId: string) {
    const { error } = await room.supabase
      .from("rooms")
      .update({ active_scene_id: sceneId })
      .eq("id", room.room!.id);
    if (error) toast.error(error.message);
    room.setPreviewSceneId(null);
  }

  async function removeScene(sceneId: string) {
    if (!confirm("Delete this scene and its tokens/combatants?")) return;
    if (room.room?.active_scene_id === sceneId) {
      await room.supabase
        .from("rooms")
        .update({ active_scene_id: null })
        .eq("id", room.room.id);
    }
    const { error } = await room.supabase
      .from("scenes")
      .delete()
      .eq("id", sceneId);
    if (error) toast.error(error.message);
    room.reload();
  }

  return (
    <Panel title="Scenes">
      <ul className="space-y-1">
        {room.scenes.map((s) => {
          const isActive = room.room?.active_scene_id === s.id;
          const isViewing = room.activeSceneId === s.id;
          return (
            <li
              key={s.id}
              className={`flex items-center justify-between rounded px-2 py-1 text-sm ${
                isViewing ? "bg-neutral-800" : "hover:bg-neutral-800/50"
              }`}
            >
              <button
                className="flex-1 truncate text-left"
                onClick={() =>
                  isDM ? room.setPreviewSceneId(s.id) : undefined
                }
                title={isDM ? "Preview this scene" : undefined}
              >
                {s.name}
                {isActive && (
                  <span className="ml-1 text-[10px] text-emerald-400">
                    ● live
                  </span>
                )}
              </button>
              {isDM && (
                <span className="flex items-center gap-1">
                  {!isActive && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setActive(s.id)}
                    >
                      Go live
                    </Button>
                  )}
                  <button
                    className="px-1 text-neutral-500 hover:text-red-400"
                    onClick={() => removeScene(s.id)}
                    aria-label="Delete scene"
                  >
                    ✕
                  </button>
                </span>
              )}
            </li>
          );
        })}
        {room.scenes.length === 0 && (
          <li className="px-2 py-1 text-xs text-neutral-500">No scenes yet.</li>
        )}
      </ul>

      {isDM && (
        <form onSubmit={addScene} className="mt-3 space-y-2 border-t border-neutral-800 pt-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Scene name"
          />
          <Input
            value={mapUrl}
            onChange={(e) => setMapUrl(e.target.value)}
            placeholder="Map image URL (optional)"
          />
          <Button type="submit" size="sm" disabled={busy} className="w-full">
            Add scene
          </Button>
        </form>
      )}
    </Panel>
  );
}
