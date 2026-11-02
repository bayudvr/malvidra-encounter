-- Combat HP, AC and conditions also matter in exploration (traps/hazards).
-- Lazy-create a combatant for the individual token on its first stat change.
-- Never seed the rest of the scene, delete HP, or change its mode.
-- Permissions follow current token ownership and DM room membership.
create or replace function public.ensure_token_tracker(p_token uuid)
returns public.combatants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t public.tokens;
  c public.combatants;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into t from public.tokens where id = p_token for update;
  if not found then raise exception 'Token not found'; end if;

  if not public.is_room_dm(t.room_id) and not (
    t.owner_user_id = auth.uid()
    and exists (
      select 1 from public.room_members m
      where m.room_id = t.room_id and m.user_id = auth.uid() and m.role = 'player'
    )
  ) then
    raise exception 'Only the DM or token owner may change its stats';
  end if;

  select * into c from public.combatants
    where token_id = t.id and scene_id = t.scene_id
    order by created_at desc limit 1 for update;

  if c.id is null then
    insert into public.combatants
      (scene_id, room_id, name, is_player, user_id, token_id,
       sort_order, hp, max_hp, ac, is_hidden)
    values (
      t.scene_id, t.room_id, t.label, t.owner_user_id is not null,
      t.owner_user_id, t.id,
      (select coalesce(max(sort_order), -1) + 1
         from public.combatants where scene_id = t.scene_id),
      t.hp, t.hp, t.ac, t.is_hidden
    )
    returning * into c;
  end if;
  return c;
end;
$$;

-- Internal authorization helper is only callable through protected RPCs.
revoke all on function public.ensure_token_tracker(uuid) from public, anon, authenticated;

create or replace function public.set_token_battle_stat(
  p_token uuid, p_field text, p_value integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.combatants;
begin
  if p_field is null or p_field not in ('hp', 'max_hp', 'ac', 'temp_hp') then
    raise exception 'Invalid stat field';
  end if;
  if p_value is null or p_value < 0 or p_value > 99999 then
    raise exception 'Stat must be between 0 and 99999';
  end if;

  c := public.ensure_token_tracker(p_token);
  update public.combatants
    set hp = case when p_field = 'hp' then p_value else hp end,
        max_hp = case when p_field = 'max_hp' then p_value else max_hp end,
        ac = case when p_field = 'ac' then p_value else ac end,
        temp_hp = case when p_field = 'temp_hp' then p_value else temp_hp end
    where id = c.id;
end;
$$;

create or replace function public.adjust_token_hp(p_token uuid, p_delta integer)
returns public.combatants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.combatants;
  damage integer;
  absorbed integer;
begin
  if p_delta is null or p_delta < -99999 or p_delta > 99999 then
    raise exception 'Damage/healing must be within 99999';
  end if;
  c := public.ensure_token_tracker(p_token);
  if p_delta < 0 then
    damage := -p_delta;
    absorbed := least(coalesce(c.temp_hp, 0), damage);
    c.temp_hp := greatest(coalesce(c.temp_hp, 0) - absorbed, 0);
    c.hp := greatest(coalesce(c.hp, 0) - (damage - absorbed), 0);
  elsif p_delta > 0 then
    c.hp := least(coalesce(c.hp, 0) + p_delta, coalesce(c.max_hp, c.hp));
  end if;
  update public.combatants
    set hp = c.hp, temp_hp = c.temp_hp
    where id = c.id returning * into c;
  return c;
end;
$$;

create or replace function public.toggle_token_condition(p_token uuid, p_condition text)
returns public.combatants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.combatants;
  condition_name text;
begin
  condition_name := nullif(trim(p_condition), '');
  if condition_name is null or length(condition_name) > 40 then
    raise exception 'Invalid condition';
  end if;
  c := public.ensure_token_tracker(p_token);
  if condition_name = any(c.conditions) then
    c.conditions := array_remove(c.conditions, condition_name);
  else
    c.conditions := array_append(coalesce(c.conditions, '{}'::text[]), condition_name);
  end if;
  update public.combatants set conditions = c.conditions
    where id = c.id returning * into c;
  return c;
end;
$$;

revoke all on function public.set_token_battle_stat(uuid,text,integer)
  from public, anon;
grant execute on function public.set_token_battle_stat(uuid,text,integer)
  to authenticated;
revoke all on function public.adjust_token_hp(uuid,integer) from public, anon;
revoke all on function public.toggle_token_condition(uuid,text) from public, anon;
grant execute on function public.adjust_token_hp(uuid,integer) to authenticated;
grant execute on function public.toggle_token_condition(uuid,text) to authenticated;
