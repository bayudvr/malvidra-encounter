/**
 * Visual labels for a D&D-style d20 roll.
 *
 * A natural is the selected, unmodified d20 face. With advantage or
 * disadvantage, discarded d20 faces never trigger a critical banner.
 * Other dice in a combined roll (Guidance, Bardic Inspiration, etc.)
 * affect only the final total, not the natural face.
 */
export type RollVariant = "normal" | "natural20" | "natural1" | "dirty20" | "dirty1" | "high";
export type RollDetail = { sides: number; values: number[] };
export type RollBannerInput = {
  actorName: string;
  notation: string;
  detail: RollDetail[];
  total: number;
};

export const ROLL_BANNER_TITLES: Record<RollVariant, string> = {
  normal: "Dice Roll",
  natural20: "NATURAL 20!",
  natural1: "NATURAL 1!",
  dirty20: "Dirty Twenty",
  dirty1: "Dirty One",
  high: "High Roll",
};

export function selectedD20Face(notation: string, detail: RollDetail[]): number | null {
  const d20 = detail.filter((entry) => entry.sides === 20);
  if (d20.length !== 1) return null;
  const terms = [...notation.matchAll(/(\d+)d20(kh1|kl1)?(?!\d)/gi)];
  if (terms.length !== 1) return null;
  const [, count, keep] = terms[0];
  const faces = d20[0].values;
  if (!faces.every((face) => Number.isInteger(face) && face >= 1 && face <= 20)) return null;
  if (count === "1" && !keep && faces.length === 1) return faces[0];
  if (count === "2" && faces.length === 2) {
    if (keep?.toLowerCase() === "kh1") return Math.max(...faces);
    if (keep?.toLowerCase() === "kl1") return Math.min(...faces);
  }
  return null;
}

export function classifyRoll(notation: string, detail: RollDetail[], total: number): RollVariant {
  if (!Number.isFinite(total)) return "normal";
  const natural = selectedD20Face(notation, detail);
  if (natural === null) return "normal";
  if (natural === 20) return "natural20";
  if (natural === 1) return "natural1";
  if (total === 20) return "dirty20";
  if (total === 1) return "dirty1";
  if (total > 20) return "high";
  return "normal";
}

export function bannerForRoll(row: RollBannerInput): { message: string; variant: RollVariant } {
  return {
    message: `🎲 ${row.actorName}: ${row.notation} = ${row.total}`,
    variant: classifyRoll(row.notation, row.detail, row.total),
  };
}
