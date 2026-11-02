import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldRevealTokenStats } from "../src/lib/scene/combatVisuals.ts";

test("visible tokens display HP and AC in exploration, including NPCs", () => {
  for (const isDM of [true, false]) {
    for (const isPlayerToken of [true, false]) {
      assert.equal(shouldRevealTokenStats("exploration", isDM, isPlayerToken), true);
    }
  }
});

test("combat stats remain visible regardless of ownership", () => {
  for (const isDM of [true, false]) {
    for (const isPlayerToken of [true, false]) {
      assert.equal(shouldRevealTokenStats("combat", isDM, isPlayerToken), true);
    }
  }
});
