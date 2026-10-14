-- Malvidra Encounter — 0031
-- Preserve the latest tactical state of a library token across scenes.
-- Default OFF for generic/NPC assets (many Goblins may share an asset).
-- Existing player-owned assets are opted in; DM can toggle per library asset.
alter table public.assets
  add column if not exists carry_state boolean not null default false;
update public.assets set carry_state = true where owner_user_id is not null;

-- Tracks meaningful changes, not movement or scene coordinates.
alter table public.tokens
  add column if not exists state_changed_at timestamptz not null default now();
update public.tokens set state_changed_at = created_at;
create index if not exists tokens_asset_state_idx
  on public.tokens(asset_id, state_changed_at desc, created_at desc)
  where asset_id is not null;

-- Continued combatants can be prepared for a hidden freshly placed token.
-- They must not be visible to guests/players/cast until the token is revealed.
alter table public.combatants
  add column if not exists is_hidden boolean not null default false;
update public.combatants c set is_hidden = t.is_hidden
  from public.tokens t
  where c.token_id = t.id;

-- Preserve the cast-token read path but restrict hidden combatants at the DB level.
drop policy if exists combatants_select on public.combatants;
create policy combatants_select on public.combatants
  for select using (
    public.is_room_dm(room_id)
    or (
      not is_hidden
      and (public.is_room_member(room_id) or room_id = public.cast_room_id())
    )
  );

create or replace function public.bump_token_state_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if row(old.label, old.hp, old.ac, old.size, old.color, old.owner_user_id,
         old.vision_radius_ft)
     is distinct from
     row(new.label, new.hp, new.ac, new.size, new.color, new.owner_user_id,
         new.vision_radius_ft) then
    new.state_changed_at := clock_timestamp();
  end if;
  return new;
end;
$$;
drop trigger if exists tokens_state_change on public.tokens;
create trigger tokens_state_change
  before update of label, hp, ac, size, color, owner_user_id, vision_radius_ft
  on public.tokens for each row execute function public.bump_token_state_at();

create or replace function public.bump_token_state_from_combatant()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.token_id is not null
     and (tg_op = 'INSERT' or row(old.hp, old.max_hp, old.temp_hp, old.ac, old.conditions)
         is distinct from row(new.hp, new.max_hp, new.temp_hp, new.ac, new.conditions)) then
    update public.tokens set state_changed_at = clock_timestamp()
      where id = new.token_id;
  end if;
  return new;
end;
$$;
-- Avoid referring to OLD in INSERT paths via boolean OR: PL/pgSQL short-circuits OR.
drop trigger if exists combatants_state_change on public.combatants;
create trigger combatants_state_change
  after insert or update of hp, max_hp, temp_hp, ac, conditions
  on public.combatants
  for each row execute function public.bump_token_state_from_combatant();

create or replace function public.bump_token_state_from_counter()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_token uuid;
begin
  if tg_op = 'DELETE' then
    v_token := old.token_id;
  else
    v_token := new.token_id;
  end if;
  if tg_op = 'UPDATE' then
    if row(old.name, old.current, old.max, old.sort_order) is not distinct from
       row(new.name, new.current, new.max, new.sort_order) then
      return new;
    end if;
  end if;
  update public.tokens set state_changed_at = clock_timestamp() where id = v_token;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists token_counters_state_change on public.token_counters;
create trigger token_counters_state_change
  after insert or update or delete on public.token_counters
  for each row execute function public.bump_token_state_from_counter();

create or replace function public.sync_combatant_hidden_from_token()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.is_hidden is distinct from new.is_hidden then
    update public.combatants set is_hidden = new.is_hidden where token_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists tokens_combatant_visibility on public.tokens;
create trigger tokens_combatant_visibility
  after update of is_hidden on public.tokens
  for each row execute function public.sync_combatant_hidden_from_token();

-- One atomic operation for either placement route (+ Scene or drag/drop):
-- token, any previous combat state, and per-token counters are copied together.
-- Position, initiative, turn order, hidden state, and other scene state reset.
create or replace function public.spawn_asset_token(
  p_scene uuid,
  p_asset uuid,
  p_x double precision,
  p_y double precision,
  p_fresh boolean default false
)
returns public.tokens
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset public.assets;
  v_scene public.scenes;
  v_source public.tokens;
  v_combat public.combatants;
  v_token public.tokens;
begin
  select * into v_scene from public.scenes where id = p_scene;
  if not found then raise exception 'Scene not found'; end if;

  if auth.uid() is null or not public.is_room_dm(v_scene.room_id) then
    raise exception 'Only the room DM can place library tokens';
  end if;

  select * into v_asset
    from public.assets where id = p_asset and room_id = v_scene.room_id;
  if not found then raise exception 'Asset is not in this room'; end if;

  if v_asset.carry_state and not coalesce(p_fresh, false) then
    select * into v_source
      from public.tokens
      where asset_id = p_asset
        and room_id = v_scene.room_id
        and scene_id <> p_scene
      order by state_changed_at desc, created_at desc, id desc
      limit 1;
    if found then
      select * into v_combat from public.combatants
        where token_id = v_source.id
        order by created_at desc limit 1;
    end if;
  end if;

  insert into public.tokens
    (scene_id, room_id, asset_id, label, image_url, x, y, size, color,
     owner_user_id, is_hidden, hp, ac, vision_radius_ft)
  values (
    p_scene, v_scene.room_id, p_asset, v_asset.name, v_asset.image_url, p_x, p_y,
    coalesce(v_source.size, 1), v_source.color,
    v_asset.owner_user_id, true,
    coalesce(v_combat.max_hp, v_source.hp, v_asset.hp),
    coalesce(v_combat.ac, v_source.ac, v_asset.ac),
    v_source.vision_radius_ft
  )
  returning * into v_token;

  if v_combat.id is not null then
    insert into public.combatants
      (scene_id, room_id, name, is_player, user_id, token_id, sort_order,
       hp, max_hp, temp_hp, ac, conditions, is_hidden)
    values (
      p_scene, v_scene.room_id, v_token.label, v_token.owner_user_id is not null,
      v_token.owner_user_id, v_token.id,
      (select coalesce(max(sort_order), -1) + 1 from public.combatants
        where scene_id = p_scene),
      coalesce(v_combat.hp, v_source.hp), coalesce(v_combat.max_hp, v_source.hp),
      v_combat.temp_hp, coalesce(v_combat.ac, v_source.ac),
      v_combat.conditions, true
    );
  end if;

  if v_source.id is not null then
    insert into public.token_counters
      (token_id, room_id, name, current, max, sort_order)
    select v_token.id, v_scene.room_id, name, current, max, sort_order
      from public.token_counters
      where token_id = v_source.id;
  end if;

  return v_token;
end;
$$;
revoke all on function public.spawn_asset_token(uuid, uuid, double precision, double precision, boolean) from public;
grant execute on function public.spawn_asset_token(uuid, uuid, double precision, double precision, boolean) to authenticated;
