/** Display permission only; hidden-token access is handled separately. */
export function shouldRevealTokenStats(
  sceneMode: "exploration" | "combat",
  isDM: boolean,
  ownsToken: boolean,
): boolean {
  void sceneMode;
  return isDM || ownsToken;
}
