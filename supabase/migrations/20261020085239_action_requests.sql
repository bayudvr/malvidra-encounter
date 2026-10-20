-- DM -> player requests. Readable only by the DM and the addressed room member.
-- All writes go through checked RPCs. A row lock makes completion/cancellation atomic.
create table if not exists public.action_requests (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  prompt text not null check (length(btrim(prompt)) between 1 and 500),
  kind text not null check (kind in ('action', 'roll')),
  dc integer check (dc between 1 and 99),
  status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled')),
  dice_roll_id uuid references public.dice_rolls(id) on delete set null,
  result_total integer,
  result_notation text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (kind = 'roll' or dc is null)
);
create index if not exists action_requests_room_status_idx
  on public.action_requests(room_id, status, created_at desc);
alter table public.action_requests enable row level security;
drop policy if exists action_requests_select on public.action_requests;
create policy action_requests_select on public.action_requests for select to authenticated
  using (
    public.is_room_dm(room_id)
    or (target_user_id = (select auth.uid()) and public.is_room_member(room_id))
  );
revoke all on public.action_requests from public, anon, authenticated;
grant select on public.action_requests to authenticated;

create or replace function public.create_action_request(
  p_room uuid, p_target uuid, p_prompt text, p_kind text, p_dc integer default null
)
returns public.action_requests
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.action_requests;
  v_name text;
begin
  if auth.uid() is null or not public.is_room_dm(p_room) then
    raise exception 'Only the room DM can request an action';
  end if;
  if not exists (select 1 from public.room_members
    where room_id = p_room and user_id = p_target and role = 'player') then
    raise exception 'Choose a player in this room';
  end if;
  insert into public.action_requests(room_id, target_user_id, prompt, kind, dc)
    values (p_room, p_target, btrim(p_prompt), p_kind, p_dc) returning * into v_row;
  select display_name into v_name from public.profiles where id = p_target;
  perform public.notify_discord(p_room, 'scene',
    format('📣 Waiting on %s: %s%s', coalesce(v_name, 'Player'), v_row.prompt,
      case when p_kind = 'roll' then format(' (d20%s)',
        case when p_dc is null then '' else format(', DC %s', p_dc) end) else '' end));
  return v_row;
end;
$$;

create or replace function public.complete_action_request(
  p_request uuid, p_values integer[] default null,
  p_modifier integer default 0, p_mode text default 'normal'
)
returns public.action_requests
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.action_requests;
  v_name text;
  v_total integer;
  v_notation text;
  v_roll uuid;
begin
  select * into v_row from public.action_requests where id = p_request for update;
  if not found or auth.uid() is null or v_row.target_user_id <> auth.uid()
    or not public.is_room_member(v_row.room_id) then
    raise exception 'Only the addressed player can complete this request';
  end if;
  -- Retry after a lost response returns the original result without another roll.
  if v_row.status = 'completed' then return v_row; end if;
  if v_row.status <> 'pending' then raise exception 'This request was cancelled'; end if;
  select display_name into v_name from public.profiles where id = auth.uid();
  if v_row.kind = 'roll' then
    if p_mode is null or p_mode not in ('normal', 'adv', 'dis')
      or p_modifier is null or p_modifier not between -1000 and 1000 then
      raise exception 'Invalid roll options';
    end if;
    if p_values is null or cardinality(p_values) <> (case when p_mode = 'normal' then 1 else 2 end)
      or exists (select 1 from unnest(p_values) as d(value)
        where value is null or value not between 1 and 20) then
      raise exception 'Expected one d20, or two d20s for advantage/disadvantage';
    end if;
    select case p_mode when 'adv' then max(value) when 'dis' then min(value) else sum(value) end
      into v_total from unnest(p_values) as d(value);
    v_total := v_total + p_modifier;
    v_notation := case p_mode when 'adv' then '2d20kh1' when 'dis' then '2d20kl1' else '1d20' end
      || case when p_modifier > 0 then ' + ' || p_modifier::text
              when p_modifier < 0 then ' - ' || abs(p_modifier)::text else '' end;
    insert into public.dice_rolls(room_id, user_id, actor_name, notation, detail, total)
      values (v_row.room_id, auth.uid(), coalesce(v_name, 'Player'), v_notation,
        jsonb_build_array(jsonb_build_object('sides', 20, 'values', to_jsonb(p_values))), v_total)
      returning id into v_roll;
    -- The existing dice-roll trigger delivers the result using the dice notification toggle.
  else
    if p_values is not null then raise exception 'This request does not need a roll'; end if;
    perform public.notify_discord(v_row.room_id, 'scene',
      format('✅ %s completed: %s', coalesce(v_name, 'Player'), v_row.prompt));
  end if;
  update public.action_requests set status = 'completed', resolved_at = now(),
    dice_roll_id = v_roll, result_total = v_total, result_notation = v_notation
    where id = p_request returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.cancel_action_request(p_request uuid)
returns public.action_requests
language plpgsql security definer set search_path = ''
as $$
declare v_row public.action_requests;
begin
  select * into v_row from public.action_requests where id = p_request for update;
  if not found or auth.uid() is null or not public.is_room_dm(v_row.room_id) then
    raise exception 'Only the room DM can cancel this request';
  end if;
  if v_row.status = 'pending' then
    update public.action_requests set status = 'cancelled', resolved_at = now()
      where id = p_request returning * into v_row;
  end if;
  return v_row;
end;
$$;
revoke all on function public.create_action_request(uuid, uuid, text, text, integer) from public, anon;
revoke all on function public.complete_action_request(uuid, integer[], integer, text) from public, anon;
revoke all on function public.cancel_action_request(uuid) from public, anon;
grant execute on function public.create_action_request(uuid, uuid, text, text, integer) to authenticated;
grant execute on function public.complete_action_request(uuid, integer[], integer, text) to authenticated;
grant execute on function public.cancel_action_request(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename = 'action_requests') then
    alter publication supabase_realtime add table public.action_requests;
  end if;
end;
$$;
