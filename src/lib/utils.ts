export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Deterministic color from an arbitrary string (used for token/combatant tint). */
export function colorFromString(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = input.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 65% 55%)`;
}

export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Up to 4 uppercase letters representing a token's name, for its avatar
 * when it has no image: one letter per word for multi-word names (e.g.
 * "Bandit Captain Vex" -> "BCV"), or the first 4 letters of a single-word
 * name (e.g. "Goblin" -> "GOBL").
 */
export function tokenInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return words
      .slice(0, 4)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("");
  }
  return (words[0] ?? "").slice(0, 4).toUpperCase();
}
