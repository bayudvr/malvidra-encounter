// Run with: npm run test:action-requests
// Uses an isolated embedded Postgres, never reads .env or connects to a remote database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const dm = '00000000-0000-0000-0000-000000000001';
const player = '00000000-0000-0000-0000-000000000002';
const other = '00000000-0000-0000-0000-000000000003';
const outsider = '00000000-0000-0000-0000-000000000004';
const room = '10000000-0000-0000-0000-000000000001';
let assertions = 0;
async function as(user, role = 'authenticated') {
  await db.exec(`reset role; set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
}
async function rpc(sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function denied(sql, params = []) {
  await assert.rejects(db.query(sql, params));
  assertions++;
}
try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    create table public.profiles(id uuid primary key, display_name text);
    create table public.rooms(id uuid primary key, dm_id uuid references public.profiles);
    create table public.room_members(room_id uuid references public.rooms, user_id uuid references public.profiles, role text);
    create table public.dice_rolls(id uuid primary key default gen_random_uuid(), room_id uuid references public.rooms,
      user_id uuid, actor_name text, notation text, detail jsonb, total int);
    create function public.is_room_dm(p_room uuid) returns boolean language sql security definer as
      $$select exists(select 1 from public.rooms where id = p_room and dm_id = auth.uid())$$;
    create function public.is_room_member(p_room uuid) returns boolean language sql security definer as
      $$select exists(select 1 from public.room_members where room_id = p_room and user_id = auth.uid())$$;
    create table public.test_notifications(category text, message text);
    create function public.notify_discord(p_room_id uuid, p_category text, p_message text) returns void language sql as
      $$insert into public.test_notifications values(p_category, p_message)$$;
    create publication supabase_realtime;
    insert into public.profiles values ('${dm}', 'DM'), ('${player}', 'Aria'), ('${other}', 'Other'), ('${outsider}', 'Outsider');
    insert into public.rooms values ('${room}', '${dm}');
    insert into public.room_members values ('${room}', '${dm}', 'dm'), ('${room}', '${player}', 'player'), ('${room}', '${other}', 'player');
  `);
  const webhookMigration = readFileSync(new URL('../supabase/migrations/0006_discord_webhooks.sql', import.meta.url), 'utf8');
  await db.exec(webhookMigration.slice(webhookMigration.indexOf('create or replace function public.trg_notify_dice_roll()'), webhookMigration.indexOf('create or replace function public.trg_notify_active_scene()')));
  const migration = readFileSync(new URL('../supabase/migrations/20261020085239_action_requests.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(migration); // New migration can safely be replayed.
  await as(player);
  await denied('select public.create_action_request($1,$2,$3,$4)', [room, player, 'Save', 'roll']);
  await as(dm);
  await denied('select public.create_action_request($1,$2,$3,$4)', [room, outsider, 'Save', 'roll']);
  await denied('select public.create_action_request($1,$2,$3,$4)', [room, player, '   ', 'roll']);
  await denied('select public.create_action_request($1,$2,$3,$4,$5)', [room, player, 'Act', 'action', 14]);
  const request = await rpc('select * from public.create_action_request($1,$2,$3,$4,$5)', [room, player, 'Dexterity save', 'roll', 14]);
  assert.equal(request.status, 'pending'); assertions++;
  await as(other);
  assert.equal((await db.query('select * from public.action_requests')).rows.length, 0); assertions++;
  await denied('select public.complete_action_request($1,$2)', [request.id, [20]]);
  await as(player);
  assert.equal((await db.query('select * from public.action_requests')).rows.length, 1); assertions++;
  await denied("update public.action_requests set status = 'completed' where id = $1", [request.id]);
  await denied('delete from public.action_requests where id = $1', [request.id]);
  await denied('select public.cancel_action_request($1)', [request.id]);
  for (const values of [null, [], [21], [null], [1, 2]]) {
    await denied('select public.complete_action_request($1,$2)', [request.id, values]);
  }
  await denied('select public.complete_action_request($1,$2,$3,$4)', [request.id, [4], 0, 'invalid']);
  const completed = await rpc('select * from public.complete_action_request($1,$2,$3,$4)', [request.id, [5, 17], 3, 'adv']);
  assert.equal(completed.result_total, 20);
  assert.equal(completed.result_notation, '2d20kh1 + 3'); assertions += 2;
  const retry = await rpc('select * from public.complete_action_request($1,$2)', [request.id, [1]]);
  assert.equal(retry.dice_roll_id, completed.dice_roll_id); assertions++;
  await as(dm);
  await rpc('select public.cancel_action_request($1)', [request.id]);
  assert.equal((await rpc('select status from public.action_requests where id=$1', [request.id])).status, 'completed'); assertions++;
  const cancelled = await rpc('select * from public.create_action_request($1,$2,$3,$4)', [room, player, 'Wait', 'action']);
  await rpc('select public.cancel_action_request($1)', [cancelled.id]);
  await as(player);
  await denied('select public.complete_action_request($1)', [cancelled.id]);
  await as(dm);
  const action = await rpc('select * from public.create_action_request($1,$2,$3,$4)', [room, player, 'Choose a route', 'action']);
  await as(player);
  assert.equal((await rpc('select * from public.complete_action_request($1)', [action.id])).status, 'completed'); assertions++;
  // Normal/disadvantage math, bad options, and atomic rollback on failed dice persistence.
  await as(dm);
  const normal = await rpc('select * from public.create_action_request($1,$2,$3,$4)', [room, player, 'Wisdom check', 'roll']);
  await as(player);
  await denied('select public.complete_action_request($1,$2,$3)', [normal.id, [10], 1001]);
  await denied('select public.complete_action_request($1,$2,$3,$4)', [normal.id, [10], 0, null]);
  await db.exec("reset role; alter table public.dice_rolls add constraint test_failure check (total < 0) not valid;");
  await as(player);
  await denied('select public.complete_action_request($1,$2,$3)', [normal.id, [12], 2]);
  assert.equal((await rpc('select status from public.action_requests where id=$1', [normal.id])).status, 'pending'); assertions++;
  await db.exec('reset role; alter table public.dice_rolls drop constraint test_failure;');
  await as(player);
  assert.equal((await rpc('select * from public.complete_action_request($1,$2,$3)', [normal.id, [12], -2])).result_total, 10); assertions++;
  await as(dm);
  const dis = await rpc('select * from public.create_action_request($1,$2,$3,$4)', [room, player, 'Stealth check', 'roll']);
  await as(player);
  const disResult = await rpc('select * from public.complete_action_request($1,$2,$3,$4)', [dis.id, [16, 4], -1, 'dis']);
  assert.equal(disResult.result_total, 3); assertions++;
  assert.equal(disResult.result_notation, '2d20kl1 - 1'); assertions++;
  await as(outsider);
  assert.equal((await db.query('select * from public.action_requests')).rows.length, 0); assertions++;
  await denied('select public.cancel_action_request($1)', [normal.id]);
  await denied('select public.complete_action_request($1,$2)', [normal.id, [20]]);
  // A kicked player loses both visibility and ability to complete outstanding requests.
  await as(dm);
  const kicked = await rpc('select * from public.create_action_request($1,$2,$3,$4)', [room, player, 'Another save', 'roll']);
  await db.exec(`reset role; delete from public.room_members where user_id = '${player}';`);
  await as(player);
  assert.equal((await db.query('select * from public.action_requests')).rows.length, 0); assertions++;
  await denied('select public.complete_action_request($1,$2)', [kicked.id, [10]]);
  await as('', 'anon');
  await denied('select * from public.action_requests');
  await denied('select public.cancel_action_request($1)', [kicked.id]);
  await denied('select public.complete_action_request($1)', [action.id]);
  await denied('select public.create_action_request($1,$2,$3,$4)', [room, player, 'No', 'action']);
  await db.exec('reset role');
  assert.equal((await rpc('select count(*)::int as n from public.dice_rolls')).n, 3); assertions++;
  assert.equal((await rpc("select count(*)::int as n from public.test_notifications where message like '%Aria completed: Choose a route%'")).n, 1); assertions++;
  assert.equal((await rpc("select relrowsecurity from pg_class where oid = 'public.action_requests'::regclass")).relrowsecurity, true); assertions++;
  assert.equal((await rpc("select count(*)::int as n from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'action_requests'")).n, 1); assertions++;
  assert.equal((await rpc("select count(*)::int as n from public.test_notifications where category = 'dice'")).n, 3); assertions++;
  console.log(`Passed ${assertions} action-request database assertions (isolated Postgres).`);
} catch (error) {
  console.error(error.message, error.detail ?? '', error.where ?? '', 'position:', error.position, 'internal:', error.internalQuery);
  process.exitCode = 1;
} finally { await db.close(); }
