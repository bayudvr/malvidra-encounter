-- Player-owned combat controls.
-- Owners can adjust only their own combatant HP/temp HP and toggle conditions.
-- These are SECURITY DEFINER RPCs so we don't need a broad combatants UPDATE RLS
-- policy that would also let a player alter initiative, AC, name, etc.

create or replace function public.adjust_own_combatant_hp(
  p_combatant uuid,
  p_delta int
)
returns public.combatants
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.combatants;
  damage int;
  absorbed int;
begin
  select * into c
  from public.combatants
  where id = p_combatant
    and user_id = auth.uid()
    and is_player = true
  for update;

  if c.id is null then
    raise exception 'combatant not found or not owned by current user';
  end if;

  if c.hp is null then
    raise exception 'combatant HP is not set';
  end if;

  if p_delta < 0 then
    damage := -p_delta;
    absorbed := least(coalesce(c.temp_hp, 0), damage);
    c.temp_hp := greatest(coalesce(c.temp_hp, 0) - absorbed, 0);
    damage := damage - absorbed;
    c.hp := greatest(c.hp - damage, 0);
  elsif p_delta > 0 then
    c.hp := least(c.hp + p_delta, coalesce(c.max_hp, c.hp + p_delta));
  end if;

  update public.combatants
  set hp = c.hp,
      temp_hp = c.temp_hp
  where id = c.id
  returning * into c;

  return c;
end;
$$;

create or replace function public.toggle_own_combatant_condition(
  p_combatant uuid,
  p_condition text
)
returns public.combatants
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.combatants;
  clean_condition text;
begin
  clean_condition := nullif(trim(p_condition), '');
  if clean_condition is null or length(clean_condition) > 40 then
    raise exception 'invalid condition';
  end if;

  select * into c
  from public.combatants
  where id = p_combatant
    and user_id = auth.uid()
    and is_player = true
  for update;

  if c.id is null then
    raise exception 'combatant not found or not owned by current user';
  end if;

  if clean_condition = any(c.conditions) then
    c.conditions := array_remove(c.conditions, clean_condition);
  else
    c.conditions := array_append(c.conditions, clean_condition);
  end if;

  update public.combatants
  set conditions = c.conditions
  where id = c.id
  returning * into c;

  return c;
end;
$$;

revoke all on function public.adjust_own_combatant_hp(uuid, int) from public;
revoke all on function public.toggle_own_combatant_condition(uuid, text) from public;
grant execute on function public.adjust_own_combatant_hp(uuid, int) to authenticated;
grant execute on function public.toggle_own_combatant_condition(uuid, text) to authenticated;
