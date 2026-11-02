import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeDiceBoxResults, rollWithout3D } from "../src/lib/dice/rollResults.ts";

test("flat DiceBox v1 {type:d20,value} result stays a 17, not zero", () => {
  const groups = [{qty: 1, sides: 20, mods: []}];
  const result = normalizeDiceBoxResults(groups, [{type:"d20",value:17}]);
  assert.deepEqual(result.bySides.get(20).map((die) => die.value), [17]);
  assert.equal(result.groups[0].rolls[0].value, 17);
  assert.equal(result.groups[0].rolls[0].groupId, 0);
});

test("wrapped DiceBox response with grouped faces preserves the exact values", () => {
  const groups = [{qty: 2, sides: 6, mods: []}];
  const result = normalizeDiceBoxResults(groups, {rolls:[{
    qty: 2, sides: 6, groupId: 0,
    rolls: [{sides:6,groupId:0,rollId:0,value:4},{sides:6,groupId:0,rollId:1,value:5}],
  }]});
  assert.deepEqual(result.bySides.get(6).map((r) => r.value), [4,5]);
  assert.equal(result.groups[0].rolls.length, 2);
});

test("advantage dice are retained separately and support the higher-of-two rule", () => {
  const groups = [{qty:2,sides:20,mods:[{type:"keep"}]}];
  const result = normalizeDiceBoxResults(groups,[{type:"d20",value:1},{type:"d20",value:15}]);
  assert.equal(Math.max(...result.bySides.get(20).map((r)=>r.value)),15);
  assert.deepEqual(result.groups[0].mods, groups[0].mods);
});

test("a real zero after negative modifier remains legitimate", () => {
  const result = normalizeDiceBoxResults([{qty:1,sides:4,mods:[]}],[{type:"d4",value:4}]);
  assert.equal(result.bySides.get(4)[0].value - 4, 0);
});

test("never pass missing/invalid/partial physics results to the parser", () => {
  const groups = [{qty:2,sides:20,mods:[]}];
  for(const invalid of [
    [], {rolls:[]}, [{type:"d20",value:0}], [{type:"d20",value:25}],
    [{type:"d20",value:10}], [{type:"d6",value:10}],
    [{type:"d20",value:undefined}], null,
  ]) assert.throws(()=>normalizeDiceBoxResults(groups,invalid));
});

test("2D fallback uses valid bounded faces and preserves the number of dice", () => {
  const groups = [{qty:2,sides:6,mods:[]},{qty:1,sides:20,mods:[]}];
  // 4294967295 must be rejected for d6 to avoid modulo bias.
  const values = [5,4294967295,13,29];
  const fallback = rollWithout3D(groups,()=>values.shift());
  const result = normalizeDiceBoxResults(groups,fallback);
  assert.deepEqual(result.bySides.get(6).map((r)=>r.value),[6,2]);
  assert.deepEqual(result.bySides.get(20).map((r)=>r.value),[10]);
});

test("group-aware mapping handles mixed dice sides with stable order",()=>{
  const groups = [{qty:1,sides:20,mods:[]},{qty:2,sides:6,mods:[]}];
  const result=normalizeDiceBoxResults(groups,[
    {type:"d6",value:2},{type:"d20",value:19},{type:"d6",value:3},
  ]);
  assert.deepEqual(result.bySides.get(20).map((r)=>r.value),[19]);
  assert.deepEqual(result.bySides.get(6).map((r)=>r.value),[2,3]);
});
