// Isolated Postgres; never loads .env or connects to a live database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const dm = randomUUID(), player = randomUUID(), other = randomUUID(), outsider = randomUUID(), room = randomUUID();
const row = async (sql, args = []) => (await db.query(sql, args)).rows[0];
let checks = 0;
const equal = (a, b) => { assert.deepEqual(a, b); checks++; };
const denied = async (sql, args = []) => { await assert.rejects(db.query(sql, args)); checks++; };
async function as(user, role = 'authenticated') {
  await db.exec(`reset role; set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
}
async function setup(q = 5, players = [player, other], id = randomUUID()) {
  return row('select * from public.setup_house_session($1,$2,$3,$4)', [room, q, players, id]);
}
async function spend(session, kind, target = null, amount = 1, roll = null, mode = null, id = randomUUID()) {
  return row('select * from public.apply_house_event($1,$2,$3,$4,$5,$6,$7)', [session, kind, id, target, amount, roll, mode]);
}
async function balances(session) {
  return row('select dread,pool,capacity,player_count from public.house_sessions where id=$1', [session]);
}
async function twist(session, user = player) {
  return (await row('select twist from public.house_players where session_id=$1 and user_id=$2', [session,user])).twist;
}
async function publicRoll(user, notation, detail, total) {
  await db.exec('reset role');
  const roll = await row("insert into public.dice_rolls(room_id,user_id,actor_name,notation,detail,total) values($1,$2,'Actor',$3,$4,$5) returning *", [room,user,notation,JSON.stringify(detail),total]);
  return roll;
}
async function submit(id, detail) { return row('select * from public.submit_house_reroll($1,$2)', [id,JSON.stringify(detail)]); }
async function resolve(id, choice) { return row('select * from public.resolve_house_reroll($1,$2)', [id,choice]); }
try {
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    create table public.profiles(id uuid primary key,display_name text);
    create table public.rooms(id uuid primary key,dm_id uuid references public.profiles);
    create table public.room_members(room_id uuid references public.rooms,user_id uuid references public.profiles,role text);
    create table public.dice_rolls(id uuid primary key default gen_random_uuid(),room_id uuid references public.rooms,user_id uuid references public.profiles,
      actor_name text,notation text,detail jsonb,total integer,created_at timestamptz not null default now());
    grant select,insert on public.dice_rolls to authenticated;
    create function public.is_room_dm(p_room uuid) returns boolean language sql security definer as
      $$select exists(select 1 from public.rooms where id=p_room and dm_id=auth.uid())$$;
    create function public.is_room_member(p_room uuid) returns boolean language sql security definer as
      $$select exists(select 1 from public.room_members where room_id=p_room and user_id=auth.uid())$$;
    create table public.test_notifications(category text,message text);
    create function public.notify_discord(p_room_id uuid,p_category text,p_message text) returns void language sql as
      $$insert into public.test_notifications values(p_category,p_message)$$;
    create publication supabase_realtime;
    insert into public.profiles values('${dm}','DM'),('${player}','Aria'),('${other}','Other'),('${outsider}','Outsider');
    insert into public.rooms values('${room}','${dm}');
    insert into public.room_members values('${room}','${dm}','dm'),('${room}','${player}','player'),('${room}','${other}','player');
  `);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261020085239_action_requests.sql',import.meta.url),'utf8'));
  const migration = readFileSync(new URL('../supabase/migrations/20261020111142_twist_dread_sessions.sql',import.meta.url),'utf8');
  await db.exec(migration); await db.exec(migration);
  // Validate mixed pools, negative modifiers, percentile dice and keep-lowest notation.
  for (const [notation, detail, expected] of [
    ['2d6 + 1d8 - 3',[{sides:6,values:[2,5]},{sides:8,values:[8]}],12],
    ['2d20kl1 - 2',[{sides:20,values:[17,4]}],2],
    ['1d100 + 3',[{sides:100,values:[100]}],103],
  ]) equal((await row('select malvidra_private.house_roll_total($1,$2) as total',[notation,JSON.stringify(detail)])).total,expected);
  for (const [notation, detail] of [
    ['1d20',[{sides:6,values:[4]}]],['2d6',[{sides:6,values:[4]}]],
    ['1d20',[{sides:20,values:[null]}]],['0d20',[{sides:20,values:[]}]],
    ['1d20 + 1001',[{sides:20,values:[4]}]],['1d20',{}],
  ]) await denied('select malvidra_private.house_roll_total($1,$2)',[notation,JSON.stringify(detail)]);
  await as(player);
  await denied('select public.setup_house_session($1,5,$2,$3)',[room,[player],randomUUID()]);
  await as(dm);
  for (const [q,players] of [[0,[player]],[101,[player]],[5,[]],[5,[player,player]],[5,[outsider]],[5,[dm]],[5,[null]]]) {
    await denied('select public.setup_house_session($1,$2,$3,$4)',[room,q,players,randomUUID()]);
  }
  const s = await setup(3);
  equal(await balances(s.id),{dread:2,pool:0,capacity:6,player_count:2}); equal(await twist(s.id),3);
  await as(player);
  await denied('select public.apply_house_event($1,$2,$3,$4)',[s.id,'twist',randomUUID(),other]);
  await denied('select public.apply_house_event($1,$2,$3)',[s.id,'dread',randomUUID()]);
  await denied('select public.apply_house_event($1,$2,$3,$4)',[s.id,'distribute',randomUUID(),player]);
  const nonce = randomUUID();
  await spend(s.id,'twist',player,1,null,null,nonce);
  await Promise.all([spend(s.id,'twist',player,1,null,null,nonce),spend(s.id,'twist',player,1,null,null,nonce)]);
  equal(await twist(s.id),2); equal((await balances(s.id)).dread,3);
  await denied('select public.apply_house_event($1,$2,$3,$4,$5)',[s.id,'twist',nonce,player,2]);
  await spend(s.id,'twist',player); await spend(s.id,'twist',player);
  equal(await twist(s.id),0);
  await denied('select public.apply_house_event($1,$2,$3,$4)',[s.id,'twist',randomUUID(),player]);
  await as(dm);
  await spend(s.id,'dread'); equal((await balances(s.id)).pool,1);
  await spend(s.id,'distribute',player); equal(await twist(s.id),1); equal((await balances(s.id)).pool,0);
  await denied('select public.apply_house_event($1,$2,$3,$4,$5)',[s.id,'distribute',randomUUID(),player,1]);
  await spend(s.id,'dread');
  await db.exec("reset role; alter table public.house_events add constraint test_failure check(kind <> 'distribute') not valid;");
  await as(dm);
  await denied('select public.apply_house_event($1,$2,$3,$4)',[s.id,'distribute',randomUUID(),player]);
  equal(await twist(s.id),1); equal((await balances(s.id)).pool,1);
  await db.exec('reset role; alter table public.house_events drop constraint test_failure;');
  await as(dm);
  await denied('select public.apply_house_event($1,$2,$3,$4,$5)',[s.id,'distribute',randomUUID(),other,1]);
  // Setup retries preserve the existing balances rather than resetting them.
  await setup(3,[player,other],s.id); equal(await twist(s.id),1);
  await denied('select public.setup_house_session($1,$2,$3,$4)',[room,4,[player,other],s.id]);
  // Caps, including pool-at-cap spending and refusing to go below zero.
  await db.exec(`reset role; update public.house_sessions set dread=6,pool=6 where id='${s.id}';`);
  await as(player); await spend(s.id,'twist',player); equal((await balances(s.id)).dread,6);
  await as(dm); await spend(s.id,'dread'); equal((await balances(s.id)).pool,6);
  for(let i=0;i<5;i++) await spend(s.id,'dread');
  equal((await balances(s.id)).dread,0);
  await denied('select public.apply_house_event($1,$2,$3)',[s.id,'dread',randomUUID()]);
  const next = await setup();
  await denied('select public.apply_house_event($1,$2,$3,$4)',[s.id,'twist',randomUUID(),player]);
  const original = await publicRoll(player,'1d20 + 3',[{sides:20,values:[4]}],7);
  await as(player);
  const reroll = await spend(next.id,'twist',player,1,original.id,'choose');
  equal(await twist(next.id),4); equal((await balances(next.id)).dread,3);
  await spend(next.id,'twist',player,1,original.id,'choose',reroll.id); equal(await twist(next.id),4);
  await denied('select public.apply_house_event($1,$2,$3,$4,$5,$6,$7)',[next.id,'twist',randomUUID(),player,1,original.id,'choose']);
  await denied('select public.submit_house_reroll($1,$2)',[reroll.id,JSON.stringify([{sides:20,values:[21]}])]);
  await as(dm); await denied('select public.setup_house_session($1,5,$2,$3)',[room,[player,other],randomUUID()]);
  await as(other);
  await denied('select public.submit_house_reroll($1,$2)',[reroll.id,JSON.stringify([{sides:20,values:[20]}])]);
  await denied('select public.resolve_house_reroll($1,$2)',[reroll.id,'new']);
  await as(player);
  const landed = await submit(reroll.id,[{sides:20,values:[16]}]); equal(landed.status,'rolled'); equal(landed.new_total,19);
  equal((await submit(reroll.id,[{sides:20,values:[1]}])).new_total,19);
  equal((await resolve(reroll.id,'old')).chosen_total,7);
  equal((await resolve(reroll.id,'new')).chosen,'old');
  await denied('insert into public.dice_rolls(room_id,user_id,actor_name,notation,detail,total,superseded_by) values($1,$2,$3,$4,$5,$6,$7)',[room,player,'Aria','1d20','[]',20,original.id]);
  // The chosen original may be rerolled again, while a replaced original cannot.
  const again = await spend(next.id,'twist',player,1,original.id,'choose');
  await submit(again.id,[{sides:20,values:[18]}]);
  const chosen = await resolve(again.id,'new'); equal(chosen.chosen_total,21);
  equal((await row('select superseded_by from public.dice_rolls where id=$1',[original.id])).superseded_by,chosen.chosen_roll_id);
  await denied('select public.apply_house_event($1,$2,$3,$4,$5,$6,$7)',[next.id,'twist',randomUUID(),player,1,original.id,'choose']);
  const npc = await publicRoll(dm,'1d6 + 1',[{sides:6,values:[2]}],3);
  await as(dm);
  const dread = await spend(next.id,'dread',null,1,npc.id,'choose');
  equal((await submit(dread.id,[{sides:6,values:[6]}])).new_total,7);
  equal((await resolve(dread.id,'new')).chosen_total,7);
  // PC Dread enforces lower/higher against complete roll totals.
  const pc = await publicRoll(player,'2d20kh1 + 3',[{sides:20,values:[4,12]}],15);
  await as(dm);
  await denied('select public.apply_house_event($1,$2,$3,$4,$5,$6,$7)',[next.id,'dread',randomUUID(),null,1,pc.id,'choose']);
  const lower = await spend(next.id,'dread',null,1,pc.id,'lower');
  const lowerResult = await submit(lower.id,[{sides:20,values:[16,17]}]);
  equal(lowerResult.status,'resolved'); equal(lowerResult.chosen,'old'); equal(lowerResult.chosen_total,15);
  // A selected new result updates a completed DM action request atomically.
  const request = await row('select * from public.create_action_request($1,$2,$3,$4)',[room,player,'Dexterity save','roll']);
  await as(player);
  const completed = await row('select * from public.complete_action_request($1,$2)',[request.id,[3]]);
  await as(dm);
  const higher = await spend(next.id,'dread',null,1,completed.dice_roll_id,'higher');
  equal((await submit(higher.id,[{sides:20,values:[14]}])).chosen_total,14);
  await as(player);
  equal((await row('select result_total from public.action_requests where id=$1',[request.id])).result_total,14);
  // The DM can close an abandoned player reroll, without taking a free choice of a new result.
  const abandon = await spend(next.id,'twist',player,1,pc.id,'choose');
  await as(dm);
  await denied('select public.resolve_house_reroll($1,$2)',[abandon.id,'new']);
  equal((await resolve(abandon.id,'old')).chosen_total,15);
  const reset = await setup(2,[player]); equal(await balances(reset.id),{dread:1,pool:0,capacity:2,player_count:1});
  await denied('select public.apply_house_event($1,$2,$3,$4)',[reset.id,'twist',randomUUID(),other]);
  // Joining/leaving the room does not silently recalculate the current session capacity.
  await db.exec(`reset role; delete from public.room_members where user_id='${player}';`);
  await as(dm); equal((await balances(reset.id)).capacity,2);
  await as(player);
  equal((await db.query('select * from public.house_sessions')).rows.length,0);
  await denied('select public.apply_house_event($1,$2,$3,$4)',[reset.id,'twist',randomUUID(),player]);
  await as(outsider);
  for(const table of ['house_sessions','house_players','house_events','house_rerolls']) {
    equal((await db.query(`select * from public.${table}`)).rows.length,0);
    await denied(`delete from public.${table}`);
  }
  await denied("select malvidra_private.house_roll_total('1d20','[]'::jsonb)");
  await as(dm);
  await denied('update public.house_sessions set dread=999');
  await denied('update public.house_players set twist=99');
  await as('', 'anon');
  await denied('select * from public.house_sessions');
  await denied('select public.setup_house_session($1,5,$2,$3)',[room,[player],randomUUID()]);
  await denied('select public.apply_house_event($1,$2,$3)',[reset.id,'dread',randomUUID()]);
  await denied('select public.submit_house_reroll($1,$2)',[reroll.id,'[]']);
  await denied('select public.resolve_house_reroll($1,$2)',[reroll.id,'old']);
  await db.exec('reset role');
  equal((await row("select count(*)::integer as n from pg_class where relname in ('house_sessions','house_players','house_events','house_rerolls') and relrowsecurity")).n,4);
  equal((await row("select count(*)::integer as n from pg_proc where proname in ('setup_house_session','apply_house_event','submit_house_reroll','resolve_house_reroll') and prosecdef and proconfig is not null")).n,4);
  console.log(`Passed ${checks} Twist/Dread database checks.`);
} catch(error) {
  console.error(error.message,error.detail??'',error.where??'','position',error.position??'');
  process.exitCode=1;
} finally { await db.close(); }
