"use client";

import { useState } from "react";

import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";
import type { RoomStore } from "@/lib/room/useRoomState";
import type { Scene } from "@/lib/room/types";

export function ModeToggle({
  room,
  scene,
}: {
  room: RoomStore;
  scene: Scene;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      if (scene.mode === "exploration") {
        const { error: seedError } = await room.supabase.rpc(
          "seed_scene_combatants",
          { p_scene: scene.id },
        );
        if (seedError) throw seedError;
        const { error } = await room.supabase
          .from("scenes")
          .update({ mode: "combat" })
          .eq("id", scene.id);
        if (error) throw error;
      } else {
        const { error } = await room.supabase
          .from("scenes")
          .update({ mode: "exploration", active_combatant_id: null })
          .eq("id", scene.id);
        if (error) throw error;
      }
      room.reloadScene();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not switch mode");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      size="sm"
      variant={scene.mode === "exploration" ? "danger" : "secondary"}
      onClick={toggle}
      disabled={busy}
    >
      {scene.mode === "exploration" ? "Start combat" : "End combat"}
    </Button>
  );
}
