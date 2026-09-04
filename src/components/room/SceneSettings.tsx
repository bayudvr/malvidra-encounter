"use client";

import { useEffect, useState } from "react";

import { Button, Input, Label, Panel } from "@/components/ui";
import { useToast } from "@/components/toast";
import type { RoomStore } from "@/lib/room/useRoomState";
import type { Scene, SceneUpdate } from "@/lib/room/types";

export function SceneSettings({
  room,
  scene,
}: {
  room: RoomStore;
  scene: Scene;
}) {
  const toast = useToast();
  const [mapUrl, setMapUrl] = useState(scene.map_url ?? "");
  const [gridSize, setGridSize] = useState(String(scene.grid_size));
  const [feet, setFeet] = useState(String(scene.feet_per_square));

  useEffect(() => {
    setMapUrl(scene.map_url ?? "");
    setGridSize(String(scene.grid_size));
    setFeet(String(scene.feet_per_square));
  }, [scene.id, scene.map_url, scene.grid_size, scene.feet_per_square]);

  async function update(patch: SceneUpdate) {
    const { error } = await room.supabase
      .from("scenes")
      .update(patch)
      .eq("id", scene.id);
    if (error) toast.error(error.message);
  }

  return (
    <Panel title="Scene settings">
      <div className="space-y-3">
        <div>
          <Label htmlFor="mapUrl">Map image URL</Label>
          <div className="flex gap-1">
            <Input
              id="mapUrl"
              value={mapUrl}
              onChange={(e) => setMapUrl(e.target.value)}
              placeholder="https://…"
            />
            <Button
              size="sm"
              onClick={() => update({ map_url: mapUrl.trim() || null })}
            >
              Set
            </Button>
          </div>
        </div>

        <div>
          <Label htmlFor="gridSize">Grid size (px)</Label>
          <div className="flex gap-1">
            <Input
              id="gridSize"
              type="number"
              min={10}
              value={gridSize}
              onChange={(e) => setGridSize(e.target.value)}
            />
            <Button
              size="sm"
              onClick={() =>
                update({ grid_size: Math.max(10, Number(gridSize) || 70) })
              }
            >
              Set
            </Button>
          </div>
        </div>

        <div>
          <Label htmlFor="feetPerSquare">Feet per square</Label>
          <div className="flex gap-1">
            <Input
              id="feetPerSquare"
              type="number"
              min={1}
              value={feet}
              onChange={(e) => setFeet(e.target.value)}
            />
            <Button
              size="sm"
              onClick={() =>
                update({ feet_per_square: Math.max(1, Number(feet) || 5) })
              }
            >
              Set
            </Button>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={scene.grid_enabled}
            onChange={(e) => update({ grid_enabled: e.target.checked })}
          />
          Show grid
        </label>
        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={scene.snap_to_grid}
            onChange={(e) => update({ snap_to_grid: e.target.checked })}
          />
          Snap tokens to grid
        </label>
      </div>
    </Panel>
  );
}
