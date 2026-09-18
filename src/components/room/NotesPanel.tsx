"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

import { useToast } from "@/components/toast";
import type { RoomStore } from "@/lib/room/useRoomState";
import type { DmNotes } from "@/lib/room/types";
import { FloatingPanel } from "@/components/room/FloatingPanel";

const AUTOSAVE_DELAY_MS = 1200;

// Rendered markdown, styled to read like Obsidian's preview rather than a wall of raw syntax —
// react-markdown maps each node type to one of these instead of its own (unstyled) defaults.
const markdownComponents: Components = {
  h1: (p) => <h1 className="mb-2 mt-3 text-base font-bold text-neutral-100 first:mt-0" {...p} />,
  h2: (p) => <h2 className="mb-2 mt-3 text-sm font-bold text-neutral-100 first:mt-0" {...p} />,
  h3: (p) => (
    <h3 className="mb-1 mt-2 text-sm font-semibold text-neutral-200 first:mt-0" {...p} />
  ),
  p: (p) => <p className="mb-2 leading-snug last:mb-0" {...p} />,
  ul: (p) => <ul className="mb-2 list-disc space-y-0.5 pl-4 last:mb-0" {...p} />,
  ol: (p) => <ol className="mb-2 list-decimal space-y-0.5 pl-4 last:mb-0" {...p} />,
  li: (p) => <li {...p} />,
  a: (p) => <a className="text-sky-400 underline" target="_blank" rel="noreferrer" {...p} />,
  code: (p) => <code className="rounded bg-neutral-800 px-1 py-0.5 text-[11px]" {...p} />,
  pre: (p) => (
    <pre className="mb-2 overflow-x-auto rounded bg-neutral-800 p-2 text-[11px] last:mb-0" {...p} />
  ),
  blockquote: (p) => (
    <blockquote
      className="mb-2 border-l-2 border-neutral-700 pl-2 text-neutral-400 last:mb-0"
      {...p}
    />
  ),
  hr: (p) => <hr className="my-2 border-neutral-800" {...p} />,
  strong: (p) => <strong className="font-semibold text-neutral-100" {...p} />,
  table: (p) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="border-collapse text-[11px]" {...p} />
    </div>
  ),
  th: (p) => <th className="border border-neutral-700 px-2 py-1 text-left" {...p} />,
  td: (p) => <td className="border border-neutral-700 px-2 py-1" {...p} />,
};

// DM-only scratchpad — a list of named notes per room (not one big blob), each rendered as
// markdown like Obsidian's own preview rather than raw syntax. Self-contained fetch, same
// reasoning as PlayerRequests/ReferencePanel: a DM-only side panel, not worth growing
// useRoomState for.
export function NotesPanel({ room, isDM }: { room: RoomStore; isDM: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [notes, setNotes] = useState<DmNotes[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open || loaded || !isDM) return;
    const roomId = room.room?.id;
    if (!roomId) return;
    room.supabase
      .from("dm_notes")
      .select("*")
      .eq("room_id", roomId)
      .order("updated_at", { ascending: false })
      .then(({ data }) => {
        const rows = (data as DmNotes[]) ?? [];
        setNotes(rows);
        setLoaded(true);
        if (rows.length > 0) select(rows[0]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loaded, isDM]);

  function select(note: DmNotes) {
    setSelectedId(note.id);
    setTitle(note.title);
    setContent(note.content);
    setDirty(false);
    setMode("preview");
  }

  async function createNote() {
    const roomId = room.room?.id;
    if (!roomId) return;
    const { data, error } = await room.supabase
      .from("dm_notes")
      .insert({ room_id: roomId, title: "Untitled", content: "" })
      .select()
      .single();
    if (error || !data) return toast.error(error?.message ?? "Couldn't create note");
    const note = data as DmNotes;
    setNotes((rows) => [note, ...rows]);
    select(note);
    setMode("edit");
  }

  async function removeNote(id: string) {
    setNotes((rows) => rows.filter((r) => r.id !== id));
    if (selectedId === id) setSelectedId(null);
    const { error } = await room.supabase.from("dm_notes").delete().eq("id", id);
    if (error) toast.error(error.message);
  }

  // Debounced autosave for whichever note is currently selected.
  useEffect(() => {
    if (!dirty || !selectedId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      const updated_at = new Date().toISOString();
      const { error } = await room.supabase
        .from("dm_notes")
        .update({ title, content, updated_at })
        .eq("id", selectedId);
      setSaving(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      setDirty(false);
      setNotes((rows) =>
        rows.map((r) => (r.id === selectedId ? { ...r, title, content, updated_at } : r)),
      );
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, dirty, selectedId]);

  async function copyContent() {
    try {
      await navigator.clipboard.writeText(content);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy — select and copy manually");
    }
  }

  if (!isDM) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-neutral-700 bg-neutral-900/90 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
      >
        📝 Notes
      </button>

      {open && (
        <FloatingPanel
          title="Notes"
          onClose={() => setOpen(false)}
          defaultX={80}
          defaultY={72}
          defaultWidth={420}
          defaultHeight={380}
        >
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="flex w-32 shrink-0 flex-col overflow-y-auto border-r border-neutral-800">
              <button
                type="button"
                onClick={createNote}
                className="border-b border-neutral-800 px-2 py-1.5 text-left text-xs text-amber-300 hover:bg-neutral-800"
              >
                + New note
              </button>
              <ul className="overflow-y-auto text-xs">
                {notes.length === 0 && (
                  <li className="p-2 text-neutral-500">No notes yet</li>
                )}
                {notes.map((n) => (
                  <li key={n.id} className="group flex items-center">
                    <button
                      type="button"
                      onClick={() => select(n)}
                      className={`block flex-1 truncate px-2 py-1 text-left hover:bg-neutral-800 ${
                        selectedId === n.id ? "bg-neutral-800 text-amber-300" : "text-neutral-300"
                      }`}
                      title={n.title}
                    >
                      {n.title || "Untitled"}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeNote(n.id)}
                      className="px-1 text-neutral-600 hover:text-red-400"
                      aria-label="Remove"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-1 flex-col overflow-hidden">
              {!selectedId && (
                <div className="p-3 text-xs text-neutral-500">
                  Pick a note, or create one.
                </div>
              )}
              {selectedId && (
                <>
                  <div className="flex items-center gap-2 border-b border-neutral-800 px-2 py-1.5">
                    <input
                      value={title}
                      onChange={(e) => {
                        setTitle(e.target.value);
                        setDirty(true);
                      }}
                      placeholder="Title"
                      className="flex-1 truncate bg-transparent text-xs font-medium text-neutral-100 focus:outline-none"
                    />
                    <span className="shrink-0 text-[10px] text-neutral-600">
                      {saving ? "Saving…" : dirty ? "Unsaved" : ""}
                    </span>
                    <div className="flex shrink-0 overflow-hidden rounded border border-neutral-700 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setMode("edit")}
                        className={`px-1.5 py-0.5 ${mode === "edit" ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:bg-neutral-800"}`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode("preview")}
                        className={`px-1.5 py-0.5 ${mode === "preview" ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:bg-neutral-800"}`}
                      >
                        Preview
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={copyContent}
                      disabled={!content}
                      className="shrink-0 rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
                    >
                      Copy
                    </button>
                  </div>
                  {mode === "edit" ? (
                    <textarea
                      value={content}
                      onChange={(e) => {
                        setContent(e.target.value);
                        setDirty(true);
                      }}
                      placeholder="Markdown — # headers, **bold**, - lists, etc."
                      className="flex-1 resize-none bg-neutral-950 p-3 font-mono text-xs text-neutral-100 focus:outline-none"
                      autoFocus
                    />
                  ) : (
                    <div className="flex-1 overflow-y-auto p-3 text-xs text-neutral-200">
                      {content ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                          {content}
                        </ReactMarkdown>
                      ) : (
                        <span className="text-neutral-500">Empty — switch to Edit to write.</span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </FloatingPanel>
      )}
    </>
  );
}
