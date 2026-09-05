"use client";

import { useEffect, useState } from "react";

import { useToast } from "@/components/toast";
import type { RoomStore } from "@/lib/room/useRoomState";
import type { PlayerRequest } from "@/lib/room/types";

// Player -> DM attention requests: the reverse of scene spotlight (DM ->
// player). Self-contained data fetch + its own realtime channel, same
// pattern as DiceTray's shared roll log, rather than growing useRoomState.
export function PlayerRequests({
  room,
  isDM,
}: {
  room: RoomStore;
  isDM: boolean;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<PlayerRequest[]>([]);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const roomId = room.room?.id;
    if (!roomId) return;
    let active = true;

    room.supabase
      .from("player_requests")
      .select("*")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (active && data) setRows(data as PlayerRequest[]);
      });

    const channel = room.supabase
      .channel(`requests:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "player_requests",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as { id: string }).id;
            setRows((r) => r.filter((x) => x.id !== oldId));
            return;
          }
          const row = payload.new as PlayerRequest;
          setRows((r) => (r.some((x) => x.id === row.id) ? r : [...r, row]));
        },
      )
      .subscribe();

    return () => {
      active = false;
      room.supabase.removeChannel(channel);
    };
  }, [room.room?.id, room.supabase]);

  async function send() {
    if (sending) return;
    setSending(true);
    const { error } = await room.supabase.from("player_requests").insert({
      room_id: room.room!.id,
      user_id: room.userId,
      note: note.trim() || null,
    });
    setSending(false);
    if (error) return toast.error(error.message);
    setNote("");
    setOpen(false);
    toast.success("Sent to the DM");
  }

  async function dismiss(id: string) {
    setRows((r) => r.filter((x) => x.id !== id));
    const { error } = await room.supabase
      .from("player_requests")
      .delete()
      .eq("id", id);
    if (error) toast.error(error.message);
  }

  if (isDM) {
    if (rows.length === 0) return null;
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-200 hover:bg-amber-500/20"
        >
          🙋 {rows.length}
        </button>
        {open && (
          <div className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 text-xs shadow-xl">
            <ul className="max-h-64 divide-y divide-neutral-800 overflow-y-auto">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="flex items-start justify-between gap-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-neutral-200">
                      {room.members.find((m) => m.user_id === r.user_id)
                        ?.display_name ?? "Player"}
                    </div>
                    {r.note && (
                      <div className="truncate text-neutral-400">{r.note}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => dismiss(r.id)}
                    className="shrink-0 text-neutral-500 hover:text-red-400"
                    aria-label="Dismiss"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-neutral-700 bg-neutral-900/90 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
      >
        🙋 Request DM
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-neutral-700 bg-neutral-900 p-2 text-xs shadow-xl">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder='Optional note (e.g. "ready to act")'
            rows={2}
            className="mb-2 w-full resize-none rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-100 focus:outline-none"
          />
          <button
            type="button"
            onClick={send}
            disabled={sending}
            className="w-full rounded bg-amber-500 py-1 font-semibold text-neutral-950 hover:bg-amber-400 disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      )}
    </div>
  );
}
