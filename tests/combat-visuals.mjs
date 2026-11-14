import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldRevealTokenStats } from "../src/lib/scene/combatVisuals.ts";

for (const mode of ["exploration", "combat"]) {
  test(`${mode}: DM can see every token's stats`, () => {
    for (const owned of [true, false]) assert.equal(shouldRevealTokenStats(mode, true, owned), true);
  });
  test(`${mode}: a player sees only their own token's stats`, () => {
    assert.equal(shouldRevealTokenStats(mode, false, true), true);
    assert.equal(shouldRevealTokenStats(mode, false, false), false);
  });
}
