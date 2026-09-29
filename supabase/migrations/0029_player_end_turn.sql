-- Safe player End Turn action.
-- A player may only advance combat while the scene's active combatant belongs to them.
create or replace function public.end_own_turn(p_scene uuid)
returns public.scenes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scene public.scenes;
  v_active public.combatants;
  v_next public.combatants;
  v_uid uuid := auth.uid();
  v_wrapped boolean := false;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select *
    into v_scene
    from public.scenes
   where id = p_scene
   for update;

  if not found then
    raise exception 'Scene not found';
  end if;

  if v_scene.mode <> 'combat' then
    raise exception 'Scene is not in combat';
  end if;

  if v_scene.active_combatant_id is null then
    raise exception 'No active combatant';
  end if;

  select *
    into v_active
    from public.combatants
   where id = v_scene.active_combatant_id
     and scene_id = p_scene
   for update;

  if not found then
    raise exception 'Active combatant not found';
  end if;

  if not v_active.is_player or v_active.user_id is distinct from v_uid then
    raise exception 'It is not your turn';
  end if;

  select *
    into v_next
    from public.combatants
   where scene_id = p_scene
     and (
       sort_order > v_active.sort_order
       or (
         sort_order = v_active.sort_order
         and created_at > v_active.created_at
       )
     )
   order by sort_order asc, created_at asc
   limit 1;

  if not found then
    select *
      into v_next
      from public.combatants
     where scene_id = p_scene
     order by sort_order asc, created_at asc
     limit 1;
    v_wrapped := true;
  end if;

  if v_next.id = v_active.id then
    v_wrapped := true;
  end if;

  update public.scenes
     set active_combatant_id = v_next.id,
         round = case when v_wrapped then round + 1 else round end
   where id = p_scene
   returning * into v_scene;

  return v_scene;
end;
$$;

revoke all on function public.end_own_turn(uuid) from public;
grant execute on function public.end_own_turn(uuid) to authenticated;
