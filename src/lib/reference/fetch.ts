import type {
  AdventureIndexEntry,
  AdventureSection,
  ReferenceDetail,
  ReferenceIndexEntry,
} from "@/lib/reference/types";

// Same repo the local index (public/reference-index.json, scripts/build-reference-index.mjs)
// was generated from. raw.githubusercontent.com serves this with Access-Control-Allow-Origin: *
// (verified), so it's fetchable straight from the browser — no server-side proxy needed. The
// live 5e.tools site itself can't be used this way: it's behind a Cloudflare challenge
// (cf-mitigated: challenge) that blocks plain fetch()/XHR, iframing it is blocked outright by
// x-frame-options: SAMEORIGIN.
const RAW_BASE = "https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/";

let indexPromise: Promise<ReferenceIndexEntry[]> | null = null;

/** Fetched once per page load and cached — it's the small (~550KB) name/type/source index. */
export function loadReferenceIndex(): Promise<ReferenceIndexEntry[]> {
  if (!indexPromise) {
    indexPromise = fetch("/reference-index.json").then((r) => {
      if (!r.ok) throw new Error(`Failed to load reference index: ${r.status}`);
      return r.json();
    });
  }
  return indexPromise;
}

// One book file (e.g. "bestiary/bestiary-xmm.json") can be ~0.5-1.6MB — fetched lazily, only for
// a book the DM has actually picked something from, and cached so picking a second creature/
// spell from the same book doesn't fetch it again.
const bookCache = new Map<string, Promise<Record<string, unknown[]>>>();

function loadBook(file: string): Promise<Record<string, unknown[]>> {
  let p = bookCache.get(file);
  if (!p) {
    p = fetch(RAW_BASE + file).then((r) => {
      if (!r.ok) throw new Error(`Failed to fetch ${file}: ${r.status}`);
      return r.json();
    });
    bookCache.set(file, p);
  }
  return p;
}

/**
 * Full data for one index entry. Condition/disease/status entries already carry their full
 * `entries` in the index (that file is tiny) — no fetch. Monster/spell entries only carry
 * name/source/file, so this fetches (or reuses the cached) book file and picks the matching row.
 */
export async function loadReferenceDetail(entry: ReferenceIndexEntry): Promise<ReferenceDetail> {
  if (entry.type === "condition" || entry.type === "disease" || entry.type === "status") {
    return entry as unknown as ReferenceDetail;
  }
  const book = await loadBook(entry.file);
  const key = entry.type === "monster" ? "monster" : "spell";
  const rows = book[key] ?? [];
  const found = rows.find(
    (r) => (r as { name?: string }).name === entry.name && (r as { source?: string }).source === entry.source,
  );
  if (!found) throw new Error(`"${entry.name}" (${entry.source}) not found in ${entry.file}`);
  return found as ReferenceDetail;
}

let adventureIndexPromise: Promise<AdventureIndexEntry[]> | null = null;

/** Fetched once per page load and cached — small (~400KB) id/name/source/chapter-list metadata. */
export function loadAdventureIndex(): Promise<AdventureIndexEntry[]> {
  if (!adventureIndexPromise) {
    adventureIndexPromise = fetch("/adventure-index.json").then((r) => {
      if (!r.ok) throw new Error(`Failed to load adventure index: ${r.status}`);
      return r.json();
    });
  }
  return adventureIndexPromise;
}

// A full adventure file (data/adventure/adventure-<id>.json) is a separate, much bigger fetch
// than the metadata above — only made once the DM actually opens that adventure, and cached so
// flipping between its chapters doesn't refetch.
const adventureCache = new Map<string, Promise<AdventureSection[]>>();

function loadAdventureFile(file: string): Promise<AdventureSection[]> {
  let p = adventureCache.get(file);
  if (!p) {
    p = fetch(RAW_BASE + file).then(async (r) => {
      if (!r.ok) throw new Error(`Failed to fetch ${file}: ${r.status}`);
      const json = await r.json();
      return (json.data ?? []) as AdventureSection[];
    });
    adventureCache.set(file, p);
  }
  return p;
}

/** All of one adventure's top-level chapters/sections, in book order. */
export function loadAdventure(entry: AdventureIndexEntry): Promise<AdventureSection[]> {
  return loadAdventureFile(entry.file);
}
