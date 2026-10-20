// Isolated Postgres with real RLS and legacy RPCs. Never loads live credentials.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const dm = randomUUID(), player = randomUUID(), viewer = randomUUID(), outsider = randomUUID();
const room = randomUUID(), scene = randomUUID(), token = randomUUID(), combatant = randomUUID();
const migration = '20261020114534_room_spectators.sql';
let checks = 0;
const equal = (a,b) => { assert.deepEqual(a,b); checks++; };
const row = async (sql,args=[]) => (await db.query(sql,args)).rows[0];
const denied = async (sql,args=[]) => { await assert.rejects(db.query(sql,args)); checks++; };
async function as(user, role='authenticated') {
  await db.exec(`reset role; set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
}
async function load(file) {
  let sql = readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8');
  // PGlite has gen_random_uuid built in; this test uses a deterministic byte
  // helper for the unused invite default, rather than installing pgcrypto.
  sql = sql.replace('create extension if not exists pgcrypto;','');
  await db.exec(sql);
}
try {
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated;
    create function public.gen_random_bytes(integer) returns bytea language sql as $$select decode(repeat('ab',$1),'hex')$$;
    create function public.cast_room_id() returns uuid language sql as $$select null::uuid$$;
    create publication supabase_realtime;
  `);
  for (const file of ['0001_init.sql','0002_combat_tokens_realtime.sql','0004_dice_rolls.sql',
    '0013_player_requests.sql','0015_token_battle_stats.sql','0024_chat_messages.sql',
    '0025_token_auras.sql','0027_scene_drawings.sql','0028_player_combat_controls.sql',
    '0029_player_end_turn.sql']) await load(file);
  await db.exec(`
    create table public.test_notifications(message text);
    create function public.notify_discord(p_room_id uuid,p_category text,p_message text) returns void language sql as
      $$insert into public.test_notifications values(p_message)$$;
    grant select,insert,update,delete on all tables in schema public to authenticated;
    insert into auth.users(id,email) values('${dm}','dm@test'),('${player}','player@test'),('${viewer}','viewer@test'),('${outsider}','outsider@test');
    insert into public.rooms(id,name,dm_id,invite_code) values('${room}','Test','${dm}','INVITE');
    insert into public.room_members(room_id,user_id,role) values('${room}','${dm}','dm'),('${room}','${player}','player');
    insert into public.scenes(id,room_id,name,mode) values('${scene}','${room}','Map','combat');
    insert into public.tokens(id,scene_id,room_id,owner_user_id,label) values('${token}','${scene}','${room}','${player}','PC');
    insert into public.combatants(id,scene_id,room_id,name,user_id,is_player,token_id,hp,max_hp)
      values('${combatant}','${scene}','${room}','PC','${player}',true,'${token}',10,10);
    update public.scenes set active_combatant_id='${combatant}' where id='${scene}';
  `);
  await load('20261020085239_action_requests.sql');
  await load('20261020111142_twist_dread_sessions.sql');
  await load(migration); await load(migration);
  equal((await row("select has_function_privilege('anon','public.set_room_member_role(uuid,uuid,text)','execute') as allowed")).allowed,false);
  equal((await row("select has_function_privilege('authenticated','public.set_room_member_role(uuid,uuid,text)','execute') as allowed")).allowed,true);
  equal((await row("select has_function_privilege('authenticated','malvidra_private.guard_gameplay_write()','execute') as allowed")).allowed,false);
  equal((await row("select count(*)::integer as n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='malvidra_private' and p.proname in ('guard_member_role','guard_gameplay_write','guard_house_player_activity') and p.prosecdef and p.proconfig @> array['search_path=\"\"']")).n,3);
  await as(viewer);
  equal((await row("select public.join_room('invite') as id")).id,room);
  equal((await row('select role from public.room_members where user_id=$1',[viewer])).role,'spectator');
  equal((await row('select name from public.scenes where id=$1',[scene])).name,'Map');
  await denied('select public.set_room_member_role($1,$2,$3)',[room,viewer,'player']);
  equal((await db.query("update public.room_members set role='player' where user_id=$1 returning role",[viewer])).rows.length,0);
  await denied("insert into public.dice_rolls(room_id,user_id,actor_name,notation,detail,total) values($1,$2,'Viewer','1d20','[]',20)",[room,viewer]);
  await denied('insert into public.scene_drawings(scene_id,room_id,user_id,points) values($1,$2,$3,$4)',[scene,room,viewer,'[0,0,1,1]']);
  await denied("insert into public.chat_messages(room_id,user_id,speaker_name,body) values($1,$2,'Viewer','Hello')",[room,viewer]);
  await denied('insert into public.player_requests(room_id,user_id) values($1,$2)',[room,viewer]);
  await as(dm);
  await denied('select public.set_room_member_role($1,$2,$3)',[room,dm,'spectator']);
  await denied('select public.set_room_member_role($1,$2,$3)',[room,viewer,'dm']);
  await denied('select public.set_room_member_role($1,$2,$3)',[room,outsider,'player']);
  await denied("update public.room_members set role='dm' where user_id=$1",[viewer]);
  await denied("update public.room_members set role='spectator' where user_id=$1",[dm]);
  await denied('select public.setup_house_session($1,3,$2,$3)',[room,[player,viewer],randomUUID()]);
  await denied('select public.create_action_request($1,$2,$3,$4)',[room,viewer,'Act','action']);
  const session = await row('select * from public.setup_house_session($1,3,$2,$3)',[room,[player],randomUUID()]);
  equal([session.player_count,session.dread,session.capacity,session.pool],[1,1,3,0]);
  const request = await row('select * from public.create_action_request($1,$2,$3,$4)',[room,player,'Act','action']);
  await as(player);
  await db.query('update public.tokens set x=70 where id=$1',[token]);
  equal((await row('select x from public.tokens where id=$1',[token])).x,70);
  equal((await row('select * from public.adjust_own_combatant_hp($1,-2)',[combatant])).hp,8);
  await row('select * from public.apply_house_event($1,$2,$3,$4)',[session.id,'twist',randomUUID(),player]);
  const pendingRoll = await row("insert into public.dice_rolls(room_id,user_id,actor_name,notation,detail,total) values($1,$2,'PC','1d20',$3,12) returning id",[room,player,JSON.stringify([{sides:20,values:[12]}])]);
  const reroll = await row('select * from public.apply_house_event($1,$2,$3,$4,$5,$6,$7)',[session.id,'twist',randomUUID(),player,1,pendingRoll.id,'choose']);
  await as(dm);
  await db.query('select public.set_room_member_role($1,$2,$3)',[room,player,'spectator']);
  equal((await row('select owner_user_id from public.tokens where id=$1',[token])).owner_user_id,player);
  equal((await row('select player_count,capacity from public.house_sessions where id=$1',[session.id])),{player_count:1,capacity:3});
  await as(player);
  await denied('update public.tokens set x=140 where id=$1',[token]);
  await denied('select public.adjust_own_combatant_hp($1,-1)',[combatant]);
  await denied('select public.toggle_own_combatant_condition($1,$2)',[combatant,'Prone']);
  await denied('select public.end_own_turn($1)',[scene]);
  await denied('insert into public.token_auras(token_id,scene_id,room_id) values($1,$2,$3)',[token,scene,room]);
  await denied('select public.complete_action_request($1)',[request.id]);
  await denied('select public.apply_house_event($1,$2,$3,$4)',[session.id,'twist',randomUUID(),player]);
  await denied('select public.submit_house_reroll($1,$2)',[reroll.id,JSON.stringify([{sides:20,values:[20]}])]);
  await denied("select public.resolve_house_reroll($1,'old')",[reroll.id]);
  equal((await row('select x from public.tokens where id=$1',[token])).x,70);
  equal((await row('select total from public.dice_rolls where id=$1',[pendingRoll.id])).total,12);
  await as(dm);
  // DM can close an interrupted reroll without giving the spectator control.
  equal((await row("select * from public.resolve_house_reroll($1,'old')",[reroll.id])).status,'resolved');
  await denied('select public.apply_house_event($1,$2,$3,$4)',[session.id,'twist',randomUUID(),player]);
  await denied('select public.apply_house_event($1,$2,$3,$4,$5,$6,$7)',[session.id,'dread',randomUUID(),null,1,pendingRoll.id,'choose']);
  await row('select * from public.apply_house_event($1,$2,$3)',[session.id,'dread',randomUUID()]);
  await denied('select public.apply_house_event($1,$2,$3,$4)',[session.id,'distribute',randomUUID(),player]);
  equal((await row('select twist from public.house_players where session_id=$1 and user_id=$2',[session.id,player])).twist,1);
  await db.query('select public.set_room_member_role($1,$2,$3)',[room,viewer,'player']);
  await as(viewer);
  await db.query("select public.join_room('INVITE')");
  equal((await row('select role from public.room_members where user_id=$1',[viewer])).role,'player');
  await as(dm);
  const next = await row('select * from public.setup_house_session($1,3,$2,$3)',[room,[viewer],randomUUID()]);
  equal([next.player_count,next.dread,next.capacity],[1,1,3]);
  await db.query('select public.set_room_member_role($1,$2,$3)',[room,player,'player']);
  await as(player);
  equal((await row('select * from public.adjust_own_combatant_hp($1,1)',[combatant])).hp,9);
  await as(dm);
  await db.query('delete from public.room_members where room_id=$1 and user_id=$2',[room,player]);
  await as(player);
  await denied('select public.adjust_own_combatant_hp($1,-1)',[combatant]);
  await as(outsider);
  await denied('select public.set_room_member_role($1,$2,$3)',[room,viewer,'player']);
  await denied('select public.adjust_own_combatant_hp($1,-1)',[combatant]);
  await as('', 'anon');
  await denied("select public.join_room('INVITE')");
  await denied('select public.set_room_member_role($1,$2,$3)',[room,viewer,'player']);
  await as(dm);
  await db.query("select public.join_room('INVITE')");
  equal((await row('select role from public.room_members where user_id=$1',[dm])).role,'dm');
  await db.query('delete from public.rooms where id=$1',[room]);
  equal((await row('select count(*)::integer as n from public.scenes')).n,0);
  console.log(`Passed ${checks} spectator database checks`);
} finally { await db.close(); }
