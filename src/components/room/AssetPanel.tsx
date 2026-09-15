"use client";

import { useState } from "react";

import { Button, Input, Label, Modal, Panel } from "@/components/ui";
import { useToast } from "@/components/toast";
import type { RoomStore } from "@/lib/room/useRoomState";
import type { Asset } from "@/lib/room/types";
import { colorFromString, tokenInitials } from "@/lib/utils";

export function AssetPanel({ room }: { room: RoomStore }) {
  const toast = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const scene = room.activeScene;

  async function createAsset(values: {
    name: string;
    imageUrl: string;
    hp: number;
    ac: number;
  }) {
    const { error } = await room.supabase.from("assets").insert({
      room_id: room.room!.id,
      name: values.name.trim(),
      image_url: values.imageUrl.trim() || null,
      hp: values.hp,
      ac: values.ac,
    });
    if (error) return toast.error(error.message);
    setShowCreate(false);
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

  // hp/ac copy from the asset at drop time — same "snapshot, not a live
  // reference" pattern image_url already uses (see updateAssetImage) — so a
  // later edit to the library entry doesn't retroactively change a token
  // already placed (and already possibly tweaked) on a scene.
  async function dropToScene(asset: Asset) {
    if (!scene) return toast.error("Open a scene first");
    const g = scene.grid_size;
    // Center of cell (2,2) so a freshly-dropped token already sits neatly
    // inside a square instead of straddling grid lines. Starts hidden so the
    // DM can position/adjust it before revealing it to players — same as a
    // token dragged straight onto the map.
    const { error } = await room.supabase.from("tokens").insert({
      scene_id: scene.id,
      room_id: room.room!.id,
      asset_id: asset.id,
      label: asset.name,
      image_url: asset.image_url,
      x: g * 2 + g / 2,
      y: g * 2 + g / 2,
      is_hidden: true,
      hp: asset.hp,
      ac: asset.ac,
    });
    if (error) toast.error(error.message);
    else room.reloadScene();
  }

  async function updateAssetStats(id: string, hp: number, ac: number) {
    const { error } = await room.supabase
      .from("assets")
      .update({ hp, ac })
      .eq("id", id);
    if (error) toast.error(error.message);
    room.reload();
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
            onStatsChange={(hp, ac) => updateAssetStats(a.id, hp, ac)}
            onDrop={() => dropToScene(a)}
            onDelete={() => deleteAsset(a.id)}
          />
        ))}
        {room.assets.length === 0 && (
          <li className="px-1 py-1 text-xs text-neutral-500">
            No tokens yet. Add one below.
          </li>
        )}
      </ul>

      <Button
        size="sm"
        variant="secondary"
        className="mt-3 w-full"
        onClick={() => setShowCreate(true)}
      >
        + New token
      </Button>

      {showCreate && (
        <CreateAssetModal
          onClose={() => setShowCreate(false)}
          onCreate={createAsset}
        />
      )}
    </Panel>
  );
}

function CreateAssetModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (values: {
    name: string;
    imageUrl: string;
    hp: number;
    ac: number;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  // Default 1, not blank — a value to overwrite beats an empty field, and it
  // means a token dropped without a second thought still has *something* on
  // its combatant sheet when combat starts, instead of null HP/AC.
  const [hp, setHp] = useState(1);
  const [ac, setAc] = useState(1);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate({ name, imageUrl, hp, ac });
  }

  return (
    <Modal title="New token" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label>Name</Label>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Goblin"
          />
        </div>
        <div>
          <Label>Image URL (optional)</Label>
          <Input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://…"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>HP</Label>
            <Input
              type="number"
              value={hp}
              onChange={(e) => setHp(Number(e.target.value))}
            />
          </div>
          <div>
            <Label>AC</Label>
            <Input
              type="number"
              value={ac}
              onChange={(e) => setAc(Number(e.target.value))}
            />
          </div>
        </div>
        <p className="text-xs text-neutral-500">
          Used as this token&apos;s starting HP/AC when it&apos;s added to
          combat — edit anytime, per token too.
        </p>
        <Button type="submit" size="sm" className="w-full">
          Add to library
        </Button>
      </form>
    </Modal>
  );
}

function AssetRow({
  asset,
  canDrop,
  onRename,
  onImageChange,
  onStatsChange,
  onDrop,
  onDelete,
}: {
  asset: Asset;
  canDrop: boolean;
  onRename: (name: string) => void;
  onImageChange: (url: string) => void;
  onStatsChange: (hp: number, ac: number) => void;
  onDrop: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(asset.name);
  const [imageUrl, setImageUrl] = useState(asset.image_url ?? "");
  const [hp, setHp] = useState(asset.hp);
  const [ac, setAc] = useState(asset.ac);

  // Drag the portrait onto the map to place a token where the cursor lands.
  // Carries hp/ac too — SceneCanvas's drop handler looks the asset up from
  // room.assets by id instead, this is just the fields it needs synchronously
  // from the drag event itself (label/image for the ghost/preview).
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
      <div className="ml-9 flex w-[calc(100%-2.25rem)] items-center gap-3 text-xs text-neutral-400">
        <label className="flex items-center gap-1">
          HP
          <input
            type="number"
            value={hp}
            onChange={(e) => setHp(Number(e.target.value))}
            onBlur={() =>
              (hp !== asset.hp || ac !== asset.ac) && onStatsChange(hp, ac)
            }
            className="w-12 rounded bg-transparent px-1 py-0.5 hover:bg-neutral-800 focus:bg-neutral-800 focus:text-neutral-200 focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-1">
          AC
          <input
            type="number"
            value={ac}
            onChange={(e) => setAc(Number(e.target.value))}
            onBlur={() =>
              (hp !== asset.hp || ac !== asset.ac) && onStatsChange(hp, ac)
            }
            className="w-12 rounded bg-transparent px-1 py-0.5 hover:bg-neutral-800 focus:bg-neutral-800 focus:text-neutral-200 focus:outline-none"
          />
        </label>
      </div>
    </li>
  );
}
