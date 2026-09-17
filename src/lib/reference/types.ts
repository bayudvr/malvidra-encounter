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
    };

/** A monster/spell entry once its full book file has been fetched — same shape 5etools uses. */
export type ReferenceDetail = Record<string, unknown>;

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
