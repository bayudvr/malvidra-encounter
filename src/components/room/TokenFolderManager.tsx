"use client";

import { useState } from "react";

import { Button, Input, Label, Modal } from "@/components/ui";
import { useToast } from "@/components/toast";
import type { RoomStore } from "@/lib/room/useRoomState";
import type { AssetFolder } from "@/lib/room/types";

export function TokenFolderManager({ room, selected, onSelect }: {
  room: RoomStore;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<AssetFolder | "new" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const folders = room.assetFolders ?? [];
  const active = folders.find((folder) => folder.id === selected);
  const disabled = !room.room || room.loading || !!room.assetFoldersError || deleting;
  const counts = new Map<string, number>();
  for (const asset of room.assets) {
    const key = asset.folder_id ?? "unfiled";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  async function removeFolder(folder: AssetFolder) {
    if (deleting || !confirm(`Delete folder "${folder.name}"? Its tokens will move to Unfiled. Tokens on scenes will stay in place.`)) return;
    setDeleting(true);
    try {
      const { error } = await room.supabase.from("asset_folders")
        .delete().eq("id", folder.id).eq("room_id", folder.room_id).select("id").single();
      if (error) throw error;
      onSelect("unfiled");
      room.notifyAssetFoldersChanged();
      await room.reload();
    } catch {
      toast.error("Could not delete folder. Your tokens have been kept; try reloading.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mb-3 space-y-2 border-b border-neutral-800 pb-3">
      <Label htmlFor="tokenFolderFilter">Folder</Label>
      <select
        id="tokenFolderFilter"
        value={selected}
        disabled={disabled}
        onChange={(event) => onSelect(event.target.value)}
        className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm disabled:opacity-50"
      >
        <option value="all">All tokens ({room.assets.length})</option>
        <option value="unfiled">Unfiled ({counts.get("unfiled") ?? 0})</option>
        {folders.map((folder) => (
          <option key={folder.id} value={folder.id}>
            {folder.name} ({counts.get(folder.id) ?? 0})
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="secondary" disabled={disabled} onClick={() => setEditing("new")}>
          + Folder
        </Button>
        {active && (
          <>
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setEditing(active)}>Rename</Button>
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => removeFolder(active)}>
              {deleting ? "Deleting…" : "Delete folder"}
            </Button>
          </>
        )}
      </div>
      {room.assetFoldersError && (
        <p className="text-xs text-amber-300" role="status">{room.assetFoldersError}</p>
      )}
      {editing && room.room && (
        <FolderNameModal
          room={room}
          folder={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(id) => { onSelect(id); setEditing(null); }}
        />
      )}
    </div>
  );
}

function FolderNameModal({ room, folder, onClose, onSaved }: {
  room: RoomStore;
  folder: AssetFolder | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState(folder?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy || !room.room) return;
    setBusy(true);
    setError(null);
    try {
      const query = folder
        ? room.supabase.from("asset_folders").update({ name: trimmed }).eq("id", folder.id).eq("room_id", room.room.id)
        : room.supabase.from("asset_folders").insert({ room_id: room.room.id, name: trimmed });
      const { data, error: saveError } = await query.select("id").single();
      if (saveError) {
        setError(saveError.code === "23505" ? "A folder with this name already exists in this room." : "Could not save folder. Try again.");
        return;
      }
      room.notifyAssetFoldersChanged();
      await room.reload();
      onSaved(data.id);
    } catch {
      setError("Could not save folder. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={folder ? "Rename folder" : "New folder"} onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={submit} className="space-y-3">
        <Label htmlFor="tokenFolderName">Folder name</Label>
        <Input id="tokenFolderName" autoFocus required maxLength={80} value={name}
          disabled={busy} onChange={(event) => setName(event.target.value)} placeholder="e.g. Party, Monsters, NPCs" />
        {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
        <Button type="submit" size="sm" disabled={busy || !name.trim()} className="w-full">
          {busy ? "Saving…" : folder ? "Save folder" : "Create folder"}
        </Button>
      </form>
    </Modal>
  );
}
