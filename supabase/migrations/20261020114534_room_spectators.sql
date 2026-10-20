-- Room membership grants viewing access; only DM-approved players may play.
-- Preserve existing players, tokens, and fixed session snapshots.
alter table public.room_members drop constraint if exists room_members_role_check;
alter table public.room_members add constraint room_members_role_check
  check (role in ('dm', 'player', 'spectator'));

create or replace function public.join_room(p_code text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare target uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select id into target from public.rooms where invite_code = upper(trim(p_code));
  if target is null then raise exception 'invalid invite code'; end if;
  insert into public.room_members(room_id, user_id, role)
    values(target, auth.uid(), case when public.is_room_dm(target) then 'dm' else 'spectator' end)
    on conflict(room_id, user_id) do nothing;
  return target;
end;
$$;
revoke all on function public.join_room(text) from public, anon;
grant execute on function public.join_room(text) to authenticated;

create or replace function public.set_room_member_role(p_room uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_room_dm(p_room) then
    raise exception 'Only the room DM can change member roles';
  end if;
  if p_role is null or p_role not in ('player','spectator') then
    raise exception 'Choose player or spectator';
  end if;
  if exists(select 1 from public.rooms where id = p_room and dm_id = p_user) then
    raise exception 'The room DM must remain DM';
  end if;
  update public.room_members set role = p_role where room_id = p_room and user_id = p_user;
  if not found then raise exception 'Member is no longer in the room'; end if;
end;
$$;
revoke all on function public.set_room_member_role(uuid,uuid,text) from public, anon;
grant execute on function public.set_room_member_role(uuid,uuid,text) to authenticated;

create schema if not exists malvidra_private;
revoke all on schema malvidra_private from public, anon, authenticated;

-- Also protect direct membership UPDATE requests allowed by existing DM RLS.
create or replace function malvidra_private.guard_member_role()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare owner_id uuid;
begin
  select dm_id into owner_id from public.rooms where id = new.room_id;
  if (new.user_id = owner_id) is distinct from (new.role = 'dm') then
    raise exception 'Only the room owner can hold the DM role';
  end if;
  return new;
end;
$$;
revoke all on function malvidra_private.guard_member_role() from public, anon, authenticated;
drop trigger if exists guard_member_role on public.room_members;
create trigger guard_member_role before insert or update on public.room_members
  for each row execute function malvidra_private.guard_member_role();

-- A row trigger also covers legacy SECURITY DEFINER RPCs (HP, conditions,
-- End Turn, request completion and rerolls), which bypass normal RLS.
create or replace function malvidra_private.guard_gameplay_write()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare target_room uuid; actor_role text;
begin
  target_room := case when tg_op = 'DELETE' then old.room_id else new.room_id end;
  -- A room deletion cascades after the parent (and its membership) is gone.
  if tg_op = 'DELETE' and not exists(select 1 from public.rooms where id = target_room) then return old; end if;
  if auth.uid() is not null and not public.is_room_dm(target_room) then
    select role into actor_role from public.room_members
      where room_id = target_room and user_id = auth.uid() for share;
    if actor_role is distinct from 'player' then
      raise exception 'Spectators can watch but cannot change game state';
    end if;
    if tg_op = 'UPDATE' and old.room_id is distinct from new.room_id then
      raise exception 'Cannot move game state between rooms';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function malvidra_private.guard_gameplay_write() from public, anon, authenticated;
do $$
declare tbl text;
begin
  foreach tbl in array array['scenes','tokens','combatants','assets','dice_rolls',
    'player_requests','token_auras','scene_drawings','chat_messages',
    'action_requests','house_sessions','house_players','house_events','house_rerolls'] loop
    execute format('drop trigger if exists guard_gameplay_write on public.%I',tbl);
    execute format('create trigger guard_gameplay_write before insert or update or delete on public.%I for each row execute function malvidra_private.guard_gameplay_write()',tbl);
  end loop;
end;
$$;

-- A demoted player's balance is retained, but the DM cannot spend/distribute
-- it while they are spectating. Session capacity remains the original snapshot.
create or replace function malvidra_private.guard_house_player_activity()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind in ('twist','distribute') and not exists (
    select 1 from public.room_members where room_id = new.room_id
      and user_id = new.target_user_id and role = 'player'
  ) then raise exception 'Choose a current player in this session'; end if;
  if new.kind = 'dread' and new.base_roll_id is not null and exists (
    select 1 from public.dice_rolls r join public.room_members m
      on m.room_id = r.room_id and m.user_id = r.user_id
      where r.id = new.base_roll_id and m.role = 'spectator'
  ) then raise exception 'Spectator rolls cannot use session resources'; end if;
  return new;
end;
$$;
revoke all on function malvidra_private.guard_house_player_activity() from public, anon, authenticated;
drop trigger if exists guard_house_player_activity on public.house_events;
create trigger guard_house_player_activity before insert on public.house_events
  for each row execute function malvidra_private.guard_house_player_activity();
