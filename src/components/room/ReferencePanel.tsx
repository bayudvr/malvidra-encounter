"use client";

import { useEffect, useMemo, useState } from "react";

import { useToast } from "@/components/toast";
import type { RoomStore } from "@/lib/room/useRoomState";
import type { SavedReference } from "@/lib/room/types";
import { loadReferenceDetail, loadReferenceIndex } from "@/lib/reference/fetch";
import type { ReferenceDetail, ReferenceIndexEntry } from "@/lib/reference/types";
import { Entries, stripTags } from "@/lib/reference/render";

const MAX_RESULTS = 30;
const ABILS = ["str", "dex", "con", "int", "wis", "cha"] as const;
const mod = (score: number) => {
  const m = Math.floor((score - 10) / 2);
  return m >= 0 ? `+${m}` : `${m}`;
};

function acText(ac: unknown): string {
  if (!Array.isArray(ac)) return "—";
  return ac
    .map((a) => (typeof a === "number" ? String(a) : `${(a as { ac: number }).ac}`))
    .join(", ");
}

function speedText(speed: unknown): string {
  if (!speed || typeof speed !== "object") return "—";
  return Object.entries(speed as Record<string, number>)
    .map(([k, v]) => (k === "walk" ? `${v} ft.` : `${k} ${v} ft.`))
    .join(", ");
}

/** Selected entry's rendered detail — a monster stat block, spell card, or condition text. */
function DetailView({ type, data }: SavedReference | { name: string; source: string | null; type: string; data: ReferenceDetail }) {
  if (type === "monster") {
    const m = data as Record<string, unknown>;
    return (
      <div className="text-sm">
        <div className="text-xs italic text-neutral-400">
          {[typeof m.size === "string" ? m.size : (m.size as string[])?.[0], typeof m.type === "string" ? m.type : (m.type as { type?: string })?.type, Array.isArray(m.alignment) ? (m.alignment as string[]).join(" ") : null]
            .filter(Boolean)
            .join(", ")}
        </div>
        <div className="mt-1 grid grid-cols-2 gap-1 text-xs text-neutral-300">
          <div>AC {acText(m.ac)}</div>
          <div>
            HP {(m.hp as { average?: number })?.average ?? "—"}
            {(m.hp as { formula?: string })?.formula ? ` (${(m.hp as { formula?: string }).formula})` : ""}
          </div>
          <div className="col-span-2">Speed {speedText(m.speed)}</div>
        </div>
        <div className="mt-2 grid grid-cols-6 gap-1 text-center text-xs">
          {ABILS.map((a) => (
            <div key={a} className="rounded border border-neutral-800 py-1">
              <div className="uppercase text-neutral-500">{a}</div>
              <div className="text-neutral-200">
                {m[a] as number} ({mod(m[a] as number)})
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 text-xs text-neutral-400">
          CR {typeof m.cr === "object" ? (m.cr as { cr?: string })?.cr : (m.cr as string) ?? "—"}
          {m.senses ? ` · Senses ${(m.senses as string[]).join(", ")}` : ""}
          {m.languages ? ` · Languages ${(m.languages as string[]).join(", ")}` : ""}
        </div>
        {(["trait", "action", "bonus", "reaction", "legendary"] as const).map(
          (section) =>
            Array.isArray(m[section]) && (
              <div key={section} className="mt-3">
                <div className="text-xs font-bold uppercase tracking-wide text-amber-400">
                  {section === "bonus" ? "Bonus Actions" : `${section}s`}
                </div>
                {(m[section] as { name?: string; entries?: unknown }[]).map((e, i) => (
                  <div key={i} className="mt-1">
                    {e.name && <span className="font-semibold text-neutral-200">{e.name}. </span>}
                    <Entries node={e.entries as never} keyPrefix={`${section}-${i}`} />
                  </div>
                ))}
              </div>
            ),
        )}
      </div>
    );
  }

  if (type === "spell") {
    const s = data as Record<string, unknown>;
    const level = s.level === 0 ? "Cantrip" : `Level ${s.level}`;
    return (
      <div className="text-sm">
        <div className="text-xs italic text-neutral-400">
          {level}
          {s.school ? ` · school ${s.school}` : ""}
        </div>
        <Entries node={s.entries as never} keyPrefix="spell-entries" />
        {s.entriesHigherLevel != null && (
          <Entries node={s.entriesHigherLevel as never} keyPrefix="spell-higher" />
        )}
      </div>
    );
  }

  // condition / disease / status
  return (
    <div className="text-sm">
      <Entries node={data.entries as never} keyPrefix="cond-entries" />
    </div>
  );
}

export function ReferencePanel({ room, isDM }: { room: RoomStore; isDM: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"search" | "saved">("search");
  const [index, setIndex] = useState<ReferenceIndexEntry[] | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{
    name: string;
    source: string | null;
    type: string;
    data: ReferenceDetail;
  } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saved, setSaved] = useState<SavedReference[]>([]);

  // Index + saved rows only need loading once the panel is actually opened.
  useEffect(() => {
    if (!open || !isDM) return;
    if (!index && !indexError) {
      loadReferenceIndex()
        .then(setIndex)
        .catch((e) => setIndexError(e instanceof Error ? e.message : "Failed to load index"));
    }
    const roomId = room.room?.id;
    if (roomId) {
      room.supabase
        .from("saved_references")
        .select("*")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true })
        .then(({ data }) => {
          if (data) setSaved(data as SavedReference[]);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isDM]);

  const results = useMemo(() => {
    if (!index || query.trim().length < 2) return [];
    const q = query.trim().toLowerCase();
    return index.filter((e) => e.name.toLowerCase().includes(q)).slice(0, MAX_RESULTS);
  }, [index, query]);

  async function pick(entry: ReferenceIndexEntry) {
    setLoadingDetail(true);
    setSelected(null);
    try {
      const data = await loadReferenceDetail(entry);
      setSelected({ name: entry.name, source: entry.source, type: entry.type, data });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoadingDetail(false);
    }
  }

  function openSaved(row: SavedReference) {
    setSelected({ name: row.name, source: row.source, type: row.type, data: row.data as ReferenceDetail });
  }

  const alreadySaved = selected
    ? saved.some((s) => s.name === selected.name && s.type === selected.type && s.source === selected.source)
    : false;

  async function saveSelected() {
    if (!selected || !room.room?.id) return;
    const { data, error } = await room.supabase
      .from("saved_references")
      .insert({
        room_id: room.room.id,
        name: selected.name,
        type: selected.type,
        source: selected.source,
        data: selected.data,
      })
      .select()
      .single();
    if (error || !data) return toast.error(error?.message ?? "Couldn't save");
    setSaved((rows) => [...rows, data as SavedReference]);
    toast.success("Saved");
  }

  async function removeSaved(id: string) {
    setSaved((rows) => rows.filter((r) => r.id !== id));
    const { error } = await room.supabase.from("saved_references").delete().eq("id", id);
    if (error) toast.error(error.message);
  }

  if (!isDM) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-neutral-700 bg-neutral-900/90 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
      >
        🐉 5e
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 flex h-[28rem] w-[22rem] flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl">
          <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
            <div className="flex gap-1 text-xs">
              <button
                type="button"
                onClick={() => setTab("search")}
                className={`rounded px-2 py-1 ${tab === "search" ? "bg-neutral-800 text-neutral-100" : "text-neutral-500"}`}
              >
                Search
              </button>
              <button
                type="button"
                onClick={() => setTab("saved")}
                className={`rounded px-2 py-1 ${tab === "saved" ? "bg-neutral-800 text-neutral-100" : "text-neutral-500"}`}
              >
                Saved {saved.length > 0 ? `(${saved.length})` : ""}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-neutral-500 hover:text-neutral-200"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="flex flex-1 overflow-hidden">
            <div className="flex w-32 shrink-0 flex-col overflow-y-auto border-r border-neutral-800">
              {tab === "search" ? (
                <>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search…"
                    className="border-b border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-100 focus:outline-none"
                    autoFocus
                  />
                  {indexError && <div className="p-2 text-xs text-red-400">{indexError}</div>}
                  {query.trim().length >= 2 && results.length === 0 && !indexError && (
                    <div className="p-2 text-xs text-neutral-500">No matches</div>
                  )}
                  <ul className="overflow-y-auto text-xs">
                    {results.map((e) => (
                      <li key={`${e.type}-${e.source}-${e.name}`}>
                        <button
                          type="button"
                          onClick={() => pick(e)}
                          className={`block w-full truncate px-2 py-1 text-left hover:bg-neutral-800 ${
                            selected?.name === e.name ? "bg-neutral-800 text-amber-300" : "text-neutral-300"
                          }`}
                          title={e.name}
                        >
                          {e.name}
                          <span className="ml-1 text-neutral-500">{e.source}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <ul className="overflow-y-auto text-xs">
                  {saved.length === 0 && <li className="p-2 text-neutral-500">Nothing saved yet</li>}
                  {saved.map((row) => (
                    <li key={row.id} className="group flex items-center">
                      <button
                        type="button"
                        onClick={() => openSaved(row)}
                        className={`block flex-1 truncate px-2 py-1 text-left hover:bg-neutral-800 ${
                          selected?.name === row.name ? "bg-neutral-800 text-amber-300" : "text-neutral-300"
                        }`}
                        title={row.name}
                      >
                        {row.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeSaved(row.id)}
                        className="px-1 text-neutral-600 hover:text-red-400"
                        aria-label="Remove"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {loadingDetail && <div className="text-xs text-neutral-500">Loading…</div>}
              {!loadingDetail && !selected && (
                <div className="text-xs text-neutral-500">
                  {tab === "search" ? "Type at least 2 characters, then pick a result." : "Pick a saved entry."}
                </div>
              )}
              {!loadingDetail && selected && (
                <>
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <div>
                      <div className="font-bold text-neutral-100">{stripTags(selected.name)}</div>
                      <div className="text-[10px] uppercase tracking-wide text-neutral-500">
                        {selected.type}
                        {selected.source ? ` · ${selected.source}` : ""}
                      </div>
                    </div>
                    {tab === "search" && (
                      <button
                        type="button"
                        onClick={saveSelected}
                        disabled={alreadySaved}
                        className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-[10px] text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
                      >
                        {alreadySaved ? "Saved" : "Save"}
                      </button>
                    )}
                  </div>
                  <DetailView {...selected} />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
