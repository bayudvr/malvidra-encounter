import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bannerForRoll,
  classifyRoll,
  selectedD20Face,
  ROLL_BANNER_TITLES,
} from "../src/lib/dice/rollBanner.ts";

const d20 = (...values) => [{ sides: 20, values }];

test("natural 20 and natural 1 override modifiers and final totals", () => {
  assert.equal(classifyRoll("1d20 - 5", d20(20), 15), "natural20");
  assert.equal(classifyRoll("1d20 + 30", d20(1), 31), "natural1");
  assert.equal(ROLL_BANNER_TITLES.natural20, "NATURAL 20!");
  assert.equal(ROLL_BANNER_TITLES.natural1, "NATURAL 1!");
});

test("only the KEPT advantage or disadvantage d20 can be natural", () => {
  assert.equal(selectedD20Face("2d20kh1 + 4", d20(20, 8)), 20);
  assert.equal(classifyRoll("2d20kh1 + 4", d20(20, 8), 24), "natural20");
  assert.equal(selectedD20Face("2d20kl1", d20(20, 8)), 8);
  assert.equal(classifyRoll("2d20kl1", d20(20, 8), 8), "normal");
  assert.equal(classifyRoll("2d20kh1", d20(1, 17), 17), "normal");
  assert.equal(classifyRoll("2d20kl1", d20(1, 17), 1), "natural1");
  assert.equal(classifyRoll("2d20kh1", d20(1, 20), 20), "natural20");
});

test("dirty twenties and dirty ones are totals, not natural faces", () => {
  assert.equal(classifyRoll("1d20 + 3", d20(17), 20), "dirty20");
  assert.equal(classifyRoll("1d20 - 1", d20(2), 1), "dirty1");
  assert.equal(classifyRoll("2d20kh1 + 3", d20(11, 17), 20), "dirty20");
  assert.equal(classifyRoll("1d20", d20(20), 20), "natural20");
  assert.equal(classifyRoll("1d20", d20(1), 1), "natural1");
});

test("high roll follows the TOTAL including Guidance, Bardic dice and modifier", () => {
  const mixed = [{ sides: 4, values: [3] }, { sides: 6, values: [4] }, ...d20(17)];
  assert.equal(classifyRoll("1d4 + 1d6 + 1d20 + 2", mixed, 26), "high");
  assert.equal(classifyRoll("1d20 + 3", d20(19), 22), "high");
  assert.equal(classifyRoll("1d20 + 3", d20(16), 19), "normal");
  assert.equal(classifyRoll("1d20 + 1d4", [{ sides: 4, values: [1] }, ...d20(19)], 20), "dirty20");
});

test("never invent a natural from unmatched or discarded dice", () => {
  assert.equal(classifyRoll("2d20", d20(20, 1), 21), "normal");
  assert.equal(classifyRoll("3d20", d20(20, 1, 12), 33), "normal");
  assert.equal(classifyRoll("2d20kh1", d20(20), 20), "normal");
  assert.equal(classifyRoll("1d20", d20(21), 21), "normal");
  assert.equal(classifyRoll("6d6", [{ sides: 6, values: [6, 6, 6, 6, 6, 6] }], 36), "normal");
  assert.equal(classifyRoll("1d20", d20(20), Number.NaN), "normal");
});

test("banner includes the roller, notation, computed total and appearance", () => {
  const banner = bannerForRoll({
    actorName: "Vaeil", notation: "1d20 + 3", detail: d20(17), total: 20,
  });
  assert.equal(banner.variant, "dirty20");
  assert.match(banner.message, /Vaeil.*1d20 \+ 3 = 20/);
});
