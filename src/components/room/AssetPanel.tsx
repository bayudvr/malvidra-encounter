"use client";

import { useState } from "react";

import { Button, Input, Panel } from "@/components/ui";
import { useToast } from "@/components/toast";
import type { RoomStore } from "@/lib/room/useRoomState";
import type { Asset } from "@/lib/room/types";
import { colorFromString, tokenInitials } from "@/lib/utils";

export function AssetPanel({ room }: { room: RoomStore }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const scene = room.activeScene;

  async function addAsset(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const { error } = await room.supabase.from("assets").insert({
      room_id: room.room!.id,
      name: name.trim(),
      image_url: url.trim() || null,
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

  // Changing the library image also pushes it onto every token already
  // dropped from this asset — tokens copy image_url at drop time instead of
  // referencing the asset live, so without this a re-skin would only affect
  // future drops.
  async function updateAssetImage(id: string, newUrl: string) {
    const trimmed = newUrl.trim() || null;
    const { error } = await room.supabase
      .from("assets")
      .update({ image_url: trimmed })
      .eq("id", id);
    if (error) return toast.error(error.message);
    const { error: tokenError } = await room.supabase
      .from("tokens")
      .update({ image_url: trimmed })
      .eq("asset_id", id);
    if (tokenError) toast.error(tokenError.message);
    room.reload();
    room.reloadScene();
  }

  async function dropToScene(
    assetId: string,
    label: string,
    imageUrl: string | null,
  ) {
    if (!scene) return toast.error("Open a scene first");
    const g = scene.grid_size;
    // Center of cell (2,2) so a freshly-dropped token already sits neatly
    // inside a square instead of straddling grid lines. Starts hidden so the
    // DM can position/adjust it before revealing it to players — same as a
    // token dragged straight onto the map.
    const { error } = await room.supabase.from("tokens").insert({
      scene_id: scene.id,
      room_id: room.room!.id,
      asset_id: assetId,
      label,
      image_url: imageUrl,
      x: g * 2 + g / 2,
      y: g * 2 + g / 2,
      is_hidden: true,
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
            onImageChange={(newUrl) => updateAssetImage(a.id, newUrl)}
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
          placeholder="Image URL (optional)"
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
  onImageChange,
  onDrop,
  onDelete,
}: {
  asset: Asset;
  canDrop: boolean;
  onRename: (name: string) => void;
  onImageChange: (url: string) => void;
  onDrop: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(asset.name);
  const [imageUrl, setImageUrl] = useState(asset.image_url ?? "");

  // Drag the portrait onto the map to place a token where the cursor lands.
  const dragProps = {
    draggable: canDrop,
    title: canDrop ? "Drag onto the map" : undefined,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(
        "application/x-mv-asset",
        JSON.stringify({
          assetId: asset.id,
          label: asset.name,
          imageUrl: asset.image_url,
        }),
      );
      e.dataTransfer.effectAllowed = "copy";
    },
  };

  return (
    <li className="space-y-1 rounded px-1 py-1 text-sm hover:bg-neutral-800/50">
      <div className="flex items-center gap-2">
        {asset.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            {...dragProps}
            src={asset.image_url}
            alt=""
            className={`h-7 w-7 shrink-0 rounded-full object-cover ${
              canDrop ? "cursor-grab active:cursor-grabbing" : ""
            }`}
          />
        ) : (
          <span
            {...dragProps}
            style={{ background: colorFromString(asset.name) }}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-neutral-950 ${
              canDrop ? "cursor-grab active:cursor-grabbing" : ""
            }`}
          >
            {tokenInitials(asset.name)}
          </span>
        )}
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
      </div>
      <input
        value={imageUrl}
        onChange={(e) => setImageUrl(e.target.value)}
        onBlur={() => imageUrl !== (asset.image_url ?? "") && onImageChange(imageUrl)}
        placeholder="Image URL (optional)"
        className="ml-9 w-[calc(100%-2.25rem)] truncate rounded bg-transparent px-1 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 focus:bg-neutral-800 focus:text-neutral-200 focus:outline-none"
      />
    </li>
  );
}
