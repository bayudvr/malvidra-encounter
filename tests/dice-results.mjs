import assert from "node:assert/strict";
import { test } from "node:test";
// The published package has extensionless ESM re-exports that plain Node 22 cannot resolve.
// Import its real implementation directly for regression tests (Next bundles the normal entry in-app).
import DiceParser from "@3d-dice/dice-parser-interface/src/ParserInterface.js";
import { normalizeDiceBoxResults, rollWithout3D } from "../src/lib/dice/rollResults.ts";

const dp = () => new DiceParser();

test("flat DiceBox v1 {type:d20,value} result stays a 17, not zero", () => {
  const parser = dp();
  const notation = parser.parseNotation("1d20");
  const matched = normalizeDiceBoxResults(notation, [{ type: "d20", value: 17 }]);
  assert.equal(matched.bySides.get(20)[0].value, 17);
  assert.equal(parser.parseFinalResults(matched.groups).value, 17);
});

test("grouped DiceBox result retains faces and additive modifier", () => {
  const parser = dp();
  const notation = parser.parseNotation("2d6 + 3");
  const result = normalizeDiceBoxResults(notation, [{
    qty: 2, sides: 6, groupId: 0,
    rolls: [{ sides: 6, groupId: 0, rollId: 0, value: 4 },
      { sides: 6, groupId: 0, rollId: 1, value: 5 }],
  }]);
  assert.deepEqual(result.bySides.get(6).map((r) => r.value), [4, 5]);
  assert.equal(parser.parseFinalResults(result.groups).value, 12);
});

test("advantage uses the higher d20; valid natural 1 is never changed to zero", () => {
  const parser = dp();
  const notation = parser.parseNotation("2d20kh1");
  const result = normalizeDiceBoxResults(notation, [
    { type: "d20", value: 1 }, { type: "d20", value: 15 },
  ]);
  assert.equal(parser.parseFinalResults(result.groups).value, 15);
});

test("a real zero total after negative modifier remains valid", () => {
  const parser = dp();
  const notation = parser.parseNotation("1d4 - 4");
  const result = normalizeDiceBoxResults(notation, [{ type: "d4", value: 4 }]);
  assert.equal(parser.parseFinalResults(result.groups).value, 0);
});

test("never convert missing/invalid/partial physics results into logged zero", () => {
  const groups = [{ qty: 2, sides: 20, mods: [] }];
  for (const bad of [[], { rolls: [] }, [{type:"d20",value:0}], [{type:"d20",value:25}],
    [{type:"d20",value:10}], [{type:"d6",value:10}], [{type:"d20",value:undefined}], null]) {
    assert.throws(() => normalizeDiceBoxResults(groups, bad));
  }
});

test("fallback produces bounded real faces and correct counts", () => {
  const groups = [{ qty: 2, sides: 6, mods: [] }, { qty: 1, sides: 20, mods: [] }];
  const values = [5, 4294967295, 13, 29];
  const out = rollWithout3D(groups, () => values.shift());
  const normalized = normalizeDiceBoxResults(groups, out);
  assert.deepEqual(normalized.bySides.get(6).map((r) => r.value), [6, 2]);
  assert.deepEqual(normalized.bySides.get(20).map((r) => r.value), [10]);
});
