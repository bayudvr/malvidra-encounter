export type ReferenceIndexEntry =
  | {
      type: "monster";
      name: string;
      source: string;
      file: string;
      cr: string | number | null;
      creatureType: string | null;
    }
  | {
      type: "spell";
      name: string;
      source: string;
      file: string;
      level: number;
      school: string | null;
    }
  | {
      // Split into three single-literal variants (rather than one variant with a union `type`)
      // so `entry.type === "monster" || entry.type === "spell"` fully narrows away this whole
      // shape — a combined literal union on the discriminant doesn't narrow the same way.
      type: "condition";
      name: string;
      source: string;
      entries: unknown;
    }
  | {
      type: "disease";
      name: string;
      source: string;
      entries: unknown;
    }
  | {
      type: "status";
      name: string;
      source: string;
      entries: unknown;
    }
  | {
      type: "trap" | "hazard";
      name: string;
      source: string;
      file: string;
      trapHazType: string | null;
    }
  | {
      type: "object";
      name: string;
      source: string;
      file: string;
      objectType: string | null;
    }
  | {
      // items.json's `item` + items-base.json's `baseitem` only — magicvariants.json's
      // `magicvariant` entries are templates ("+1 Ammunition") that apply to a base item via
      // 5etools' copy-merge machinery, same situation as a monster's `_copy` entries (which the
      // build script already skips rather than reimplementing that merge) — not a standalone,
      // display-ready item, so left out of the index.
      type: "item";
      name: string;
      source: string;
      file: string;
      rarity: string | null;
    };

/** A monster/spell/trap/hazard/object/item entry once its full book file has been fetched —
 * same shape 5etools uses. */
export type ReferenceDetail = Record<string, unknown>;

/** One data/bestiary/legendarygroups.json entry — a monster's `legendaryGroup: {name, source}`
 * field points here for its lair/regional/legendary actions, kept out of the monster's own row. */
export type LegendaryGroupEntry = {
  name: string;
  source: string;
  lairActions?: unknown;
  regionalEffects?: unknown;
  legendaryActions?: unknown;
  [key: string]: unknown;
};

export type LootCoinRoll = Partial<Record<"cp" | "sp" | "ep" | "gp" | "pp", string>>;

/** A row's optional gems/artObjects/magicItems sub-rolls point at loot.json's own
 * name-keyed tables (LootGemArtTable / MagicItemTableEntry) by `type`. */
export type LootTableRow = {
  min: number;
  max: number;
  coins?: LootCoinRoll;
  gems?: { type: number; amount: string };
  artObjects?: { type: number; amount: string };
  magicItems?: { type: string; amount: string }[];
};

export type LootTableEntry = {
  name: string;
  source: string;
  page?: number;
  crMin: number;
  crMax: number;
  coins?: LootCoinRoll;
  table: LootTableRow[];
};

/** gems/artObjects: flat, equally-weighted description lists keyed by nominal gp `type` tier. */
export type LootGemArtTable = {
  name: string;
  source: string;
  type: number;
  table: string[];
};

export type MagicItemTableRow = { min: number; max: number; item?: string; spellLevel?: number };

export type MagicItemTableEntry = {
  name: string;
  source: string;
  type: string;
  table: MagicItemTableRow[];
};

/** data/loot.json in full — the DMG's Individual/Hoard treasure tables. */
export type LootTables = {
  individual: LootTableEntry[];
  hoard: LootTableEntry[];
  gems: LootGemArtTable[];
  artObjects: LootGemArtTable[];
  magicItems: MagicItemTableEntry[];
};

/** data/encounterbuilder.json's shape templates — count/ratio formulas keyed off `players`. */
export type EncounterGroupCount =
  | { exact: number }
  | { min: number; max: number }
  | { formulaMin: string; formulaMax: string };

export type EncounterGroupRatio = { exact: number } | { min: number; max: number };

export type EncounterGroup = {
  count: EncounterGroupCount;
  ratio?: EncounterGroupRatio;
};

export type EncounterShapeVariant = { groups: EncounterGroup[] };

export type EncounterShapeEntry = {
  name: string;
  source: string;
  shapeTemplate: EncounterShapeVariant[];
};

export type AdventureChapter = { name: string; headers: string[] };

/** One row of public/adventure-index.json — metadata only, never the adventure's own text. */
export type AdventureIndexEntry = {
  id: string;
  name: string;
  source: string;
  file: string;
  level: { start?: number; end?: number } | null;
  contents: AdventureChapter[];
};

/** One top-level chapter/section once the adventure's full file has been fetched. */
export type AdventureSection = {
  type?: string;
  name?: string;
  entries?: unknown;
  [key: string]: unknown;
};
