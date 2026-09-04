import { colorFromString } from "@/lib/utils";

/** Common D&D 5e conditions — code + colour for the token ring. */
export const CONDITION_PRESETS: {
  name: string;
  code: string;
  color: string;
}[] = [
  { name: "Blinded", code: "BL", color: "#64748b" },
  { name: "Charmed", code: "CH", color: "#ec4899" },
  { name: "Concentration", code: "CN", color: "#22d3ee" },
  { name: "Deafened", code: "DF", color: "#78716c" },
  { name: "Frightened", code: "FR", color: "#a855f7" },
  { name: "Grappled", code: "GR", color: "#b45309" },
  { name: "Incapacitated", code: "IN", color: "#6b7280" },
  { name: "Invisible", code: "IV", color: "#38bdf8" },
  { name: "Paralyzed", code: "PA", color: "#dc2626" },
  { name: "Petrified", code: "PE", color: "#57534e" },
  { name: "Poisoned", code: "PO", color: "#16a34a" },
  { name: "Prone", code: "PR", color: "#eab308" },
  { name: "Restrained", code: "RE", color: "#ea580c" },
  { name: "Stunned", code: "ST", color: "#f97316" },
  { name: "Unconscious", code: "UN", color: "#991b1b" },
  { name: "Exhaustion", code: "EX", color: "#7c2d12" },
];

const byName = new Map(
  CONDITION_PRESETS.map((c) => [c.name.toLowerCase(), c]),
);

export function conditionColor(name: string) {
  return byName.get(name.toLowerCase())?.color ?? colorFromString(name);
}

export function conditionCode(name: string) {
  const preset = byName.get(name.toLowerCase());
  if (preset) return preset.code;
  return name.slice(0, 2).toUpperCase();
}
