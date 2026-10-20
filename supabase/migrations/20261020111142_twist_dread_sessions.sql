-- Per-session Malvidra resources. Q is chosen by the DM; N is a snapshot of selected players.
-- Initial: each player Q/Q Twist, DM N/(Q*N) Dread, pool 0/(Q*N).
create table if not exists public.house_sessions (
  id uuid primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  quota integer not null check (quota between 1 and 100),
  player_count integer not null check (player_count between 1 and 100),
  capacity integer not null check (capacity = quota * player_count),
  dread integer not null check (dread >= 0 and dread <= capacity),
  pool integer not null check (pool >= 0 and pool <= capacity),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists house_one_active_session on public.house_sessions(room_id) where active;
create table if not exists public.house_players (
  session_id uuid not null references public.house_sessions(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  twist integer not null check (twist between 0 and 100),
  primary key(session_id, user_id)
);
create table if not exists public.house_events (
  id uuid primary key,
  session_id uuid not null references public.house_sessions(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  actor_user_id uuid not null,
  kind text not null check (kind in ('setup','twist','dread','distribute')),
  target_user_id uuid references public.profiles(id) on delete set null,
  amount integer not null,
  base_roll_id uuid references public.dice_rolls(id),
  choice_mode text check (choice_mode in ('choose','lower','higher')),
  dread_after integer not null,
  pool_after integer not null,
  twist_after integer,
  created_at timestamptz not null default now()
);
alter table public.dice_rolls add column if not exists superseded_by uuid references public.dice_rolls(id);
create table if not exists public.house_rerolls (
  id uuid primary key references public.house_events(id) on delete cascade,
  session_id uuid not null references public.house_sessions(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  actor_user_id uuid not null,
  resource text not null check (resource in ('twist','dread')),
  base_roll_id uuid not null references public.dice_rolls(id),
  roll_user_id uuid references public.profiles(id) on delete set null,
  actor_name text not null,
  notation text not null,
  old_total integer not null,
  choice_mode text not null check (choice_mode in ('choose','lower','higher')),
  status text not null default 'pending' check (status in ('pending','rolled','resolved')),
  new_detail jsonb,
  new_total integer,
  chosen text check (chosen in ('old','new')),
  chosen_total integer,
  chosen_roll_id uuid references public.dice_rolls(id),
  created_at timestamptz not null default now()
);
create unique index if not exists house_one_pending_reroll on public.house_rerolls(base_roll_id) where status <> 'resolved';
create index if not exists house_events_room_created on public.house_events(room_id, created_at desc);
create index if not exists house_rerolls_room_status on public.house_rerolls(room_id, status, created_at desc);
create index if not exists house_players_room on public.house_players(room_id);

do $$
declare tbl text;
begin
  foreach tbl in array array['house_sessions','house_players','house_events','house_rerolls'] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_read', tbl);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_room_dm(room_id) or public.is_room_member(room_id))', tbl || '_read', tbl);
    execute format('revoke all on public.%I from public, anon, authenticated', tbl);
    execute format('grant select on public.%I to authenticated', tbl);
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    end if;
  end loop;
end;
$$;

-- Only internal RPCs can call this evaluator. No executable endpoint in the exposed schema.
create schema if not exists malvidra_private;
revoke all on schema malvidra_private from public, anon, authenticated;
-- Keep the replacement link server-owned, including on ordinary client inserts.
create or replace function malvidra_private.guard_roll_replacement()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') and new.superseded_by is not null then
    raise exception 'Roll replacements can only be recorded by the reroll action';
  end if;
  return new;
end;
$$;
revoke all on function malvidra_private.guard_roll_replacement() from public, anon, authenticated;
drop trigger if exists dice_rolls_guard_replacement on public.dice_rolls;
create trigger dice_rolls_guard_replacement before insert or update of superseded_by
  on public.dice_rolls for each row execute function malvidra_private.guard_roll_replacement();

create or replace function malvidra_private.house_roll_total(p_notation text, p_detail jsonb)
returns integer language plpgsql immutable set search_path = ''
as $$
declare
  parts text[]; terms text[]; term text; fields text[]; group_data jsonb;
  qty integer; sides integer; modifier integer; total integer := 0; count_dice integer := 0;
  value_text text; subtotal integer; matches integer;
begin
  parts := regexp_match(regexp_replace(p_notation, '\s', '', 'g'),
    '^([0-9]+d[0-9]+(?:k[hl]1)?(?:\+[0-9]+d[0-9]+(?:k[hl]1)?)*)((?:\+|-)[0-9]+)?$');
  if parts is null or p_detail is null or jsonb_typeof(p_detail) <> 'array' then
    raise exception 'Unsupported dice notation or missing dice values';
  end if;
  modifier := coalesce(nullif(parts[2], '')::integer, 0);
  if abs(modifier) > 1000 then raise exception 'Modifier is too large'; end if;
  terms := regexp_split_to_array(parts[1], '\+');
  if jsonb_array_length(p_detail) <> cardinality(terms) then raise exception 'Dice groups do not match notation'; end if;
  foreach term in array terms loop
    fields := regexp_match(term, '^([0-9]+)d([0-9]+)(kh1|kl1)?$');
    qty := fields[1]::integer; sides := fields[2]::integer;
    count_dice := count_dice + qty;
    if qty < 1 or count_dice > 100 or sides not in (4,6,8,10,12,20,100) then raise exception 'Unsupported dice group'; end if;
    select count(*) into matches from jsonb_array_elements(p_detail) d where d->>'sides' = sides::text;
    if matches <> 1 then raise exception 'Duplicate or missing dice group'; end if;
    select d into group_data from jsonb_array_elements(p_detail) d where d->>'sides' = sides::text;
    if jsonb_typeof(group_data->'values') <> 'array' or group_data->'values' is null then raise exception 'Missing dice values'; end if;
    if jsonb_array_length(group_data->'values') <> qty then raise exception 'Incorrect number of dice'; end if;
    for value_text in select jsonb_array_elements_text(group_data->'values') loop
      if value_text is null or value_text !~ '^[0-9]+$' or value_text::integer not between 1 and sides then
        raise exception 'Die value is outside its range';
      end if;
    end loop;
    select case fields[3] when 'kh1' then max(v::integer) when 'kl1' then min(v::integer) else sum(v::integer) end
      into subtotal from jsonb_array_elements_text(group_data->'values') as values_table(v);
    total := total + subtotal;
  end loop;
  return total + modifier;
end;
$$;
revoke all on function malvidra_private.house_roll_total(text, jsonb) from public, anon, authenticated;

create or replace function public.setup_house_session(p_room uuid, p_quota integer, p_players uuid[], p_operation uuid)
returns public.house_sessions language plpgsql security definer set search_path = ''
as $$
declare s public.house_sessions; n integer; previous_players uuid[];
begin
  if auth.uid() is null or not public.is_room_dm(p_room) then raise exception 'Only the DM can set up a session'; end if;
  perform 1 from public.rooms where id = p_room for no key update;
  if p_operation is null or p_quota is null or p_quota not between 1 and 100
    or p_players is null or cardinality(p_players) not between 1 and 100 then raise exception 'Choose a quota and at least one player'; end if;
  n := cardinality(p_players);
  if (select count(distinct value) from unnest(p_players) as players(value)) <> n
    or exists (select 1 from unnest(p_players) as players(value)
      where not exists (select 1 from public.room_members where room_id = p_room and user_id = value and role = 'player')) then
    raise exception 'Select distinct current players in this room';
  end if;
  select * into s from public.house_sessions where id = p_operation;
  if found then
    select array_agg(user_id order by user_id) into previous_players from public.house_players where session_id = s.id;
    if s.room_id <> p_room or s.quota <> p_quota
      or previous_players is distinct from (select array_agg(value order by value) from unnest(p_players) as players(value)) then
      raise exception 'Operation ID already used for different setup';
    end if;
    return s;
  end if;
  -- Lock in the same order as resource actions before checking unresolved reservations.
  perform 1 from public.house_sessions where room_id = p_room and active for update;
  if exists (select 1 from public.house_rerolls r join public.house_sessions hs on hs.id = r.session_id
    where hs.room_id = p_room and hs.active and r.status <> 'resolved') then
    raise exception 'Finish pending rerolls (or keep their original result) before starting a new session';
  end if;
  update public.house_sessions set active = false where room_id = p_room and active;
  insert into public.house_sessions(id, room_id, quota, player_count, capacity, dread, pool)
    values(p_operation, p_room, p_quota, n, p_quota*n, n, 0) returning * into s;
  insert into public.house_players(session_id, room_id, user_id, twist)
    select s.id, p_room, value, p_quota from unnest(p_players) as players(value);
  insert into public.house_events(id, session_id, room_id, actor_user_id, kind, amount, dread_after, pool_after)
    values(p_operation, s.id, p_room, auth.uid(), 'setup', 0, n, 0);
  return s;
end;
$$;

create or replace function public.apply_house_event(
  p_session uuid, p_kind text, p_operation uuid, p_target uuid default null,
  p_amount integer default 1, p_roll uuid default null, p_mode text default null
)
returns public.house_events language plpgsql security definer set search_path = ''
as $$
declare s public.house_sessions; e public.house_events; r public.dice_rolls; balance integer; dm boolean;
begin
  select * into s from public.house_sessions where id = p_session for update;
  if not found or auth.uid() is null or not (public.is_room_dm(s.room_id) or public.is_room_member(s.room_id)) then
    raise exception 'Session is not accessible';
  end if;
  dm := public.is_room_dm(s.room_id);
  select * into e from public.house_events where id = p_operation;
  if found then
    if e.session_id <> p_session or e.actor_user_id <> auth.uid() or e.kind is distinct from p_kind
      or e.target_user_id is distinct from p_target or e.amount is distinct from p_amount
      or e.base_roll_id is distinct from p_roll or e.choice_mode is distinct from p_mode then
      raise exception 'Operation ID already used for another transaction';
    end if;
    return e;
  end if;
  if not s.active then raise exception 'This session has ended'; end if;
  if p_operation is null or p_kind is null or p_kind not in ('twist','dread','distribute')
    or p_amount is null or p_amount < 1 or (p_kind <> 'distribute' and p_amount <> 1) then
    raise exception 'Invalid resource transaction';
  end if;
  if p_kind in ('twist','distribute') then
    if p_target is null or not exists (select 1 from public.room_members where room_id = s.room_id and user_id = p_target) then
      raise exception 'Player is no longer in the room';
    end if;
    select twist into balance from public.house_players where session_id = s.id and user_id = p_target;
    if not found then raise exception 'Player is not in this session'; end if;
  end if;
  if p_kind = 'twist' then
    if not dm and p_target <> auth.uid() then raise exception 'You can only use your own Twist'; end if;
    if balance < 1 then raise exception 'No Twist remaining'; end if;
  elsif not dm then raise exception 'Only the DM can spend Dread or distribute Twist';
  end if;
  if p_kind = 'dread' and p_target is not null then raise exception 'Dread is a DM resource'; end if;
  if p_roll is not null then
    if p_kind = 'distribute' then raise exception 'Distribution cannot reroll dice'; end if;
    select * into r from public.dice_rolls where id = p_roll and room_id = s.room_id for update;
    if not found or r.created_at < s.created_at then raise exception 'Choose a public roll from the current session'; end if;
    if r.superseded_by is not null then raise exception 'This result has been replaced; use its selected result'; end if;
    if exists (select 1 from public.house_rerolls where base_roll_id = p_roll and status <> 'resolved') then
      raise exception 'This roll already has a pending reroll';
    end if;
    perform malvidra_private.house_roll_total(r.notation, r.detail);
    if p_kind = 'twist' and (r.user_id is distinct from auth.uid() or p_target is distinct from auth.uid()) then
      raise exception 'Twist rerolls must be your own public rolls';
    end if;
    if p_mode is null or p_mode not in ('choose','lower','higher') then raise exception 'Choose a result selection mode'; end if;
    if p_kind = 'twist' and p_mode <> 'choose' then raise exception 'Twist lets the player choose either result'; end if;
    if p_kind = 'dread' then
      if exists (select 1 from public.room_members where room_id = s.room_id and user_id = r.user_id and role = 'player') then
        if not exists (select 1 from public.house_players where session_id = s.id and user_id = r.user_id) then raise exception 'Player is not in this session'; end if;
        if p_mode = 'choose' then raise exception 'For a PC, choose lower or higher before using Dread'; end if;
      elsif p_mode <> 'choose' then raise exception 'For a DM/NPC roll, choose either result after rerolling'; end if;
    end if;
  elsif p_mode is not null then raise exception 'A selection mode requires a public roll';
  end if;
  if p_kind = 'twist' then
    balance := balance - 1;
    update public.house_players set twist = balance where session_id = s.id and user_id = p_target;
    s.dread := least(s.capacity, s.dread + 1);
  elsif p_kind = 'dread' then
    if s.dread < 1 then raise exception 'No Dread remaining'; end if;
    s.dread := s.dread - 1; s.pool := least(s.capacity, s.pool + 1);
  else
    if s.pool < p_amount then raise exception 'Not enough Twist in the pool'; end if;
    if balance + p_amount > s.quota then raise exception 'Distribution would exceed the player quota'; end if;
    balance := balance + p_amount; s.pool := s.pool - p_amount;
    update public.house_players set twist = balance where session_id = s.id and user_id = p_target;
  end if;
  update public.house_sessions set dread = s.dread, pool = s.pool where id = s.id;
  insert into public.house_events(id, session_id, room_id, actor_user_id, kind, target_user_id, amount,
    base_roll_id, choice_mode, dread_after, pool_after, twist_after)
    values(p_operation, s.id, s.room_id, auth.uid(), p_kind, p_target, p_amount, p_roll, p_mode, s.dread, s.pool, balance)
    returning * into e;
  if p_roll is not null then
    insert into public.house_rerolls(id, session_id, room_id, actor_user_id, resource, base_roll_id,
      roll_user_id, actor_name, notation, old_total, choice_mode)
      values(e.id, s.id, s.room_id, auth.uid(), p_kind, r.id, r.user_id, r.actor_name, r.notation, r.total, p_mode);
  end if;
  return e;
end;
$$;

create or replace function public.resolve_house_reroll(p_reroll uuid, p_choice text)
returns public.house_rerolls language plpgsql security definer set search_path = ''
as $$
declare r public.house_rerolls; s public.house_sessions; selected_roll uuid; selected_choice text;
begin
  -- Session first, then reroll, everywhere: resource changes and reset serialize together.
  select * into s from public.house_sessions where id = (select session_id from public.house_rerolls where id = p_reroll) for update;
  if not found or auth.uid() is null or not (public.is_room_dm(s.room_id) or public.is_room_member(s.room_id)) then raise exception 'Reroll is not accessible'; end if;
  select * into r from public.house_rerolls where id = p_reroll for update;
  if r.actor_user_id <> auth.uid() and not (public.is_room_dm(s.room_id) and p_choice = 'old') then
    raise exception 'Only the spender can choose a result; the DM may close it by keeping the original';
  end if;
  if r.status = 'resolved' then return r; end if;
  if not s.active then raise exception 'This session has ended'; end if;
  if p_choice is null or p_choice not in ('old','new') then raise exception 'Choose old or new'; end if;
  if p_choice = 'new' and r.new_total is null then raise exception 'Roll the dice first'; end if;
  selected_choice := p_choice;
  if r.new_total is not null and r.choice_mode <> 'choose' then
    selected_choice := case when (r.choice_mode = 'lower' and r.new_total < r.old_total)
      or (r.choice_mode = 'higher' and r.new_total > r.old_total) then 'new' else 'old' end;
  end if;
  selected_roll := r.base_roll_id;
  if selected_choice = 'new' then
    insert into public.dice_rolls(room_id, user_id, actor_name, notation, detail, total)
      values(r.room_id, r.roll_user_id, r.actor_name, r.notation, r.new_detail, r.new_total) returning id into selected_roll;
    update public.dice_rolls set superseded_by = selected_roll where id = r.base_roll_id;
    update public.action_requests set dice_roll_id = selected_roll, result_total = r.new_total, result_notation = r.notation
      where dice_roll_id = r.base_roll_id and status = 'completed';
  end if;
  update public.house_rerolls set status = 'resolved', chosen = selected_choice,
    chosen_total = case when selected_choice = 'new' then r.new_total else r.old_total end,
    chosen_roll_id = selected_roll where id = r.id returning * into r;
  perform public.notify_discord(r.room_id, 'dice', format('%s: %s reroll for %s — original %s, reroll %s; kept %s (%s).',
    upper(r.resource), r.notation, r.actor_name, r.old_total, coalesce(r.new_total::text, 'not rolled'), r.chosen, r.chosen_total));
  return r;
end;
$$;

create or replace function public.submit_house_reroll(p_reroll uuid, p_detail jsonb)
returns public.house_rerolls language plpgsql security definer set search_path = ''
as $$
declare r public.house_rerolls; s public.house_sessions; total integer;
begin
  select * into s from public.house_sessions where id = (select session_id from public.house_rerolls where id = p_reroll) for update;
  if not found or auth.uid() is null or not (public.is_room_dm(s.room_id) or public.is_room_member(s.room_id)) then raise exception 'Reroll is not accessible'; end if;
  select * into r from public.house_rerolls where id = p_reroll for update;
  if r.actor_user_id <> auth.uid() then raise exception 'Only the spender can roll these dice'; end if;
  if r.status <> 'pending' then return r; end if;
  if not s.active then raise exception 'This session has ended'; end if;
  total := malvidra_private.house_roll_total(r.notation, p_detail);
  update public.house_rerolls set status = 'rolled', new_detail = p_detail, new_total = total
    where id = r.id returning * into r;
  if r.choice_mode <> 'choose' then
    select * into r from public.resolve_house_reroll(r.id, 'new');
  end if;
  return r;
end;
$$;

revoke all on function public.setup_house_session(uuid, integer, uuid[], uuid) from public, anon;
revoke all on function public.apply_house_event(uuid, text, uuid, uuid, integer, uuid, text) from public, anon;
revoke all on function public.submit_house_reroll(uuid, jsonb) from public, anon;
revoke all on function public.resolve_house_reroll(uuid, text) from public, anon;
grant execute on function public.setup_house_session(uuid, integer, uuid[], uuid) to authenticated;
grant execute on function public.apply_house_event(uuid, text, uuid, uuid, integer, uuid, text) to authenticated;
grant execute on function public.submit_house_reroll(uuid, jsonb) to authenticated;
grant execute on function public.resolve_house_reroll(uuid, text) to authenticated;
