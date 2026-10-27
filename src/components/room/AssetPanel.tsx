"use client";

import { useState } from "react";

import { Button, Input, Label, Modal, Panel } from "@/components/ui";
import { useToast } from "@/components/toast";
import { ImageUploadButton } from "@/components/room/ImageUploadButton";
import { TokenFolderManager } from "@/components/room/TokenFolderManager";
import type { RoomStore } from "@/lib/room/useRoomState";
import type { Asset, AssetFolder } from "@/lib/room/types";
import { colorFromString, tokenInitials } from "@/lib/utils";

export function AssetPanel({ room }: { room: RoomStore }) {
  const toast = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [folderFilter, setFolderFilter] = useState("all");
  const [search, setSearch] = useState("");
  const scene = room.activeScene;
  const folders = room.assetFolders ?? [];
  const selectedFolder = folderFilter === "all" || folderFilter === "unfiled" || folders.some((folder) => folder.id === folderFilter)
    ? folderFilter : "unfiled";
  const visibleAssets = room.assets.filter((asset) =>
    (selectedFolder === "all" || (selectedFolder === "unfiled" ? !asset.folder_id : asset.folder_id === selectedFolder)) &&
    asset.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  async function createAsset(values: {
    name: string;
    imageUrl: string;
    hp: number;
    ac: number;
    carryState: boolean;
    folderId: string | null;
  }) {
    if (!room.room) return;
    const { error } = await room.supabase.from("assets").insert({
      room_id: room.room!.id,
      name: values.name.trim(),
      image_url: values.imageUrl.trim() || null,
      hp: values.hp,
      ac: values.ac,
      carry_state: values.carryState,
      ...(values.folderId ? { folder_id: values.folderId } : {}),
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
    if (error) {
      toast.error(error.message);
      return false;
    }
    const { error: tokenError } = await room.supabase
      .from("tokens")
      .update({ image_url: trimmed })
      .eq("asset_id", id);
    if (tokenError) toast.error(tokenError.message);
    room.reload();
    room.reloadScene();
    return true;
  }

  // The server snapshots the newest cross-scene state in ONE transaction:
  // token + combat stats + per-token counters. Fresh NPCs still use defaults.
  async function dropToScene(asset: Asset) {
    if (!scene) return toast.error("Open a scene first");
    const g = scene.grid_size;
    const { error } = await room.supabase.rpc("spawn_asset_token", {
      p_scene: scene.id,
      p_asset: asset.id,
      p_x: g * 2 + g / 2,
      p_y: g * 2 + g / 2,
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

  // Default owner for tokens dropped from this asset from now on — tokens
  // already on a scene keep whatever owner they have (reassign those from
  // the token inspector), same snapshot rule as hp/ac above.
  async function updateAssetOwner(id: string, ownerUserId: string | null) {
    const asset = room.assets.find((a) => a.id === id);
    const enableOnFirstAssignment = !!ownerUserId && !asset?.owner_user_id;
    const { error } = await room.supabase
      .from("assets")
      .update({
        owner_user_id: ownerUserId,
        ...(enableOnFirstAssignment ? { carry_state: true } : {}),
      })
      .eq("id", id);
    if (error) toast.error(error.message);
    room.reload();
  }

  async function updateAssetCarryState(id: string, enabled: boolean) {
    const { error } = await room.supabase
      .from("assets")
      .update({ carry_state: enabled })
      .eq("id", id);
    if (error) toast.error(error.message);
    else room.reload();
  }

  async function moveAsset(id: string, folderId: string | null) {
    const { error } = await room.supabase.from("assets").update({ folder_id: folderId }).eq("id", id);
    if (error) toast.error("Could not move token. Try reloading the library.");
    await room.reload();
  }

  const players = room.members.filter((m) => m.role === "player");

  return (
    <Panel title="Token library">
      <TokenFolderManager room={room} selected={selectedFolder} onSelect={setFolderFilter} />
      <Input
        aria-label="Search tokens"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search tokens…"
        className="mb-2"
      />
      <ul className="space-y-1">
        {visibleAssets.map((a) => (
          <AssetRow
            key={a.id}
            asset={a}
            canDrop={!!scene}
            players={players}
            folders={folders}
            foldersDisabled={!!room.assetFoldersError || room.loading}
            onFolderChange={(folderId) => moveAsset(a.id, folderId)}
            onRename={(newName) => renameAsset(a.id, newName)}
            onImageChange={(newUrl) => updateAssetImage(a.id, newUrl)}
            onStatsChange={(hp, ac) => updateAssetStats(a.id, hp, ac)}
            onOwnerChange={(ownerUserId) => updateAssetOwner(a.id, ownerUserId)}
            onCarryStateChange={(enabled) => updateAssetCarryState(a.id, enabled)}
            onDrop={() => dropToScene(a)}
            onDelete={() => deleteAsset(a.id)}
          />
        ))}
        {visibleAssets.length === 0 && (
          <li className="px-1 py-1 text-xs text-neutral-500">
            {room.assets.length === 0 ? "No tokens yet. Add one below." : search.trim() ? "No matching tokens." : "This folder is empty."}
          </li>
        )}
      </ul>

      <Button
        size="sm"
        variant="secondary"
        className="mt-3 w-full"
        disabled={!room.room}
        onClick={() => setShowCreate(true)}
      >
        + New token
      </Button>

      {showCreate && room.room && (
        <CreateAssetModal
          roomId={room.room.id}
          folders={folders}
          foldersDisabled={!!room.assetFoldersError}
          initialFolderId={selectedFolder === "all" || selectedFolder === "unfiled" ? null : selectedFolder}
          onClose={() => setShowCreate(false)}
          onCreate={createAsset}
        />
      )}
    </Panel>
  );
}

function CreateAssetModal({
  roomId,
  folders,
  foldersDisabled,
  initialFolderId,
  onClose,
  onCreate,
}: {
  roomId: string;
  folders: AssetFolder[];
  foldersDisabled: boolean;
  initialFolderId: string | null;
  onClose: () => void;
  onCreate: (values: {
    name: string;
    imageUrl: string;
    hp: number;
    ac: number;
    carryState: boolean;
    folderId: string | null;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [folderId, setFolderId] = useState(initialFolderId);
  // Default 1, not blank — a value to overwrite beats an empty field, and it
  // means a token dropped without a second thought still has *something* on
  // its combatant sheet when combat starts, instead of null HP/AC.
  const [hp, setHp] = useState(1);
  const [ac, setAc] = useState(1);
  const [carryState, setCarryState] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || uploading) return;
    onCreate({ name, imageUrl, hp, ac, carryState, folderId });
  }

  return (
    <Modal title="New token" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label htmlFor="newTokenFolder">Folder</Label>
          <select id="newTokenFolder" value={folderId ?? ""} disabled={foldersDisabled}
            onChange={(event) => setFolderId(event.target.value || null)}
            className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm">
            <option value="">Unfiled</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
        </div>
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
            disabled={uploading}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://…"
          />
          <div className="mt-2">
            <ImageUploadButton
              roomId={roomId}
              onBusyChange={setUploading}
              onUploaded={setImageUrl}
            />
          </div>
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
        <label className="flex items-center gap-2 text-xs text-neutral-300">
          <input
            type="checkbox"
            checked={carryState}
            onChange={(e) => setCarryState(e.target.checked)}
          />
          Continue latest state between scenes
        </label>
        <p className="text-xs text-neutral-500">
          New tokens use these starting stats unless continuity is enabled.
          Turn it on for persistent characters and off for repeatable monsters.
        </p>
        <Button type="submit" size="sm" className="w-full" disabled={uploading}>
          Add to library
        </Button>
      </form>
    </Modal>
  );
}

function AssetRow({
  asset,
  folders,
  foldersDisabled,
  onFolderChange,
  canDrop,
  players,
  onRename,
  onImageChange,
  onStatsChange,
  onOwnerChange,
  onCarryStateChange,
  onDrop,
  onDelete,
}: {
  asset: Asset;
  folders: AssetFolder[];
  foldersDisabled: boolean;
  onFolderChange: (id: string | null) => Promise<void>;
  canDrop: boolean;
  players: RoomStore["members"];
  onRename: (name: string) => void;
  onImageChange: (url: string) => Promise<boolean>;
  onStatsChange: (hp: number, ac: number) => void;
  onOwnerChange: (ownerUserId: string | null) => void;
  onCarryStateChange: (enabled: boolean) => void;
  onDrop: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(asset.name);
  const [imageUrl, setImageUrl] = useState(asset.image_url ?? "");
  const [uploading, setUploading] = useState(false);
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
        disabled={uploading}
        onChange={(e) => setImageUrl(e.target.value)}
        onBlur={() => imageUrl !== (asset.image_url ?? "") && onImageChange(imageUrl)}
        placeholder="Image URL (optional)"
        className="ml-9 w-[calc(100%-2.25rem)] truncate rounded bg-transparent px-1 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 focus:bg-neutral-800 focus:text-neutral-200 focus:outline-none"
      />
      <div className="ml-9">
        <ImageUploadButton
          roomId={asset.room_id}
          onBusyChange={setUploading}
          onUploaded={async (url) => {
            if (!await onImageChange(url)) {
              throw new Error("Image uploaded, but the token could not be saved. Try again.");
            }
            setImageUrl(url);
          }}
        />
      </div>
      <select
        aria-label={`Folder for ${asset.name}`}
        value={asset.folder_id ?? ""}
        disabled={foldersDisabled}
        onChange={(event) => onFolderChange(event.target.value || null)}
        className="ml-9 w-[calc(100%-2.25rem)] rounded border border-neutral-800 bg-neutral-950 px-1 py-1 text-xs text-neutral-400 disabled:opacity-50"
      >
        <option value="">Unfiled</option>
        {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
      </select>
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
      <select
        value={asset.owner_user_id ?? ""}
        onChange={(e) => onOwnerChange(e.target.value || null)}
        aria-label="Owner"
        className="ml-9 w-[calc(100%-2.25rem)] rounded bg-transparent px-1 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 focus:bg-neutral-800 focus:text-neutral-200 focus:outline-none"
      >
        <option value="">Owner: unassigned</option>
        {players.map((p) => (
          <option key={p.user_id} value={p.user_id}>
            Owner: {p.display_name}
          </option>
        ))}
      </select>
      <label className="ml-9 flex items-center gap-2 text-[11px] text-neutral-400">
        <input
          type="checkbox"
          checked={asset.carry_state}
          onChange={(e) => onCarryStateChange(e.target.checked)}
        />
        Continue latest state between scenes
      </label>
    </li>
  );
}
