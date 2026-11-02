/**
 * DiceBox v1 can return group results ({ rolls: [...] }) or flattened
 * physics results ({ type: "d20", value: 17 }). Never silently pass missing
 * dice to dice-parser-interface: it can produce an incorrect zero.
 */
export type ParsedDiceGroup = {
  qty: number;
  sides: number | string;
  rolls?: unknown[];
  [key: string]: unknown;
};

export type ValidDie = { sides: number; value: number; groupId: number; rollId: number };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sidesOf(value: Record<string, unknown>): number | null {
  const raw = value.sides ?? value.type;
  const n = typeof raw === "string" && /^d\d+$/i.test(raw)
    ? Number(raw.slice(1))
    : typeof raw === "number" || typeof raw === "string" ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 2 ? n : null;
}

function physicalRolls(raw: unknown): {
  sides: number | null; value: number; groupId: number | null; original: Record<string, unknown>;
}[] {
  const list = Array.isArray(raw) ? raw : object(raw)?.rolls;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("DiceBox returned no dice");
  }
  const flat: { sides: number | null; value: number; groupId: number | null; original: Record<string, unknown> }[] = [];
  for (const [index, entry] of list.entries()) {
    const item = object(entry);
    if (!item) throw new Error("Invalid die result");
    const nested = Array.isArray(item.rolls) ? item.rolls : [item];
    for (const die of nested) {
      const value = object(die);
      if (!value) throw new Error("Invalid die result");
      const v = value.value ?? value.result;
      if (typeof v !== "number" || !Number.isInteger(v)) throw new Error("Die did not settle to a valid face");
      const groupId = Number.isInteger(value.groupId) ? Number(value.groupId)
        : Number.isInteger(item.groupId) ? Number(item.groupId)
        : Array.isArray(item.rolls) ? index : null;
      flat.push({
        sides: sidesOf(value) ?? sidesOf(item),
        value: v,
        groupId,
        original: value,
      });
    }
  }
  return flat;
}

export function normalizeDiceBoxResults(groups: ParsedDiceGroup[], raw: unknown): {
  groups: ParsedDiceGroup[];
  bySides: Map<number, { sides: number; value: number }[]>;
} {
  if (groups.length === 0) throw new Error("No dice groups");
  let expected = 0;
  for (const group of groups) {
    const sides = sidesOf(group);
    if (!sides || !Number.isInteger(group.qty) || group.qty < 1) {
      throw new Error("Invalid dice notation");
    }
    expected += group.qty;
  }
  if (expected > 40) throw new Error("Maximum 40 dice per roll");
  const dice = physicalRolls(raw);
  if (dice.length !== expected) {
    throw new Error(`Incomplete dice result: got ${dice.length} of ${expected}`);
  }

  const copied = groups.map((group, index) => ({
    ...group,
    groupId: Number.isInteger(group.groupId) ? group.groupId : index,
    rolls: [] as ValidDie[],
  }));
  for (const die of dice) {
    // groupId is authoritative for grouped DiceBox responses; flat responses
    // can only be allocated by side count and remaining quantity.
    let target = die.groupId == null ? -1 : copied.findIndex((g) => Number(g.groupId) === die.groupId);
    if (target < 0 || copied[target].rolls.length >= copied[target].qty
      || Number(copied[target].sides) !== die.sides) {
      target = copied.findIndex((g) => Number(g.sides) === die.sides && g.rolls.length < g.qty);
    }
    if (target < 0 || die.sides === null || die.value < 1 || die.value > die.sides) {
      throw new Error("DiceBox returned an invalid or unmatched face");
    }
    const rollId = copied[target].rolls.length;
    copied[target].rolls.push({
      ...die.original, sides: die.sides, value: die.value,
      groupId: Number(copied[target].groupId), rollId,
    } as ValidDie);
  }
  if (copied.some((g) => g.rolls.length !== g.qty)) {
    throw new Error("Dice result is incomplete");
  }
  const bySides = new Map<number, { sides: number; value: number }[]>();
  for (const group of copied) {
    for (const r of group.rolls) {
      const values = bySides.get(r.sides) ?? [];
      values.push({ sides: r.sides, value: r.value });
      bySides.set(r.sides, values);
    }
  }
  return { groups: copied, bySides };
}

/** Unbiased OS-backed fallback, only used when 3D rendering fails. */
export function rollWithout3D(groups: ParsedDiceGroup[], randomUint32: () => number): ParsedDiceGroup[] {
  return groups.map((g, groupId) => {
    const sides = sidesOf(g);
    if (!sides || !Number.isInteger(g.qty) || g.qty < 1 || g.qty > 40) {
      throw new Error("Invalid fallback dice");
    }
    const limit = Math.floor(0x100000000 / sides) * sides;
    const rolls: ValidDie[] = [];
    for (let i = 0; i < g.qty; i++) {
      let n: number;
      do { n = randomUint32(); } while (n >= limit);
      rolls.push({ sides, value: (n % sides) + 1, groupId, rollId: i });
    }
    return { ...g, groupId, rolls };
  });
}
