"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { Button, Input, Label, Panel } from "@/components/ui";
import { useToast } from "@/components/toast";
import type { RoomStore } from "@/lib/room/useRoomState";
import type { RoomCounter, RoomCounterUpdate } from "@/lib/room/types";

type Visibility = RoomCounter["visibility"];

// A counter belongs to a room, not a token or a particular scene.
// All reads go through Supabase RLS; the empty Realtime broadcast is just a
// refresh signal and must never contain private counter data.
export function RoomCountersPanel({
  room,
  isDM,
}: {
  room: RoomStore;
  isDM: boolean;
}) {
  const toast = useToast();
  const roomId = room.room?.id;
  const [counters, setCounters] = useState<RoomCounter[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newMax, setNewMax] = useState(0);
  const [newVisibility, setNewVisibility] = useState<Visibility>("private");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const reload = useCallback(async () => {
    if (!roomId) return;
    const { data, error: fetchError } = await room.supabase
      .from("room_counters")
      .select("*")
      .eq("room_id", roomId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (fetchError) {
      setError(fetchError.message);
      return;
    }
    setCounters(data ?? []);
    setError(null);
  }, [room.supabase, roomId]);

  useEffect(() => {
    if (!roomId) return;
    void reload();
    const channel = room.supabase
      .channel(`room-counters:${roomId}`)
      .on("broadcast", { event: "changed" }, () => void reload())
      .subscribe();
    channelRef.current = channel;

    // Catch missed broadcasts after reconnect/sleep without relying on
    // postgres_changes publication (important for private rows).
    const poll = setInterval(() => void reload(), 15000);
    return () => {
      clearInterval(poll);
      channelRef.current = null;
      void room.supabase.removeChannel(channel);
    };
  }, [roomId, room.supabase, reload]);

  async function notifyChanged() {
    await reload();
    // Broadcast no IDs, names, visibility, or values. RLS filters the fetch.
    if (channelRef.current) {
      void channelRef.current.send({
        type: "broadcast",
        event: "changed",
        payload: {},
      });
    }
  }

  async function createCounter(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    if (!isDM || !roomId || creating) return;
    if (!name || name.length > 120 || !Number.isInteger(newMax) || newMax < 0) {
      toast.error("Enter a name and a non-negative whole-number maximum");
      return;
    }
    setCreating(true);
    const { error: insertError } = await room.supabase.from("room_counters").insert({
      room_id: roomId,
      name,
      current: 0,
      max: newMax,
      visibility: newVisibility,
    });
    setCreating(false);
    if (insertError) return toast.error(insertError.message);
    setNewName("");
    setNewMax(0);
    setNewVisibility("private");
    setShowCreate(false);
    await notifyChanged();
  }

  async function updateCounter(id: string, values: RoomCounterUpdate): Promise<boolean> {
    if (!isDM || busyId) return false;
    setBusyId(id);
    const { error: updateError } = await room.supabase
      .from("room_counters")
      .update(values)
      .eq("id", id)
      .eq("room_id", roomId!);
    setBusyId(null);
    if (updateError) {
      toast.error(updateError.message);
      return false;
    }
    await notifyChanged();
    return true;
  }

  async function deleteCounter(id: string) {
    if (!isDM || busyId) return;
    if (!window.confirm("Delete this room counter?")) return;
    setBusyId(id);
    const { error: deleteError } = await room.supabase
      .from("room_counters")
      .delete()
      .eq("id", id)
      .eq("room_id", roomId!);
    setBusyId(null);
    if (deleteError) return toast.error(deleteError.message);
    await notifyChanged();
  }

  if (!isDM && counters.length === 0 && !error) return null;

  return (
    <Panel
      title="Room counters"
      action={isDM && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? "Cancel" : "+ Add"}
        </Button>
      )}
    >
      {error && (
        <p role="alert" className="mb-2 break-words text-xs text-red-400">
          Could not load counters: {error}
        </p>
      )}
      <div className="space-y-2">
        {counters.map((counter) => (
          <CounterRow
            key={counter.id}
            counter={counter}
            isDM={isDM}
            busy={busyId !== null}
            onUpdate={(values) => updateCounter(counter.id, values)}
            onDelete={() => deleteCounter(counter.id)}
          />
        ))}
      </div>

      {counters.length === 0 && !error && (
        <p className="text-xs text-neutral-500">
          No counters yet. Track party resources or house rules here.
        </p>
      )}

      {isDM && showCreate && (
        <form onSubmit={createCounter} className="mt-3 space-y-2 border-t border-neutral-800 pt-3">
          <div>
            <Label htmlFor="counter-new-name">Counter name</Label>
            <Input
              id="counter-new-name"
              autoFocus
              required
              maxLength={120}
              placeholder="e.g. Party Inspiration"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="counter-new-max">Max (0 = no limit)</Label>
              <Input
                id="counter-new-max"
                type="number"
                min={0}
                step={1}
                value={newMax}
                onChange={(e) => setNewMax(Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="counter-new-visibility">Visibility</Label>
              <select
                id="counter-new-visibility"
                value={newVisibility}
                onChange={(e) => setNewVisibility(e.target.value as Visibility)}
                className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-2 text-sm text-neutral-100"
              >
                <option value="private">🔒 Private (DM)</option>
                <option value="public">👁 Public (party)</option>
              </select>
            </div>
          </div>
          <Button type="submit" size="sm" disabled={creating || !newName.trim()}>
            {creating ? "Adding…" : "Create counter"}
          </Button>
        </form>
      )}
      {isDM && !showCreate && (
        <p className="mt-3 text-[11px] text-neutral-500">
          Private counters are only accessible by the DM. Public counters are read-only for players.
        </p>
      )}
    </Panel>
  );
}

function CounterRow({
  counter,
  isDM,
  busy,
  onUpdate,
  onDelete,
}: {
  counter: RoomCounter;
  isDM: boolean;
  busy: boolean;
  onUpdate: (values: RoomCounterUpdate) => Promise<boolean>;
  onDelete: () => Promise<void>;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(counter.name);
  const [max, setMax] = useState(counter.max);
  const [visibility, setVisibility] = useState<Visibility>(counter.visibility);

  useEffect(() => {
    if (!editing) {
      setName(counter.name);
      setMax(counter.max);
      setVisibility(counter.visibility);
    }
  }, [counter.name, counter.max, counter.visibility, editing]);

  const active = counter.max === 0
    ? String(counter.current)
    : `${counter.current} / ${counter.max}`;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 120 || !Number.isInteger(max) || max < 0) {
      toast.error("Invalid name or maximum");
      return;
    }
    const values: RoomCounterUpdate = {
      name: cleanName,
      max,
      visibility,
      current: max > 0 ? Math.min(counter.current, max) : counter.current,
    };
    if (await onUpdate(values)) setEditing(false);
  }

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950/60 p-2">
      {editing && isDM ? (
        <form onSubmit={save} className="space-y-2">
          <Input
            aria-label="Counter name"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              aria-label="Maximum value; zero means unlimited"
              type="number"
              min={0}
              step={1}
              value={max}
              onChange={(e) => setMax(Number(e.target.value))}
            />
            <select
              aria-label="Counter visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as Visibility)}
              className="min-w-0 rounded-md border border-neutral-700 bg-neutral-900 px-1 text-xs text-neutral-100"
            >
              <option value="private">🔒 Private</option>
              <option value="public">👁 Public</option>
            </select>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>Save</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" variant="danger" className="ml-auto" disabled={busy} onClick={onDelete}>
              Delete
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="break-words text-xs font-medium text-neutral-200">{counter.name}</div>
              {isDM && (
                <span className={counter.visibility === "private"
                  ? "text-[10px] text-violet-300"
                  : "text-[10px] text-sky-300"}
                >
                  {counter.visibility === "private" ? "🔒 Private" : "👁 Public"}
                </span>
              )}
            </div>
            {isDM && (
              <button
                type="button"
                className="shrink-0 text-xs text-neutral-400 hover:text-amber-300"
                aria-label={`Edit ${counter.name}`}
                onClick={() => setEditing(true)}
              >
                Edit
              </button>
            )}
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold tabular-nums text-amber-300" aria-live="polite">
              {active}
            </div>
            {isDM && (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="min-h-8 min-w-8 px-2"
                  aria-label={`Decrease ${counter.name}`}
                  disabled={busy || counter.current <= 0}
                  onClick={() => void onUpdate({ current: Math.max(0, counter.current - 1) })}
                >
                  −
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="min-h-8 min-w-8 px-2"
                  aria-label={`Increase ${counter.name}`}
                  disabled={busy || (counter.max > 0 && counter.current >= counter.max)}
                  onClick={() => void onUpdate({ current: counter.current + 1 })}
                >
                  +
                </Button>
                <button
                  type="button"
                  className="ml-1 text-[11px] text-neutral-500 hover:text-neutral-200 disabled:opacity-40"
                  disabled={busy || counter.current === 0}
                  onClick={() => void onUpdate({ current: 0 })}
                >
                  Reset
                </button>
              </div>
            )}
          </div>
          {counter.max > 0 && (
            <div
              aria-label={`${counter.current} of ${counter.max}`}
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-800"
            >
              <div
                className="h-full rounded-full bg-amber-500 transition-[width]"
                style={{ width: `${Math.min(100, (counter.current / counter.max) * 100)}%` }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
