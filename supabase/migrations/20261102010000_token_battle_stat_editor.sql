-- Malvidra Encounter: one authoritative battle stat editor for DM and token owners.
-- Combatants own current HP, max HP, AC and temporary HP once combat exists.
-- Tokens keep the starting/max HP and AC snapshot for later scene placement.
-- No historical data is rewritten by this migration.

create or replace function public.set_token_battle_stat(
  p_token uuid, p_field text, p_value integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token public.tokens;
  v_combat public.combatants;
  v_dm boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_field is null or p_field not in ('hp', 'max_hp', 'ac', 'temp_hp') then
    raise exception 'Invalid stat field';
  end if;
  if p_value is null or p_value < 0 or p_value > 99999 then
    raise exception 'Stat must be an integer between 0 and 99999';
  end if;

  select * into v_token from public.tokens where id = p_token for update;
  if not found then raise exception 'Token not found'; end if;

  v_dm := public.is_room_dm(v_token.room_id);
  if not v_dm and not (
    v_token.owner_user_id = auth.uid()
    and exists (
      select 1 from public.room_members m
      where m.room_id = v_token.room_id
        and m.user_id = auth.uid()
        and m.role = 'player'
    )
  ) then
    raise exception 'Only the DM or this token''s player owner can edit its battle stats';
  end if;

  select * into v_combat from public.combatants
    where token_id = p_token and scene_id = v_token.scene_id
    order by created_at desc limit 1 for update;

  if v_combat.id is not null then
    update public.combatants set
      hp = case when p_field = 'hp' then p_value else hp end,
      max_hp = case when p_field = 'max_hp' then p_value else max_hp end,
      ac = case when p_field = 'ac' then p_value else ac end,
      temp_hp = case when p_field = 'temp_hp' then p_value else temp_hp end
    where id = v_combat.id;
  elsif p_field in ('hp', 'max_hp') then
    update public.tokens set hp = p_value where id = p_token;
  elsif p_field = 'ac' then
    update public.tokens set ac = p_value where id = p_token;
  else
    raise exception 'Temporary HP is only available during combat';
  end if;
end;
$$;

revoke all on function public.set_token_battle_stat(uuid, text, integer) from public, anon;
grant execute on function public.set_token_battle_stat(uuid, text, integer) to authenticated;

-- A combatant may be edited in the initiative editor or via a player RPC, not
-- just the token inspector. Keep the token's *starting/max* stats in sync.
create or replace function public.sync_token_battle_defaults()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.token_id is not null
     and row(old.max_hp, old.ac) is distinct from row(new.max_hp, new.ac) then
    update public.tokens set
      hp = coalesce(new.max_hp, hp),
      ac = coalesce(new.ac, ac)
    where id = new.token_id;
  end if;
  return new;
end;
$$;
drop trigger if exists combatants_token_battle_defaults on public.combatants;
create trigger combatants_token_battle_defaults
  after update of max_hp, ac on public.combatants
  for each row execute function public.sync_token_battle_defaults();

-- Transferring a token to a different player must also transfer its combatant.
-- Otherwise its old owner retains HP controls while the new owner has none.
create or replace function public.sync_combatant_owner_from_token()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.owner_user_id is distinct from new.owner_user_id then
    update public.combatants
      set user_id = new.owner_user_id,
          is_player = (new.owner_user_id is not null)
      where token_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists tokens_combatant_owner on public.tokens;
create trigger tokens_combatant_owner
  after update of owner_user_id on public.tokens
  for each row execute function public.sync_combatant_owner_from_token();

revoke all on function public.sync_token_battle_defaults()
  from public, anon, authenticated;
revoke all on function public.sync_combatant_owner_from_token()
  from public, anon, authenticated;
