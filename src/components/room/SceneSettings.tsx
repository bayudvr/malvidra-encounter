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
  const [name, setName] = useState(scene.name);
  const [mapUrl, setMapUrl] = useState(scene.map_url ?? "");
  const [gridSize, setGridSize] = useState(String(scene.grid_size));
  const [feet, setFeet] = useState(String(scene.feet_per_square));
  const [spotlightNote, setSpotlightNote] = useState(scene.spotlight_note ?? "");

  useEffect(() => {
    setName(scene.name);
    setMapUrl(scene.map_url ?? "");
    setGridSize(String(scene.grid_size));
    setFeet(String(scene.feet_per_square));
    setSpotlightNote(scene.spotlight_note ?? "");
  }, [
    scene.id,
    scene.name,
    scene.map_url,
    scene.grid_size,
    scene.feet_per_square,
    scene.spotlight_note,
  ]);

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
          <Label htmlFor="sceneName">Scene name</Label>
          <div className="flex gap-1">
            <Input
              id="sceneName"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button
              size="sm"
              onClick={() => {
                const trimmed = name.trim();
                if (trimmed) update({ name: trimmed });
                else setName(scene.name);
              }}
            >
              Set
            </Button>
          </div>
        </div>

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

        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="gridColor">Grid color</Label>
          <input
            id="gridColor"
            type="color"
            value={scene.grid_color}
            onChange={(e) => update({ grid_color: e.target.value })}
            className="h-7 w-10 cursor-pointer rounded border border-neutral-700 bg-neutral-950"
          />
        </div>

        <div>
          <Label htmlFor="gridOpacity">
            Grid opacity ({Math.round(scene.grid_opacity * 100)}%)
          </Label>
          <input
            id="gridOpacity"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={scene.grid_opacity}
            onChange={(e) => update({ grid_opacity: Number(e.target.value) })}
            className="w-full"
          />
        </div>

        <div>
          <Label htmlFor="gridThickness">
            Grid thickness ({scene.grid_thickness}px)
          </Label>
          <input
            id="gridThickness"
            type="range"
            min={0.5}
            max={5}
            step={0.5}
            value={scene.grid_thickness}
            onChange={(e) =>
              update({ grid_thickness: Number(e.target.value) })
            }
            className="w-full"
          />
        </div>

        <div className="space-y-3 border-t border-neutral-800 pt-3">
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={scene.fog_enabled}
              onChange={(e) => update({ fog_enabled: e.target.checked })}
            />
            Fog of war
          </label>

          {scene.fog_enabled && (
            <>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="fogColor">Fog color</Label>
                <input
                  id="fogColor"
                  type="color"
                  value={scene.fog_color}
                  onChange={(e) => update({ fog_color: e.target.value })}
                  className="h-7 w-10 cursor-pointer rounded border border-neutral-700 bg-neutral-950"
                />
              </div>

              <div>
                <Label htmlFor="fogDmOpacity">
                  Fog opacity for you ({Math.round(scene.fog_dm_opacity * 100)}%)
                </Label>
                <input
                  id="fogDmOpacity"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={scene.fog_dm_opacity}
                  onChange={(e) =>
                    update({ fog_dm_opacity: Number(e.target.value) })
                  }
                  className="w-full"
                />
                <p className="text-[10px] text-neutral-500">
                  Players always see hidden cells as fully solid — this only
                  controls how much you can see through them.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="space-y-2 border-t border-neutral-800 pt-3">
          <Label htmlFor="spotlightUser">
            Spotlight (waiting on) — shown to everyone, outside combat too
          </Label>
          <select
            id="spotlightUser"
            value={scene.spotlight_user_id ?? ""}
            onChange={(e) =>
              update({ spotlight_user_id: e.target.value || null })
            }
            className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm"
          >
            <option value="">No one picked</option>
            {room.members
              .filter((m) => m.role === "player")
              .map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.display_name}
                </option>
              ))}
          </select>
          <div className="flex gap-1">
            <Input
              value={spotlightNote}
              onChange={(e) => setSpotlightNote(e.target.value)}
              placeholder='Optional note (e.g. "which door?")'
            />
            <Button
              size="sm"
              onClick={() =>
                update({ spotlight_note: spotlightNote.trim() || null })
              }
            >
              Set
            </Button>
          </div>
          {(scene.spotlight_user_id || scene.spotlight_note) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSpotlightNote("");
                update({ spotlight_user_id: null, spotlight_note: null });
              }}
            >
              Clear spotlight
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}
