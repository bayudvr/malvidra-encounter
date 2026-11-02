/**
 * HP, AC and conditions are relevant outside combat (traps, falling, hazards).
 * The caller already filters hidden tokens; this is only a display decision,
 * not a substitute for database RLS or hidden-token checks.
 *
 * Do not hide visible NPC stats or exploration stats from participants.
 */
export function shouldRevealTokenStats(
  sceneMode: "exploration" | "combat",
  isDM: boolean,
  combatantIsPlayer: boolean,
): boolean {
  // Kept in the signature for compatibility with other call sites.
  void sceneMode;
  void isDM;
  void combatantIsPlayer;
  return true;
}
