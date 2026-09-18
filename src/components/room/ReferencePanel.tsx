"use client";

import { useEffect, useMemo, useState } from "react";

import { useToast } from "@/components/toast";
import type { RoomStore } from "@/lib/room/useRoomState";
import type { SavedReference } from "@/lib/room/types";
import {
  loadAdventure,
  loadAdventureIndex,
  loadReferenceDetail,
  loadReferenceIndex,
} from "@/lib/reference/fetch";
import type {
  AdventureIndexEntry,
  AdventureSection,
  ReferenceDetail,
  ReferenceIndexEntry,
} from "@/lib/reference/types";
import { Entries, stripTags } from "@/lib/reference/render";
import { FloatingPanel } from "@/components/room/FloatingPanel";

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

const spellList = (arr: unknown): string =>
  Array.isArray(arr) ? arr.map((s) => stripTags(String(s))).join(", ") : "";

/** One monster.spellcasting[] entry — "will" (at-will), "daily" (X/day), or leveled "spells". */
function SpellcastingBlock({ sc }: { sc: Record<string, unknown> }) {
  return (
    <div className="mt-1">
      {typeof sc.name === "string" && (
        <span className="font-semibold text-neutral-200">{sc.name}. </span>
      )}
      <Entries node={sc.headerEntries as never} keyPrefix="sc-header" />
      {Array.isArray(sc.will) && <p className="mb-1">At will: {spellList(sc.will)}</p>}
      {sc.daily != null &&
        typeof sc.daily === "object" &&
        Object.entries(sc.daily as Record<string, unknown>).map(([count, spells]) => (
          <p key={count} className="mb-1">
            {count.replace(/e$/, "")}/day{count.endsWith("e") ? " each" : ""}: {spellList(spells)}
          </p>
        ))}
      {sc.spells != null &&
        typeof sc.spells === "object" &&
        Object.entries(sc.spells as Record<string, { slots?: number; spells: unknown }>).map(
          ([lvl, info]) => (
            <p key={lvl} className="mb-1">
              {lvl === "0" ? "Cantrips" : `Level ${lvl}${info.slots ? ` (${info.slots} slots)` : ""}`}
              : {spellList(info.spells)}
            </p>
          ),
        )}
    </div>
  );
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
        {Array.isArray(m.spellcasting) && (
          <div className="mt-3">
            <div className="text-xs font-bold uppercase tracking-wide text-amber-400">
              Spellcasting
            </div>
            {(m.spellcasting as Record<string, unknown>[]).map((sc, i) => (
              <SpellcastingBlock key={i} sc={sc} />
            ))}
          </div>
        )}
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
  const [tab, setTab] = useState<"search" | "saved" | "adventures">("search");
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

  const [adventureIndex, setAdventureIndex] = useState<AdventureIndexEntry[] | null>(null);
  const [adventureIndexError, setAdventureIndexError] = useState<string | null>(null);
  const [adventureQuery, setAdventureQuery] = useState("");
  const [pickedAdventure, setPickedAdventure] = useState<AdventureIndexEntry | null>(null);
  const [sections, setSections] = useState<AdventureSection[] | null>(null);
  const [chapterIdx, setChapterIdx] = useState<number | null>(null);
  const [loadingChapter, setLoadingChapter] = useState(false);

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

  // Adventure metadata (names + chapter list, no full text) only needs loading once that tab is
  // actually opened — full adventures are much bigger than the monster/spell index.
  useEffect(() => {
    if (tab !== "adventures" || adventureIndex || adventureIndexError) return;
    loadAdventureIndex()
      .then(setAdventureIndex)
      .catch((e) =>
        setAdventureIndexError(e instanceof Error ? e.message : "Failed to load adventure index"),
      );
  }, [tab, adventureIndex, adventureIndexError]);

  function pickAdventure(adv: AdventureIndexEntry) {
    setPickedAdventure(adv);
    setSections(null);
    setChapterIdx(null);
  }

  function backToAdventureList() {
    setPickedAdventure(null);
    setSections(null);
    setChapterIdx(null);
  }

  // The full adventure file is only fetched once a specific chapter is opened — picking the
  // adventure itself just shows its chapter list, already in the small metadata index.
  async function pickChapter(idx: number) {
    setChapterIdx(idx);
    if (!pickedAdventure || sections) return;
    setLoadingChapter(true);
    try {
      setSections(await loadAdventure(pickedAdventure));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load adventure");
    } finally {
      setLoadingChapter(false);
    }
  }

  const adventureResults = useMemo(() => {
    if (!adventureIndex) return [];
    const q = adventureQuery.trim().toLowerCase();
    const list = q ? adventureIndex.filter((a) => a.name.toLowerCase().includes(q)) : adventureIndex;
    return list.slice(0, MAX_RESULTS);
  }, [adventureIndex, adventureQuery]);

  const currentChapter =
    pickedAdventure && chapterIdx != null
      ? sections?.find((s) => s.name === pickedAdventure.contents[chapterIdx]?.name) ??
        sections?.[chapterIdx] ??
        null
      : null;

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
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-neutral-700 bg-neutral-900/90 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
      >
        🐉 5e
      </button>

      {open && (
        <FloatingPanel
          title="5e Reference"
          onClose={() => setOpen(false)}
          defaultX={120}
          defaultY={72}
          defaultWidth={480}
          defaultHeight={450}
        >
          <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 gap-1 border-b border-neutral-800 px-2 py-1.5 text-xs">
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
              <button
                type="button"
                onClick={() => setTab("adventures")}
                className={`rounded px-2 py-1 ${tab === "adventures" ? "bg-neutral-800 text-neutral-100" : "text-neutral-500"}`}
              >
                Adventures
              </button>
          </div>

          <div className="flex flex-1 overflow-hidden">
            <div className="flex w-36 shrink-0 flex-col overflow-y-auto border-r border-neutral-800">
              {tab === "search" && (
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
              )}
              {tab === "saved" && (
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
              {tab === "adventures" && !pickedAdventure && (
                <>
                  <input
                    value={adventureQuery}
                    onChange={(e) => setAdventureQuery(e.target.value)}
                    placeholder="Filter…"
                    className="border-b border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-100 focus:outline-none"
                  />
                  {adventureIndexError && (
                    <div className="p-2 text-xs text-red-400">{adventureIndexError}</div>
                  )}
                  {!adventureIndex && !adventureIndexError && (
                    <div className="p-2 text-xs text-neutral-500">Loading…</div>
                  )}
                  <ul className="overflow-y-auto text-xs">
                    {adventureResults.map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => pickAdventure(a)}
                          className="block w-full truncate px-2 py-1 text-left text-neutral-300 hover:bg-neutral-800"
                          title={a.name}
                        >
                          {a.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {tab === "adventures" && pickedAdventure && (
                <>
                  <button
                    type="button"
                    onClick={backToAdventureList}
                    className="border-b border-neutral-800 px-2 py-1.5 text-left text-xs text-amber-300 hover:bg-neutral-800"
                  >
                    ← {pickedAdventure.name}
                  </button>
                  <ul className="overflow-y-auto text-xs">
                    {pickedAdventure.contents.map((c, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          onClick={() => pickChapter(i)}
                          className={`block w-full truncate px-2 py-1 text-left hover:bg-neutral-800 ${
                            chapterIdx === i ? "bg-neutral-800 text-amber-300" : "text-neutral-300"
                          }`}
                          title={c.name}
                        >
                          {c.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            {tab === "adventures" ? (
              <div className="flex-1 overflow-y-auto p-3 text-sm text-neutral-200">
                {loadingChapter && <div className="text-xs text-neutral-500">Loading…</div>}
                {!loadingChapter && chapterIdx == null && (
                  <div className="text-xs text-neutral-500">
                    {pickedAdventure ? "Pick a chapter." : "Pick an adventure."}
                  </div>
                )}
                {!loadingChapter && currentChapter && (
                  <>
                    <div className="mb-2 font-bold text-neutral-100">
                      {stripTags(currentChapter.name ?? "")}
                    </div>
                    <Entries node={currentChapter.entries as never} keyPrefix="adv" />
                  </>
                )}
              </div>
            ) : (
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
            )}
          </div>
          </div>
        </FloatingPanel>
      )}
    </>
  );
}
