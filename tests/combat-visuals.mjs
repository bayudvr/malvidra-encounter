import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldRevealTokenStats } from "../src/lib/scene/combatVisuals.ts";

test("ending combat hides the HP/AC token HUD for DM and players", () => {
  assert.equal(shouldRevealTokenStats("exploration", true, true), false);
  assert.equal(shouldRevealTokenStats("exploration", false, true), false);
  assert.equal(shouldRevealTokenStats("exploration", true, false), false);
  assert.equal(shouldRevealTokenStats("exploration", false, false), false);
});

test("combat preserves the existing viewer-specific HUD permissions", () => {
  assert.equal(shouldRevealTokenStats("combat", true, true), true);
  assert.equal(shouldRevealTokenStats("combat", true, false), true);
  assert.equal(shouldRevealTokenStats("combat", false, true), true);
  assert.equal(shouldRevealTokenStats("combat", false, false), false);
});
