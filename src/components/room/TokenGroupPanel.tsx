"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Input, Panel } from "@/components/ui";
import { useToast } from "@/components/toast";
import type { RoomStore } from "@/lib/room/useRoomState";
import type { Database } from "@/lib/database.types";

type Group = Database["public"]["Tables"]["token_groups"]["Row"];
type Item = Database["public"]["Tables"]["token_group_items"]["Row"];

export function TokenGroupPanel({ room }: { room: RoomStore }) {
  const toast = useToast();
  const [groups, setGroups] = useState<Group[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [newName, setNewName] = useState("");
  const [assetId, setAssetId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roomId = room.room?.id ?? "";

  const refresh = useCallback(async () => {
    if (!roomId) return;
    const [g, i] = await Promise.all([
      room.supabase.from("token_groups").select("*").eq("room_id", roomId).order("created_at"),
      room.supabase.from("token_group_items").select("*").eq("room_id", roomId).order("sort_order"),
    ]);
    const failure = g.error ?? i.error;
    if (failure) {
      setError("Token groups are unavailable. Apply the group migration before using this feature.");
      return;
    }
    setError(null);
    setGroups(g.data ?? []);
    setItems(i.data ?? []);
    setSelectedId((old) => (g.data ?? []).some((item) => item.id === old) ? old : (g.data?.[0]?.id ?? ""));
  }, [roomId, room.supabase]);

  useEffect(() => { void refresh(); }, [refresh]);
  const selected = groups.find((g) => g.id === selectedId);
  const groupItems = items.filter((item) => item.group_id === selectedId);
  const total = groupItems.reduce((n, item) => n + item.quantity, 0);
  const availableAssets = room.assets.filter((asset) => !groupItems.some((item) => item.asset_id === asset.id));

  async function createGroup(event: React.FormEvent) {
    event.preventDefault();
    if (!roomId || !newName.trim() || busy) return;
    setBusy(true);
    const { data, error: failure } = await room.supabase.from("token_groups").insert({
      room_id: roomId,
      name: newName.trim(),
    }).select("*").single();
    setBusy(false);
    if (failure || !data) return toast.error(failure?.message ?? "Could not save group");
    setNewName("");
    await refresh();
    setSelectedId(data.id);
  }

  async function addItem() {
    if (!selected || !assetId || busy || !Number.isInteger(quantity) || quantity < 1 || total + quantity > 60) {
      toast.error("Choose a token and keep the group at 60 instances or fewer");
      return;
    }
    setBusy(true);
    const { error: failure } = await room.supabase.from("token_group_items").insert({
      room_id: selected.room_id,
      group_id: selected.id,
      asset_id: assetId,
      quantity,
      sort_order: groupItems.length,
    });
    setBusy(false);
    if (failure) return toast.error(failure.message);
    setAssetId("");
    setQuantity(1);
    await refresh();
  }

  async function updateQuantity(item: Item, next: number) {
    if (!Number.isInteger(next) || next < 1 || next > 40 || total - item.quantity + next > 60) {
      toast.error("Each token: 1–40; group total: 60 maximum");
      return;
    }
    const { error: failure } = await room.supabase.from("token_group_items").update({ quantity: next }).eq("id", item.id);
    if (failure) toast.error(failure.message);
    await refresh();
  }

  async function removeItem(id: string) {
    const { error: failure } = await room.supabase.from("token_group_items").delete().eq("id", id);
    if (failure) toast.error(failure.message);
    await refresh();
  }

  async function deleteGroup() {
    if (!selected || !window.confirm(`Delete preset "${selected.name}"? Tokens already placed stay in their scenes.`)) return;
    const { error: failure } = await room.supabase.from("token_groups").delete().eq("id", selected.id);
    if (failure) toast.error(failure.message);
    await refresh();
  }

  async function deploy() {
    if (!selected || !room.activeScene || busy) return;
    if (!window.confirm(`Place ${total} hidden tokens from "${selected.name}" in ${room.activeScene.name}?`)) return;
    setBusy(true);
    const { data, error: failure } = await room.supabase.rpc("deploy_token_group", {
      p_group: selected.id,
      p_scene: room.activeScene.id,
    });
    setBusy(false);
    if (failure) return toast.error(failure.message);
    toast.success(`Placed ${data} hidden tokens in ${room.activeScene.name}`);
    room.reloadScene();
  }

  return (
    <Panel title="Party & Encounter Presets">
      <p className="mb-2 text-xs text-neutral-400">
        Save reusable token rosters with quantities. Deploy all tokens hidden, then position and reveal them on the map.
      </p>
      {error && <p role="alert" className="mb-2 text-xs text-red-300">{error}</p>}
      <form className="mb-3 flex gap-1" onSubmit={(e) => void createGroup(e)}>
        <Input value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} placeholder="Party / Goblin Ambush" aria-label="New group name" />
        <Button type="submit" size="sm" disabled={busy || !newName.trim()}>Save</Button>
      </form>
      {groups.length > 0 && (
        <>
          <label className="mb-2 block text-xs text-neutral-400">
            Saved group
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-sm text-neutral-100">
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          <ul className="mb-2 space-y-1">
            {groupItems.map((item) => (
              <li key={item.id} className="flex items-center gap-1 rounded bg-neutral-900 p-1.5 text-xs">
                <span className="flex-1 truncate">{room.assets.find((a) => a.id === item.asset_id)?.name ?? "Missing token"}</span>
                <input type="number" min={1} max={40} defaultValue={item.quantity} key={`${item.id}:${item.quantity}`}
                  aria-label="Quantity" className="w-12 rounded border border-neutral-700 bg-neutral-950 p-1 text-center"
                  onBlur={(e) => { const next = Number(e.target.value); if (next !== item.quantity) void updateQuantity(item, next); }}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
                <button type="button" className="px-2 text-red-300" aria-label="Remove token from group" onClick={() => void removeItem(item.id)}>×</button>
              </li>
            ))}
          </ul>
          <div className="mb-2 flex gap-1">
            <select aria-label="Add token to group" value={assetId} onChange={(e) => setAssetId(e.target.value)}
              className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-1 text-xs">
              <option value="">Choose token…</option>
              {availableAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
            </select>
            <input aria-label="Count to add" type="number" min={1} max={40} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}
              className="w-12 rounded border border-neutral-700 bg-neutral-900 p-1 text-center text-xs" />
            <Button size="sm" onClick={() => void addItem()} disabled={busy || !assetId}>Add</Button>
          </div>
          <p className="mb-2 text-xs text-neutral-500">{total} token instances in this preset, maximum 60.</p>
          <Button className="w-full" onClick={() => void deploy()} disabled={busy || !room.activeScene || total === 0}>
            {busy ? "Working…" : `Deploy ${total} to Scene (hidden)`}
          </Button>
          <button type="button" onClick={() => void deleteGroup()} className="mt-2 w-full text-xs text-red-400 hover:text-red-300">Delete preset</button>
        </>
      )}
    </Panel>
  );
}
