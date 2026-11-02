// Isolated Postgres group tests; uses no production secrets.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const dm=randomUUID(), player=randomUUID(), foreignDm=randomUUID();
const room=randomUUID(), foreignRoom=randomUUID(), scene=randomUUID(), asset=randomUUID(), foreignAsset=randomUUID();
async function as(id) { await db.exec("reset role; set role authenticated"); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); }
const q = async (sql,args=[]) => (await db.query(sql,args)).rows;
async function load(name) { await db.exec(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url),"utf8").replace("create extension if not exists pgcrypto;", "")); }
try {
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;
    create function public.gen_random_bytes(integer) returns bytea language sql as $$select decode(repeat('ab',$1),'hex')$$;
    create function public.cast_room_id() returns uuid language sql as $$select null::uuid$$;
    create publication supabase_realtime;
  `);
  for (const f of [
    "0001_init.sql","0002_combat_tokens_realtime.sql","0008_optional_token_image.sql",
    "0009_token_dnd_sizes.sql","0015_token_battle_stats.sql","0017_token_vision.sql",
    "0021_token_counters.sql","0023_seed_combatants_skip_hidden.sql","0026_asset_owner.sql",
    "0031_cross_scene_token_state.sql","0032_harden_state_rpc_permissions.sql",
    "20261102020000_token_groups.sql",
    "20261102023000_force_view_sync.sql",
  ]) await load(f);
  await db.exec(`
    grant select,insert,update,delete on all tables in schema public to authenticated;
    insert into auth.users(id,email) values ('${dm}','dm'),('${player}','player'),('${foreignDm}','other');
    insert into public.rooms(id,name,dm_id,invite_code) values
      ('${room}','One','${dm}','ROOMONE'),('${foreignRoom}','Two','${foreignDm}','ROOMTWO');
    insert into public.room_members(room_id,user_id,role) values
      ('${room}','${dm}','dm'),('${room}','${player}','player'),('${foreignRoom}','${foreignDm}','dm');
    insert into public.scenes(id,room_id,name) values ('${scene}','${room}','Battle');
    insert into public.assets(id,room_id,name,hp,ac,image_url) values
      ('${asset}','${room}','Goblin',11,13,null),('${foreignAsset}','${foreignRoom}','Bad',3,10,null);
  `);
  await as(dm);
  const g=(await q("insert into public.token_groups(room_id,name) values($1,'Ambush') returning *",[room]))[0];
  await q("insert into public.token_group_items(room_id,group_id,asset_id,quantity) values($1,$2,$3,3)",[room,g.id,asset]);
  await assert.rejects(q("insert into public.token_group_items(room_id,group_id,asset_id) values($1,$2,$3)",[room,g.id,foreignAsset]));
  const count=await q("select public.deploy_token_group($1,$2) as deployed",[g.id,scene]);
  assert.equal(count[0].deployed,3);
  const rows=await q("select hp,ac,is_hidden,scene_id from public.tokens where scene_id=$1 order by x",[scene]);
  assert.deepEqual(rows.map(r=>[r.hp,r.ac,r.is_hidden,r.scene_id]),Array(3).fill([11,13,true,scene]));
  const previous=rows.length;
  await as(player);
  assert.equal((await q("select * from public.token_groups")).length,0);
  assert.equal((await q("select force_view_sync from public.rooms where id=$1",[room]))[0].force_view_sync,false);
  assert.equal((await q("update public.rooms set force_view_sync=true where id=$1 returning id",[room])).length,0);
  await as(dm);
  await q("update public.rooms set force_view_sync=true where id=$1",[room]);
  assert.equal((await q("select force_view_sync from public.rooms where id=$1",[room]))[0].force_view_sync,true);
  await as(player);
  await assert.rejects(q("select public.deploy_token_group($1,$2)",[g.id,scene]));
  await assert.rejects(q("insert into public.token_groups(room_id,name) values($1,'Hacked')",[room]));
  await as(foreignDm);
  await assert.rejects(q("select public.deploy_token_group($1,$2)",[g.id,scene]));
  await as(dm);
  await assert.rejects(q("update public.token_group_items set quantity=41 where group_id=$1",[g.id]));
  assert.equal((await q("select count(*)::int as n from public.tokens where scene_id=$1",[scene]))[0].n,previous);
  await q("delete from public.token_groups where id=$1",[g.id]);
  assert.equal((await q("select count(*)::int as n from public.tokens where scene_id=$1",[scene]))[0].n,previous);
  console.log("Token group RLS, atomic deployment and cascade-preservation checks passed.");
} finally { await db.close(); }
