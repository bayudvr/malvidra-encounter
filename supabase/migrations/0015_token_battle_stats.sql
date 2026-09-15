-- Basic battle stats (HP, AC) settable at token-creation time so starting
-- combat doesn't require hand-filling every combatant's stats first.
-- Default 1 (not null) so the DM sees a value to overwrite rather than a
-- blank field. Lives on both assets (the library template) and tokens (the
-- per-scene instance, copied from the asset when dropped/dragged onto a
-- scene, editable per-instance afterward) — same "copy at drop time, not a
-- live reference" pattern image_url already uses (see AssetPanel.tsx's
-- updateAssetImage). seed_scene_combatants carries a token's hp/ac onto the
-- combatant it seeds; hp doubles as max_hp since nothing has depleted it yet.

alter table public.assets
  add column if not exists hp int not null default 1,
  add column if not exists ac int not null default 1;

alter table public.tokens
  add column if not exists hp int not null default 1,
  add column if not exists ac int not null default 1;

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
    and not exists (
      select 1 from public.combatants c
      where c.scene_id = p_scene and c.token_id = t.id
    );
end;
$$;
