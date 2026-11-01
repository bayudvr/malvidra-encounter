-- Manually pull the most recently modified cross-scene snapshot into an existing token.
-- The target stays in its current scene and keeps its identity, owner, image,
-- label, position, visibility, initiative, round and scene-specific effects.
-- Both the source and target must be from the same room and library asset.
-- This is intentionally opt-in, never an automatic write on scene switching.

create or replace function public.pull_latest_token_state(p_token uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target public.tokens;
  v_source public.tokens;
  v_asset public.assets;
  v_source_combat public.combatants;
  v_target_combat public.combatants;
  v_dm boolean;
  v_source_hp integer;
  v_source_ac integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_target
    from public.tokens where id = p_token for update;
  if not found then
    raise exception 'Token not found';
  end if;

  v_dm := public.is_room_dm(v_target.room_id);
  if not v_dm and not (
    v_target.owner_user_id = auth.uid()
    and exists (
      select 1 from public.room_members m
      where m.room_id = v_target.room_id
        and m.user_id = auth.uid()
        and m.role = 'player'
    )
  ) then
    raise exception 'Only the DM or the token owner can pull its state';
  end if;

  if v_target.asset_id is null then
    raise exception 'This token is not linked to a library asset';
  end if;

  select * into v_asset from public.assets
    where id = v_target.asset_id and room_id = v_target.room_id;
  if not found or not v_asset.carry_state then
    raise exception 'Enable Continue latest state between scenes on this library asset';
  end if;

  -- An owner can only pull the state of their own, revealed instances.
  -- DMs can see and reuse hidden/other-owner instances in the same room.
  select * into v_source
    from public.tokens
    where asset_id = v_target.asset_id
      and room_id = v_target.room_id
      and scene_id <> v_target.scene_id
      and (
        v_dm or (owner_user_id = v_target.owner_user_id and not is_hidden)
      )
    order by state_changed_at desc, created_at desc, id desc
    limit 1;

  if not found then return 'no_source'; end if;
  if v_source.state_changed_at <= v_target.state_changed_at then
    return 'up_to_date';
  end if;

  select * into v_source_combat from public.combatants
    where token_id = v_source.id
      and scene_id = v_source.scene_id
      and room_id = v_target.room_id
    order by created_at desc limit 1;

  select * into v_target_combat from public.combatants
    where token_id = v_target.id
      and scene_id = v_target.scene_id
    order by created_at desc limit 1 for update;

  v_source_hp := coalesce(v_source_combat.max_hp, v_source.hp);
  v_source_ac := coalesce(v_source_combat.ac, v_source.ac);

  -- No blanket replacement of token rows: keep per-scene layout and
  -- ownership intact. Bump the snapshot even when only counters changed.
  update public.tokens
    set hp = v_source_hp,
        ac = v_source_ac,
        size = v_source.size,
        color = v_source.color,
        vision_radius_ft = v_source.vision_radius_ft,
        state_changed_at = clock_timestamp()
    where id = v_target.id;

  if v_target_combat.id is not null then
    update public.combatants
      set hp = coalesce(v_source_combat.hp, v_source.hp),
          max_hp = v_source_hp,
          temp_hp = coalesce(v_source_combat.temp_hp, 0),
          ac = v_source_ac,
          conditions = coalesce(v_source_combat.conditions, '{}'::text[])
    where id = v_target_combat.id;
  elsif v_source_combat.id is not null then
    insert into public.combatants
      (scene_id, room_id, name, is_player, user_id, token_id,
       sort_order, hp, max_hp, temp_hp, ac, conditions, is_hidden)
    values (
      v_target.scene_id, v_target.room_id, v_target.label,
      v_target.owner_user_id is not null, v_target.owner_user_id, v_target.id,
      (select coalesce(max(sort_order), -1) + 1 from public.combatants
         where scene_id = v_target.scene_id),
      coalesce(v_source_combat.hp, v_source.hp), v_source_hp,
      coalesce(v_source_combat.temp_hp, 0), v_source_ac,
      coalesce(v_source_combat.conditions, '{}'::text[]), v_target.is_hidden
    );
  end if;

  -- Full replacement is intentional: a counter removed in a prior scene
  -- must not reappear in the target scene's older snapshot.
  delete from public.token_counters where token_id = v_target.id;
  insert into public.token_counters
    (token_id, room_id, name, current, max, sort_order)
  select v_target.id, v_target.room_id, name, current, max, sort_order
    from public.token_counters where token_id = v_source.id;

  return 'updated';
end;
$$;

revoke all on function public.pull_latest_token_state(uuid)
  from public, anon;
grant execute on function public.pull_latest_token_state(uuid)
  to authenticated;
