import type { EncounterGroupCount, EncounterGroupRatio, EncounterShapeVariant } from "@/lib/reference/types";

// Standard D&D 5e (2014 DMG) rules tables — not 5etools *content*, so hardcoded here rather than
// fetched: they're small, static game math (encounterbuilder.json only has the shape templates
// below, not this budget math — see the plan's caveat on this being a best-effort reconstruction,
// not a verified port of 5e.tools' own encounter-builder algorithm).

/** DMG p.82 — per-character XP thresholds by level and target difficulty. */
export const PARTY_XP_THRESHOLDS: Record<
  number,
  { easy: number; medium: number; hard: number; deadly: number }
> = {
  1: { easy: 25, medium: 50, hard: 75, deadly: 100 },
  2: { easy: 50, medium: 100, hard: 150, deadly: 200 },
  3: { easy: 75, medium: 150, hard: 225, deadly: 400 },
  4: { easy: 125, medium: 250, hard: 375, deadly: 500 },
  5: { easy: 250, medium: 500, hard: 750, deadly: 1100 },
  6: { easy: 300, medium: 600, hard: 900, deadly: 1400 },
  7: { easy: 350, medium: 750, hard: 1100, deadly: 1700 },
  8: { easy: 450, medium: 900, hard: 1400, deadly: 2100 },
  9: { easy: 550, medium: 1100, hard: 1600, deadly: 2400 },
  10: { easy: 600, medium: 1200, hard: 1900, deadly: 2800 },
  11: { easy: 800, medium: 1600, hard: 2400, deadly: 3600 },
  12: { easy: 1000, medium: 2000, hard: 3000, deadly: 4500 },
  13: { easy: 1100, medium: 2200, hard: 3400, deadly: 5100 },
  14: { easy: 1250, medium: 2500, hard: 3800, deadly: 5700 },
  15: { easy: 1400, medium: 2800, hard: 4300, deadly: 6400 },
  16: { easy: 1600, medium: 3200, hard: 4800, deadly: 7200 },
  17: { easy: 2000, medium: 3900, hard: 5900, deadly: 8800 },
  18: { easy: 2100, medium: 4200, hard: 6300, deadly: 9500 },
  19: { easy: 2400, medium: 4900, hard: 7300, deadly: 10900 },
  20: { easy: 2800, medium: 5700, hard: 8500, deadly: 12700 },
};

/** DMG p.274 — CR to XP, keyed the same way bestiary `cr` fields are ("1/8", "1/4", "1/2", "0".."30"). */
export const CR_TO_XP: Record<string, number> = {
  "0": 10,
  "1/8": 25,
  "1/4": 50,
  "1/2": 100,
  "1": 200,
  "2": 450,
  "3": 700,
  "4": 1100,
  "5": 1800,
  "6": 2300,
  "7": 2900,
  "8": 3900,
  "9": 5000,
  "10": 5900,
  "11": 7200,
  "12": 8400,
  "13": 10000,
  "14": 11500,
  "15": 13000,
  "16": 15000,
  "17": 18000,
  "18": 20000,
  "19": 22000,
  "20": 25000,
  "21": 33000,
  "22": 41000,
  "23": 50000,
  "24": 62000,
  "25": 75000,
  "26": 90000,
  "27": 105000,
  "28": 120000,
  "29": 135000,
  "30": 155000,
};

export type EncounterDifficulty = "easy" | "medium" | "hard" | "deadly";

export function xpForCr(cr: string | number | null | undefined): number {
  if (cr == null) return 0;
  return CR_TO_XP[String(cr)] ?? 0;
}

/** Nearest CR whose DMG XP value is closest to a target per-monster XP budget. */
export function nearestCrForXp(xp: number): string {
  let best = "0";
  let bestDiff = Infinity;
  for (const [cr, crXp] of Object.entries(CR_TO_XP)) {
    const diff = Math.abs(crXp - xp);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = cr;
    }
  }
  return best;
}

// DMG p.82 — total-monster-count multiplier, shifted a row per the party-size adjustment (fewer
// than 3 players: one row more dangerous; more than 5: one row less dangerous).
const COUNT_MULTIPLIERS = [1, 1.5, 2, 2.5, 3, 4];

function countMultiplierRow(count: number): number {
  if (count <= 1) return 0;
  if (count === 2) return 1;
  if (count <= 6) return 2;
  if (count <= 10) return 3;
  if (count <= 14) return 4;
  return 5;
}

export function monsterCountMultiplier(count: number, partySize: number): number {
  let row = countMultiplierRow(count);
  if (partySize < 3) row = Math.min(row + 1, COUNT_MULTIPLIERS.length - 1);
  else if (partySize > 5) row = Math.max(row - 1, 0);
  return COUNT_MULTIPLIERS[row];
}

// encounterbuilder.json's only formulas seen are a single variable ("players") optionally
// combined with one "+"/"-"/"*"/"/" operator against an integer literal — a small left-to-right
// reducer is enough; deliberately not eval()/Function() for arbitrary expression evaluation.
export function evaluateEncounterFormula(formula: string, players: number): number {
  const tokens = formula
    .trim()
    .split(/\s+/)
    .map((t) => (t === "players" ? String(players) : t));
  let result = Number(tokens[0]);
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i];
    const rhs = Number(tokens[i + 1]);
    if (op === "+") result += rhs;
    else if (op === "-") result -= rhs;
    else if (op === "*") result *= rhs;
    else if (op === "/") result /= rhs;
  }
  return result;
}

function resolveGroupCount(count: EncounterGroupCount, players: number): number {
  if ("exact" in count) return count.exact;
  if ("formulaMin" in count) {
    const lo = evaluateEncounterFormula(count.formulaMin, players);
    const hi = evaluateEncounterFormula(count.formulaMax, players);
    return Math.max(1, Math.round((lo + hi) / 2));
  }
  return Math.max(1, Math.round((count.min + count.max) / 2));
}

function resolveGroupRatio(ratio: EncounterGroupRatio | undefined): number | null {
  if (!ratio) return null;
  if ("exact" in ratio) return ratio.exact;
  return (ratio.min + ratio.max) / 2;
}

export type EncounterGroupPlan = { count: number; targetCr: string };

/**
 * Turns one shape variant into a per-group suggestion: how many creatures, and roughly what CR
 * each one should be so the whole encounter lands near the requested difficulty. This is a
 * best-effort reading of encounterbuilder.json's ratio/count schema (see the plan's caveat) — the
 * DM still picks the actual creatures; `targetCr` is a starting point, not a hard constraint.
 */
export function computeEncounterPlan({
  partyLevel,
  partySize,
  difficulty,
  variant,
}: {
  partyLevel: number;
  partySize: number;
  difficulty: EncounterDifficulty;
  variant: EncounterShapeVariant;
}): EncounterGroupPlan[] {
  const level = Math.min(20, Math.max(1, Math.round(partyLevel)));
  const totalBudget = PARTY_XP_THRESHOLDS[level][difficulty] * Math.max(1, partySize);

  const counts = variant.groups.map((g) => resolveGroupCount(g.count, partySize));
  const totalMonsterCount = counts.reduce((a, b) => a + b, 0) || 1;
  const multiplier = monsterCountMultiplier(totalMonsterCount, partySize);
  const targetRawXpSum = totalBudget / multiplier;

  const ratios = variant.groups.map((g) => resolveGroupRatio(g.ratio));
  const ratioSum = ratios.reduce((sum: number, r) => sum + (r ?? 0), 0);
  const unratiedCount = ratios.filter((r) => r == null).length;
  const remainingRatio = Math.max(0, 1 - ratioSum);
  const perUnratiedRatio = unratiedCount > 0 ? remainingRatio / unratiedCount : 0;

  return variant.groups.map((_g, i) => {
    const count = counts[i];
    const groupRatio = ratios[i] ?? perUnratiedRatio;
    const perMonsterXp = (targetRawXpSum * groupRatio) / count;
    return { count, targetCr: nearestCrForXp(perMonsterXp) };
  });
}
