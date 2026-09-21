-- Malvidra Encounter — 0023
-- seed_scene_combatants (called by ModeToggle's "Start combat") pulled in every token on the
-- scene with no is_hidden check — a hidden ambush monster's name/token art immediately showed up
-- in InitiativeBar, which is visible to every player ("Everyone sees the turn order", see that
-- component's own comment), spoiling it before the DM ever revealed the token on the map. Skip
-- hidden tokens at seed time; the DM can still add one to combat manually the moment it's
-- revealed via the existing per-token "Add to combat" action (TokenInspector/MultiTokenBar),
-- unaffected by this change.

create or replace function public.seed_scene_combatants(p_scene uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_base int;
begin
  select room_id into v_room_id from public.scenes where id = p_scene;
  if v_room_id is null then
    raise exception 'scene not found';
  end if;
  if not public.is_room_dm(v_room_id) then
    raise exception 'only the DM can start combat';
  end if;

  select coalesce(max(sort_order) + 1, 0) into v_base
  from public.combatants where scene_id = p_scene;

  insert into public.combatants
    (scene_id, room_id, name, is_player, user_id, token_id, sort_order, hp, max_hp, ac)
  select
    p_scene,
    v_room_id,
    t.label,
    t.owner_user_id is not null,
    t.owner_user_id,
    t.id,
    v_base + (row_number() over (order by t.created_at) - 1)::int,
    t.hp,
    t.hp,
    t.ac
  from public.tokens t
  where t.scene_id = p_scene
    and not t.is_hidden
    and not exists (
      select 1 from public.combatants c
      where c.scene_id = p_scene and c.token_id = t.id
    );
end;
$$;
