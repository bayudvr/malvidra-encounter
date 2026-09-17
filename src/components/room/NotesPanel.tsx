"use client";

import { useEffect, useRef, useState } from "react";

import { useToast } from "@/components/toast";
import type { RoomStore } from "@/lib/room/useRoomState";

const AUTOSAVE_DELAY_MS = 1200;

// DM-only scratchpad: session prep to read from, or running notes typed during play and copied
// out to Obsidian afterwards. Self-contained fetch (own dm_notes row, not in useRoomState) —
// same reasoning as PlayerRequests: a DM-only side panel that isn't needed on every render.
export function NotesPanel({ room, isDM }: { room: RoomStore; isDM: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  // True whenever `content` has changed since the last successful save — drives the "Unsaved"
  // label. Plain state (not a ref) since it's read during render; refs can only be read from
  // effects/handlers.
  const [dirty, setDirty] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open || loaded || !isDM) return;
    const roomId = room.room?.id;
    if (!roomId) return;
    room.supabase
      .from("dm_notes")
      .select("content")
      .eq("room_id", roomId)
      .maybeSingle()
      .then(({ data }) => {
        setContent(data?.content ?? "");
        setLoaded(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loaded, isDM]);

  // Debounced autosave — upsert since room_id is the primary key (one row per room).
  useEffect(() => {
    if (!loaded || !dirty) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const roomId = room.room?.id;
      if (!roomId) return;
      setSaving(true);
      const { error } = await room.supabase
        .from("dm_notes")
        .upsert({ room_id: roomId, content, updated_at: new Date().toISOString() });
      setSaving(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      setDirty(false);
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, loaded, dirty]);

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(content);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy — select and copy manually");
    }
  }

  if (!isDM) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-neutral-700 bg-neutral-900/90 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
      >
        📝 Notes
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 flex h-96 w-80 flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl">
          <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Notes
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-neutral-600">
                {saving ? "Saving…" : loaded && dirty ? "Unsaved" : ""}
              </span>
              <button
                type="button"
                onClick={copyAll}
                disabled={!content}
                className="rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-neutral-500 hover:text-neutral-200"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          </div>
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setDirty(true);
            }}
            placeholder="Session prep, running notes… copy out to Obsidian whenever."
            className="flex-1 resize-none bg-neutral-950 p-3 text-xs text-neutral-100 focus:outline-none"
            autoFocus
          />
        </div>
      )}
    </div>
  );
}
