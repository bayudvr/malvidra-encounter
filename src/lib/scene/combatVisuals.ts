/**
 * Combatants persist after combat ends so that HP, AC and conditions are not
 * lost. The token HUD, however, is a combat-only presentation.
 *
 * Only the DM can see NPC battle stats. Player battle stats remain visible
 * to participants during combat, matching existing visibility rules.
 */
export function shouldRevealTokenStats(
  sceneMode: "exploration" | "combat",
  isDM: boolean,
  combatantIsPlayer: boolean,
): boolean {
  return sceneMode === "combat" && (isDM || combatantIsPlayer);
}
