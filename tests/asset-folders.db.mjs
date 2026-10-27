// Real Postgres constraints and RLS in isolation; never loads live credentials.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const dm = randomUUID(), otherDm = randomUUID(), player = randomUUID(), outsider = randomUUID();
const room = randomUUID(), otherRoom = randomUUID();
const folder = randomUUID(), foreignFolder = randomUUID(), asset = randomUUID(), scene = randomUUID(), token = randomUUID();
const migration = "20261027071825_token_asset_folders.sql";
let checks = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const row = async (sql, values = []) => (await db.query(sql, values)).rows[0];
const denied = async (sql, values = []) => { await assert.rejects(db.query(sql, values)); checks++; };
async function as(user, role = "authenticated") {
  await db.exec(`reset role; set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
}
async function load(file) {
  const sql = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8")
    .replace("create extension if not exists pgcrypto;", "");
  await db.exec(sql);
}

try {
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated;
    create function public.gen_random_bytes(integer) returns bytea language sql as $$select decode(repeat('ab',$1),'hex')$$;
    create publication supabase_realtime;
  `);
  await load("0001_init.sql");
  await load("0008_optional_token_image.sql");
  await db.exec(`
    grant select,insert,update,delete on all tables in schema public to authenticated;
    insert into auth.users(id,email) values('${dm}','dm@test'),('${otherDm}','other@test'),('${player}','player@test'),('${outsider}','outsider@test');
    insert into public.rooms(id,name,dm_id,invite_code) values('${room}','Room A','${dm}','ROOMA'),('${otherRoom}','Room B','${otherDm}','ROOMB');
    insert into public.room_members(room_id,user_id,role) values('${room}','${dm}','dm'),('${room}','${player}','player'),('${otherRoom}','${otherDm}','dm');
    insert into public.assets(id,room_id,name,image_url) values('${asset}','${room}','Goblin','https://example.test/goblin.png');
    insert into public.scenes(id,room_id,name) values('${scene}','${room}','Map');
    insert into public.tokens(id,room_id,scene_id,asset_id,label,x,y) values('${token}','${room}','${scene}','${asset}','Goblin',140,210);
  `);
  await load(migration);
  await load(migration); // replay must preserve existing installations
  equal((await row("select folder_id from public.assets where id=$1", [asset])).folder_id, null);
  equal((await row("select relrowsecurity as enabled from pg_class where oid='public.asset_folders'::regclass")).enabled, true);
  await as(dm);
  await db.query("insert into public.asset_folders(id,room_id,name) values($1,$2,'Monsters')", [folder, room]);
  equal((await row("select name from public.asset_folders where id=$1", [folder])).name, "Monsters");
  await denied("insert into public.asset_folders(room_id,name) values($1,'monsters')", [room]);
  await denied("insert into public.asset_folders(room_id,name) values($1,'   ')", [room]);
  await denied("insert into public.asset_folders(room_id,name) values($1,' Untrimmed ')", [room]);
  await denied("insert into public.asset_folders(room_id,name) values($1,$2)", [room, "A".repeat(81)]);
  await db.query("update public.assets set folder_id=$1 where id=$2", [folder, asset]);
  equal((await row("select folder_id from public.assets where id=$1", [asset])).folder_id, folder);
  await db.query("update public.asset_folders set name='Enemies' where id=$1", [folder]);
  equal((await row("select folder_id from public.assets where id=$1", [asset])).folder_id, folder);
  await db.query("update public.assets set folder_id=null where id=$1", [asset]);
  equal((await row("select folder_id from public.assets where id=$1", [asset])).folder_id, null);
  await as(otherDm);
  await db.query("insert into public.asset_folders(id,room_id,name) values($1,$2,'Enemies')", [foreignFolder, otherRoom]);
  equal((await db.query("select id from public.asset_folders")).rows.map((f) => f.id), [foreignFolder]);
  await as(dm);
  // Composite FK also blocks cross-room assignment when the folder ID is known.
  await denied("update public.assets set folder_id=$1 where id=$2", [foreignFolder, asset]);
  await denied("update public.assets set folder_id=$1 where id=$2", [randomUUID(), asset]);
  await denied("insert into public.asset_folders(room_id,name) values($1,'Intrusion')", [otherRoom]);
  for (const user of [player, outsider]) {
    await as(user);
    equal((await db.query("select * from public.asset_folders")).rows.length, 0);
    await denied("insert into public.asset_folders(room_id,name) values($1,'Intrusion')", [room]);
    equal((await db.query("update public.asset_folders set name='Stolen' where id=$1 returning id", [folder])).rows.length, 0);
    equal((await db.query("delete from public.asset_folders where id=$1 returning id", [folder])).rows.length, 0);
  }
  await as(outsider, "anon");
  await denied("select * from public.asset_folders");
  await denied("insert into public.asset_folders(room_id,name) values($1,'Intrusion')", [room]);
  await as(dm);
  await db.query("update public.assets set folder_id=$1 where id=$2", [folder, asset]);
  await db.query("delete from public.asset_folders where id=$1", [folder]);
  const preserved = await row("select room_id,name,image_url,folder_id from public.assets where id=$1", [asset]);
  equal(preserved, { room_id: room, name: "Goblin", image_url: "https://example.test/goblin.png", folder_id: null });
  const placed = await row("select asset_id,label,x,y from public.tokens where id=$1", [token]);
  equal(placed, { asset_id: asset, label: "Goblin", x: 140, y: 210 });
  // Folder constraints survive replay with existing data.
  await db.exec("reset role");
  await load(migration);
  equal((await row("select count(*)::int as n from public.asset_folders")).n, 1);
  equal((await row("select folder_id from public.assets where id=$1", [asset])).folder_id, null);
  console.log(`Asset folder database tests passed: ${checks} checks.`);
} finally {
  await db.close();
}
