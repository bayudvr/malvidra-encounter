"use client";

import { useState } from "react";

import { Button, Input, Panel } from "@/components/ui";
import { useToast } from "@/components/toast";
import type { RoomStore } from "@/lib/room/useRoomState";
import type { Asset } from "@/lib/room/types";

export function AssetPanel({ room }: { room: RoomStore }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const scene = room.activeScene;

  async function addAsset(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !url.trim()) return;
    const { error } = await room.supabase.from("assets").insert({
      room_id: room.room!.id,
      name: name.trim(),
      image_url: url.trim(),
    });
    if (error) return toast.error(error.message);
    setName("");
    setUrl("");
    room.reload();
  }

  async function deleteAsset(id: string) {
    const { error } = await room.supabase.from("assets").delete().eq("id", id);
    if (error) toast.error(error.message);
    room.reload();
  }

  async function renameAsset(id: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const { error } = await room.supabase
      .from("assets")
      .update({ name: trimmed })
      .eq("id", id);
    if (error) toast.error(error.message);
    else room.reload();
  }

  async function dropToScene(assetId: string, label: string, imageUrl: string) {
    if (!scene) return toast.error("Open a scene first");
    const g = scene.grid_size;
    // Center of cell (2,2) so a freshly-dropped token already sits neatly
    // inside a square instead of straddling grid lines.
    const { error } = await room.supabase.from("tokens").insert({
      scene_id: scene.id,
      room_id: room.room!.id,
      asset_id: assetId,
      label,
      image_url: imageUrl,
      x: g * 2 + g / 2,
      y: g * 2 + g / 2,
    });
    if (error) toast.error(error.message);
    else room.reloadScene();
  }

  return (
    <Panel title="Token library">
      <ul className="space-y-1">
        {room.assets.map((a) => (
          <AssetRow
            key={a.id}
            asset={a}
            canDrop={!!scene}
            onRename={(newName) => renameAsset(a.id, newName)}
            onDrop={() => dropToScene(a.id, a.name, a.image_url)}
            onDelete={() => deleteAsset(a.id)}
          />
        ))}
        {room.assets.length === 0 && (
          <li className="px-1 py-1 text-xs text-neutral-500">
            No tokens yet. Add one below.
          </li>
        )}
      </ul>

      <form
        onSubmit={addAsset}
        className="mt-3 space-y-2 border-t border-neutral-800 pt-3"
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Token name (e.g. Goblin)"
        />
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Image URL"
        />
        <Button type="submit" size="sm" className="w-full">
          Add to library
        </Button>
      </form>
    </Panel>
  );
}

function AssetRow({
  asset,
  canDrop,
  onRename,
  onDrop,
  onDelete,
}: {
  asset: Asset;
  canDrop: boolean;
  onRename: (name: string) => void;
  onDrop: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(asset.name);

  return (
    <li className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-neutral-800/50">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={asset.image_url}
        alt=""
        className="h-7 w-7 shrink-0 rounded-full object-cover"
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => (name.trim() ? onRename(name) : setName(asset.name))}
        className="min-w-0 flex-1 truncate rounded bg-transparent px-1 py-0.5 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
      />
      <Button size="sm" variant="ghost" onClick={onDrop} disabled={!canDrop}>
        + Scene
      </Button>
      <button
        className="px-1 text-neutral-500 hover:text-red-400"
        onClick={onDelete}
        aria-label="Delete asset"
      >
        ✕
      </button>
    </li>
  );
}
