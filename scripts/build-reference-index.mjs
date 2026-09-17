// Builds public/reference-index.json — a lightweight (name/type/source/file only, no stat
// block/spell text) search index over 5etools' monster + spell data, plus the full text of
// every condition/disease/status (that file is tiny, ~60KB, so no point lazy-loading it).
//
// The DM Reference panel searches this small index client-side, then lazy-fetches ONLY the one
// book file a selected result lives in from raw.githubusercontent.com (see
// src/lib/reference/fetch.ts) — so this index intentionally spans every source book 5etools
// has (old and new editions alike), not just one edition: indexing costs nothing per extra
// book (it's still just a name), so there is no reason to leave any edition out.
//
// Usage: node scripts/build-reference-index.mjs [path-to-5etools-src-clone]
// Defaults to ../5etools-src (sibling checkout) — see 5etools-mirror-3/5etools-src on GitHub.
// Re-run this whenever the 5etools-src checkout is updated with a new source book.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const srcDir = resolve(process.argv[2] || "../5etools-src");
const dataDir = join(srcDir, "data");

if (!existsSync(dataDir)) {
  console.error(`5etools data dir not found at ${dataDir}`);
  console.error("Usage: node scripts/build-reference-index.mjs [path-to-5etools-src-clone]");
  process.exit(1);
}

const readJson = (relPath) => JSON.parse(readFileSync(join(dataDir, relPath), "utf8"));

const entries = [];

// --- Monsters -----------------------------------------------------------
const bestiaryIndex = readJson("bestiary/index.json");
for (const file of new Set(Object.values(bestiaryIndex))) {
  const relFile = `bestiary/${file}`;
  if (!existsSync(join(dataDir, relFile))) continue;
  const { monster = [] } = readJson(relFile);
  for (const m of monster) {
    // _copy entries are "same as X, with these overrides" — not a real standalone stat block,
    // and 5etools' own renderer needs its full copy-merge machinery to display one properly.
    // Skipping them means a handful of variants (e.g. some MM reprints) won't show up standalone
    // — acceptable for a quick-reference panel; the base creature they copy from still does.
    if (m._copy) continue;
    entries.push({
      name: m.name,
      type: "monster",
      source: m.source,
      file: relFile,
      cr: m.cr != null ? (typeof m.cr === "object" ? m.cr.cr : m.cr) : null,
      creatureType: typeof m.type === "string" ? m.type : m.type?.type ?? null,
    });
  }
}

// --- Spells ---------------------------------------------------------------
const spellIndex = readJson("spells/index.json");
for (const file of new Set(Object.values(spellIndex))) {
  const relFile = `spells/${file}`;
  if (!existsSync(join(dataDir, relFile))) continue;
  const { spell = [] } = readJson(relFile);
  for (const s of spell) {
    if (s._copy) continue;
    entries.push({
      name: s.name,
      type: "spell",
      source: s.source,
      file: relFile,
      level: s.level,
      school: s.school ?? null,
    });
  }
}

// --- Conditions/diseases/status — small enough to embed in full, no lazy fetch needed ---
const conditions = readJson("conditionsdiseases.json");
for (const kind of ["condition", "disease", "status"]) {
  for (const c of conditions[kind] ?? []) {
    entries.push({
      name: c.name,
      type: kind,
      source: c.source,
      entries: c.entries ?? null,
    });
  }
}

entries.sort((a, b) => a.name.localeCompare(b.name));

const outPath = join(process.cwd(), "public", "reference-index.json");
writeFileSync(outPath, JSON.stringify(entries));
console.log(`Wrote ${entries.length} entries to ${outPath}`);

// --- Adventures -------------------------------------------------------------
// A separate small index (browsed, not name-searched like the entries above): id/name/source/
// level range + each chapter's name and header list, straight from data/adventures.json — that
// file already IS just this metadata, no full adventure text. The full adventure text
// (data/adventure/adventure-<id>.json, fetched lazily per adventure — see
// src/lib/reference/fetch.ts) is a completely separate, much bigger file per book.
const { adventure = [] } = readJson("adventures.json");
const adventures = adventure.map((a) => ({
  id: a.id,
  name: a.name,
  source: a.source,
  file: `adventure/adventure-${a.id.toLowerCase()}.json`,
  level: a.level ?? null,
  contents: (a.contents ?? []).map((c) => ({ name: c.name, headers: c.headers ?? [] })),
}));

const advOutPath = join(process.cwd(), "public", "adventure-index.json");
writeFileSync(advOutPath, JSON.stringify(adventures));
console.log(`Wrote ${adventures.length} adventures to ${advOutPath}`);
