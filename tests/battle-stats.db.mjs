// Isolated battle-stat and scene-continuity regression test. No production credentials.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const dm = randomUUID(), pc = randomUUID(), other = randomUUID(), stranger = randomUUID();
const room = randomUUID(), sceneA = randomUUID(), sceneB = randomUUID(), asset = randomUUID();
const row = async (sql, args=[]) => (await db.query(sql,args)).rows[0];
const denied = async (sql,args=[]) => assert.rejects(db.query(sql,args));
async function as(user, role="authenticated") {
  await db.exec(`reset role; set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
}
async function load(file) {
  const sql = readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),"utf8")
    .replace("create extension if not exists pgcrypto;", "");
  await db.exec(sql);
}

try {
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated;
    create function public.gen_random_bytes(integer) returns bytea language sql as
      $$select decode(repeat('ab',$1),'hex')$$;
    create function public.cast_room_id() returns uuid language sql as $$select null::uuid$$;
    create publication supabase_realtime;
  `);
  for (const file of [
    "0001_init.sql","0002_combat_tokens_realtime.sql","0008_optional_token_image.sql",
    "0009_token_dnd_sizes.sql","0015_token_battle_stats.sql",
    "0017_token_vision.sql","0021_token_counters.sql",
    "0023_seed_combatants_skip_hidden.sql","0026_asset_owner.sql",
    "0031_cross_scene_token_state.sql","0032_harden_state_rpc_permissions.sql",
    "20261102010000_token_battle_stat_editor.sql",
    "20261102013000_pull_latest_token_state.sql",
  ]) await load(file);
  await db.exec(`
    grant select,insert,update,delete on all tables in schema public to authenticated;
    insert into auth.users(id,email) values
      ('${dm}','dm@test'),('${pc}','pc@test'),('${other}','other@test'),('${stranger}','stranger@test');
    insert into public.rooms(id,name,dm_id,invite_code) values('${room}','Encounter','${dm}','ENCOUNTR');
    insert into public.room_members(room_id,user_id,role) values
      ('${room}','${dm}','dm'),('${room}','${pc}','player'),('${room}','${other}','player');
    insert into public.scenes(id,room_id,name) values('${sceneA}','${room}','First');
  `);
  await db.query("insert into public.scenes(id,room_id,name) values($1,$2,'Next')",[sceneB,room]);
  await db.query(
    "insert into public.assets(id,room_id,name,owner_user_id,hp,ac,carry_state) values($1,$2,'Hero',$3,20,14,true)",
    [asset,room,pc]
  );
  await as(dm);
  const original = await row("select * from public.spawn_asset_token($1,$2,70::float8,70::float8)",[sceneA,asset]);
  await db.query("update public.tokens set is_hidden=false where id=$1",[original.id]);
  await db.query("select public.seed_scene_combatants($1)",[sceneA]);
  const c = await row("select * from public.combatants where token_id=$1",[original.id]);
  assert.equal(c.hp,20); assert.equal(c.ac,14);

  await as(pc);
  for (const [field,value] of [["hp",7],["max_hp",25],["ac",17],["temp_hp",3]]) {
    await db.query("select public.set_token_battle_stat($1,$2,$3)",[original.id,field,value]);
  }
  const actual = await row("select hp,max_hp,ac,temp_hp from public.combatants where id=$1",[c.id]);
  assert.deepEqual(actual,{hp:7,max_hp:25,ac:17,temp_hp:3});
  assert.deepEqual(await row("select hp,ac from public.tokens where id=$1",[original.id]),{hp:25,ac:17});
  await denied("select public.set_token_battle_stat($1,'hp',-1)",[original.id]);
  await denied("select public.set_token_battle_stat($1,'ac',100000)",[original.id]);

  await as(other);
  await denied("select public.set_token_battle_stat($1,'ac',18)",[original.id]);
  await as(stranger);
  await denied("select public.set_token_battle_stat($1,'hp',10)",[original.id]);
  await as(stranger,"anon");
  await denied("select public.set_token_battle_stat($1,'ac',12)",[original.id]);

  await as(dm);
  const continued = await row("select * from public.spawn_asset_token($1,$2,90::float8,90::float8)",[sceneB,asset]);
  const carried = await row("select hp,max_hp,temp_hp,ac,is_hidden from public.combatants where token_id=$1",[continued.id]);
  assert.deepEqual(carried,{hp:7,max_hp:25,temp_hp:3,ac:17,is_hidden:true});
  assert.equal(continued.hp,25); assert.equal(continued.ac,17);

  // The new owner may edit immediately, and the prior owner loses access.
  await db.query("update public.tokens set owner_user_id=$1 where id=$2",[other,original.id]);
  assert.deepEqual(await row("select user_id,is_player from public.combatants where id=$1",[c.id]),
    {user_id:other,is_player:true});
  await as(pc);
  await denied("select public.set_token_battle_stat($1,'hp',5)",[original.id]);
  await as(other);
  await db.query("select public.set_token_battle_stat($1,'hp',5)",[original.id]);
  assert.equal((await row("select hp from public.combatants where id=$1",[c.id])).hp,5);

  // Pre-combat stats can be set by an owning player, even before a combatant exists.
  await as(pc);
  await db.query("select public.set_token_battle_stat($1,'ac',19)",[continued.id]);
  assert.equal((await row("select ac from public.tokens where id=$1",[continued.id])).ac,19);
  await as(dm);
  await db.query("update public.tokens set is_hidden=false where id=$1",[continued.id]);
  // The carried combatant is the source of truth, so pre-combat here is not applicable.
  assert.equal((await row("select ac from public.combatants where token_id=$1",[continued.id])).ac,19);

  // A token without a combatant gets its HP/AC edited directly.
  const freshAsset = randomUUID();
  await db.query("insert into public.assets(id,room_id,name,owner_user_id,hp,ac) values($1,$2,'New Hero',$3,10,10)",[freshAsset,room,pc]);
  const fresh = await row("select * from public.spawn_asset_token($1,$2,0::float8,0::float8)",[sceneB,freshAsset]);
  await as(pc);
  await db.query("select public.set_token_battle_stat($1,'hp',12)",[fresh.id]);
  await db.query("select public.set_token_battle_stat($1,'ac',16)",[fresh.id]);
  assert.deepEqual(await row("select hp,ac from public.tokens where id=$1",[fresh.id]),{hp:12,ac:16});
  await denied("select public.set_token_battle_stat($1,'temp_hp',2)",[fresh.id]);
  await as(dm);
  await db.query("update public.tokens set is_hidden=false where id=$1",[fresh.id]);
  await db.query("select public.seed_scene_combatants($1)",[sceneB]);
  assert.deepEqual(await row("select hp,max_hp,ac from public.combatants where token_id=$1",[fresh.id]),
    {hp:12,max_hp:12,ac:16});

  // A player must not pull from a source now owned by somebody else.
  await as(pc);
  assert.equal((await row("select public.pull_latest_token_state($1) as status",[continued.id])).status,"no_source");

  // Restore ownership so this character's previous scene can be synced.
  await as(dm);
  await db.query("update public.tokens set owner_user_id=$1 where id=$2",[pc,original.id]);
  // Manual pull updates an existing scene token, not its position or owner.
  await db.query("insert into public.token_counters(token_id,room_id,name,current,max) values($1,$2,'Uses',2,5)",[original.id,room]);
  await db.query("insert into public.token_counters(token_id,room_id,name,current,max) values($1,$2,'Stale',1,1)",[continued.id,room]);
  await db.query("update public.tokens set state_changed_at=clock_timestamp() - interval '1 day' where id=$1",[continued.id]);
  for (const [field,value] of [["hp",4],["max_hp",23],["ac",18],["temp_hp",2]]) {
    await db.query("select public.set_token_battle_stat($1,$2,$3)",[original.id,field,value]);
  }
  await db.query("update public.combatants set conditions=array['Poisoned'] where id=$1",[c.id]);
  const beforePull = await row("select x,y,owner_user_id,is_hidden from public.tokens where id=$1",[continued.id]);
  await as(pc);
  assert.equal((await row("select public.pull_latest_token_state($1) as status",[continued.id])).status,"updated");
  assert.deepEqual(await row("select hp,max_hp,temp_hp,ac,conditions,is_hidden from public.combatants where token_id=$1",[continued.id]),
    {hp:4,max_hp:23,temp_hp:2,ac:18,conditions:["Poisoned"],is_hidden:beforePull.is_hidden});
  assert.deepEqual(await row("select hp,ac from public.tokens where id=$1",[continued.id]),{hp:23,ac:18});
  assert.deepEqual(await row("select x,y,owner_user_id,is_hidden from public.tokens where id=$1",[continued.id]),beforePull);
  // DM-only counters are copied through the RPC but remain private from players.
  assert.equal((await row("select count(*)::int as n from public.token_counters where token_id=$1",[continued.id])).n,0);
  await as(dm);
  assert.deepEqual(await row("select name,current,max from public.token_counters where token_id=$1",[continued.id]),
    {name:"Uses",current:2,max:5});
  await as(pc);
  assert.equal((await row("select public.pull_latest_token_state($1) as status",[continued.id])).status,"up_to_date");
  await db.query("select public.set_token_battle_stat($1,'hp',9)",[continued.id]);
  assert.equal((await row("select public.pull_latest_token_state($1) as status",[continued.id])).status,"up_to_date");
  assert.equal((await row("select hp from public.combatants where token_id=$1",[continued.id])).hp,9);

  await as(other);
  await denied("select public.pull_latest_token_state($1)",[continued.id]);
  await as(stranger);
  await denied("select public.pull_latest_token_state($1)",[continued.id]);
  await as(stranger,"anon");
  await denied("select public.pull_latest_token_state($1)",[continued.id]);

  await as(dm);
  await db.query("update public.assets set carry_state=true where id=$1",[freshAsset]);
  assert.equal((await row("select public.pull_latest_token_state($1) as status",[fresh.id])).status,"no_source");
  await db.query("update public.assets set carry_state=false where id=$1",[asset]);
  await denied("select public.pull_latest_token_state($1)",[continued.id]);
  await db.query("update public.assets set carry_state=true where id=$1",[asset]);
  console.log("Battle stat ownership, synchronization and scene continuity regression tests passed.");
} finally {
  await db.close();
}
