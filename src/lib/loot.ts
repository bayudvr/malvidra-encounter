import { loadLootTables } from "@/lib/reference/fetch";
import type { LootCoinRoll, LootTableEntry, LootGemArtTable, LootTables } from "@/lib/reference/types";

// A tiny, standalone dice-formula roller for loot.json's simple "XdY" / "XdY*Z" notation.
// Deliberately not DiceTray's @3d-dice/dice-box + dice-parser-interface pipeline — that's tied to
// its own canvas/component and chat-broadcast state (see src/components/dice/DiceTray.tsx),
// which is overkill for a background loot roll that just needs a number.
export function rollFormula(formula: string): number {
  const m = formula.trim().match(/^(\d+)d(\d+)(?:\*(\d+))?$/);
  if (!m) {
    const n = Number(formula);
    return Number.isFinite(n) ? n : 0;
  }
  const count = Number(m[1]);
  const sides = Number(m[2]);
  const mult = m[3] ? Number(m[3]) : 1;
  let total = 0;
  for (let i = 0; i < count; i++) total += 1 + Math.floor(Math.random() * sides);
  return total * mult;
}

function rollD100(): number {
  return 1 + Math.floor(Math.random() * 100);
}

function pickRow<T extends { min: number; max: number }>(rows: T[], roll: number): T | undefined {
  return rows.find((r) => roll >= r.min && roll <= r.max);
}

/** "1/8"/"1/4"/"1/2"/"3" -> 0.125/0.25/0.5/3, for comparing against a table's crMin/crMax. */
export function crToNumber(cr: string | number | null | undefined): number {
  if (cr == null) return 0;
  if (typeof cr === "number") return cr;
  if (cr.includes("/")) {
    const [num, den] = cr.split("/").map(Number);
    return den ? num / den : 0;
  }
  return Number(cr) || 0;
}

function addCoins(into: LootResult["coins"], roll: LootCoinRoll | undefined) {
  if (!roll) return;
  for (const [denom, formula] of Object.entries(roll) as [keyof LootCoinRoll, string][]) {
    if (!formula) continue;
    into[denom] = (into[denom] ?? 0) + rollFormula(formula);
  }
}

function rollGemArt(tables: LootGemArtTable[], type: number, amountFormula: string): string[] {
  const table = tables.find((t) => t.type === type);
  if (!table) return [];
  const quantity = rollFormula(amountFormula);
  const picks: string[] = [];
  for (let i = 0; i < quantity; i++) {
    picks.push(table.table[Math.floor(Math.random() * table.table.length)]);
  }
  return picks;
}

function rollMagicItems(tables: LootTables["magicItems"], type: string, amountFormula: string): string[] {
  const table = tables.find((t) => t.type === type);
  if (!table) return [];
  const quantity = rollFormula(amountFormula);
  const picks: string[] = [];
  for (let i = 0; i < quantity; i++) {
    const row = pickRow(table.table, rollD100());
    if (row?.item) picks.push(row.item);
  }
  return picks;
}

export type LootResult = {
  coins: Partial<Record<"cp" | "sp" | "ep" | "gp" | "pp", number>>;
  /** Raw {@item ...}/plain description strings — render through stripTags(). */
  gems: string[];
  artObjects: string[];
  magicItems: string[];
};

const EMPTY_RESULT: LootResult = { coins: {}, gems: [], artObjects: [], magicItems: [] };

function findCrEntry(entries: LootTableEntry[], cr: string | number | null): LootTableEntry | undefined {
  const crNum = crToNumber(cr);
  return entries.find((e) => crNum >= e.crMin && crNum <= e.crMax);
}

/**
 * Rolls treasure for one monster's CR against the DMG's Individual or Hoard table (loot.json).
 * "Individual" is per-kill loose change; "Hoard" is a full lair-scale treasure pile (coins +
 * gems/art objects/magic items) — same table format either way.
 */
export async function rollLoot(
  cr: string | number | null,
  kind: "individual" | "hoard",
): Promise<LootResult> {
  const tables = await loadLootTables();
  const entry = findCrEntry(kind === "individual" ? tables.individual : tables.hoard, cr);
  if (!entry) return EMPTY_RESULT;

  const coins: LootResult["coins"] = {};
  addCoins(coins, entry.coins);

  const row = pickRow(entry.table, rollD100());
  addCoins(coins, row?.coins);

  const gems = row?.gems ? rollGemArt(tables.gems, row.gems.type, row.gems.amount) : [];
  const artObjects = row?.artObjects
    ? rollGemArt(tables.artObjects, row.artObjects.type, row.artObjects.amount)
    : [];
  const magicItems = (row?.magicItems ?? []).flatMap((mi) =>
    rollMagicItems(tables.magicItems, mi.type, mi.amount),
  );

  return { coins, gems, artObjects, magicItems };
}
