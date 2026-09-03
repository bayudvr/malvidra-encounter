-- Malvidra Encounter — 0002
--   * combat is seeded from the tokens on the scene (not the player roster)
--   * players may move a token that is assigned to them
--   * filtered realtime DELETE events carry room_id (kick / remove combatant live)

-------------------------------------------------------------------------------
-- Full row images: with the default (primary-key) replica identity a filtered
-- realtime subscription never sees DELETE events, because the filter column
-- (room_id) is not part of the old row. FULL makes kicks and combatant removal
-- propagate without a manual refresh.
-------------------------------------------------------------------------------
alter table public.tokens replica identity full;
alter table public.combatants replica identity full;
alter table public.room_members replica identity full;

-------------------------------------------------------------------------------
-- Temp HP, shown alongside HP / max HP on the token during combat.
-------------------------------------------------------------------------------
alter table public.combatants add column if not exists temp_hp int;

-------------------------------------------------------------------------------
-- Players may move a token that is assigned to them.
-- (Permissive policies are OR-ed, so this is additive to the DM's full access.)
-------------------------------------------------------------------------------
drop policy if exists tokens_owner_move on public.tokens;
create policy tokens_owner_move on public.tokens
  for update
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-------------------------------------------------------------------------------
-- Combat roster comes from the tokens on the scene.
-- One combatant per token; a token with an owner is a player character.
-- Existing combatants (linked by token_id) are left alone so the DM can
-- toggle combat off/on without losing initiative or HP.
-------------------------------------------------------------------------------
drop function if exists public.seed_player_combatants(uuid);

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
    (scene_id, room_id, name, is_player, user_id, token_id, sort_order)
  select
    p_scene,
    v_room_id,
    t.label,
    t.owner_user_id is not null,
    t.owner_user_id,
    t.id,
    v_base + (row_number() over (order by t.created_at) - 1)::int
  from public.tokens t
  where t.scene_id = p_scene
    and not exists (
      select 1 from public.combatants c
      where c.scene_id = p_scene and c.token_id = t.id
    );
end;
$$;
