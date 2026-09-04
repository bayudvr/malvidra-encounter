-- Malvidra Encounter — 0006
-- Optional per-room Discord webhook: combat / dice / scene events get
-- posted to a Discord channel via a DB trigger (pg_net), never through the
-- browser — the webhook URL is a bearer secret and must never reach player
-- clients, so it lives in its own DM-only-readable table, separate from
-- `rooms` (which players can already select).

create extension if not exists pg_net;

create table if not exists public.room_webhooks (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null unique references public.rooms (id) on delete cascade,
  discord_webhook_url text not null,
  notify_combat boolean not null default true,
  notify_dice boolean not null default true,
  notify_scene boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.room_webhooks enable row level security;

drop policy if exists room_webhooks_select on public.room_webhooks;
create policy room_webhooks_select on public.room_webhooks
  for select using (public.is_room_dm(room_id));

drop policy if exists room_webhooks_write on public.room_webhooks;
create policy room_webhooks_write on public.room_webhooks
  for all using (public.is_room_dm(room_id)) with check (public.is_room_dm(room_id));

-- NOTE: deliberately NOT added to the supabase_realtime publication — this
-- table is DM settings, nobody else needs it pushed live.

-------------------------------------------------------------------------------
-- Delivery helper — looks up the room's webhook, checks the category is
-- enabled, and fires the HTTP POST. Swallows its own errors so a bad/removed
-- webhook can never break the game action that triggered it.
-------------------------------------------------------------------------------
create or replace function public.notify_discord(
  p_room_id uuid,
  p_category text,
  p_message text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text;
  v_enabled boolean;
begin
  select
    discord_webhook_url,
    case p_category
      when 'combat' then notify_combat
      when 'dice' then notify_dice
      when 'scene' then notify_scene
      else false
    end
  into v_url, v_enabled
  from public.room_webhooks
  where room_id = p_room_id;

  if v_url is null or not v_enabled then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('content', p_message, 'username', 'Malvidra Encounter')
  );
exception when others then
  raise warning 'notify_discord failed for room %: %', p_room_id, sqlerrm;
end;
$$;

create or replace function public.send_test_discord_webhook(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text;
begin
  if not public.is_room_dm(p_room) then
    raise exception 'only the DM can test this room''s webhook';
  end if;

  select discord_webhook_url into v_url
  from public.room_webhooks
  where room_id = p_room;

  if v_url is null then
    raise exception 'No webhook URL configured for this room';
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'content', '✅ Malvidra Encounter webhook is wired up correctly.',
      'username', 'Malvidra Encounter'
    )
  );
end;
$$;

-------------------------------------------------------------------------------
-- Dice rolls
-------------------------------------------------------------------------------
create or replace function public.trg_notify_dice_roll()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.notify_discord(
    new.room_id,
    'dice',
    format('🎲 **%s** rolled `%s` = **%s**', new.actor_name, new.notation, new.total)
  );
  return new;
end;
$$;

drop trigger if exists dice_rolls_notify on public.dice_rolls;
create trigger dice_rolls_notify
after insert on public.dice_rolls
for each row execute function public.trg_notify_dice_roll();

-------------------------------------------------------------------------------
-- Scene: active scene changed (on rooms), map changed, combat mode, turn
-------------------------------------------------------------------------------
create or replace function public.trg_notify_active_scene()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text;
begin
  if new.active_scene_id is distinct from old.active_scene_id
     and new.active_scene_id is not null then
    select name into v_name from public.scenes where id = new.active_scene_id;
    perform public.notify_discord(
      new.id, 'scene',
      format('📍 Scene changed to **%s**', coalesce(v_name, 'Unknown'))
    );
  end if;
  return new;
end;
$$;

drop trigger if exists rooms_notify_active_scene on public.rooms;
create trigger rooms_notify_active_scene
after update on public.rooms
for each row execute function public.trg_notify_active_scene();

create or replace function public.trg_notify_map_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_active_id uuid;
begin
  if new.map_url is distinct from old.map_url then
    select active_scene_id into v_active_id
    from public.rooms where id = new.room_id;

    if v_active_id = new.id then
      perform public.notify_discord(
        new.room_id, 'scene',
        format('🗺️ Map updated for **%s**', new.name)
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists scenes_notify_map on public.scenes;
create trigger scenes_notify_map
after update on public.scenes
for each row execute function public.trg_notify_map_change();

create or replace function public.trg_notify_combat_mode()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.mode is distinct from old.mode then
    if new.mode = 'combat' then
      perform public.notify_discord(
        new.room_id, 'combat',
        format('⚔️ Combat started in **%s**', new.name)
      );
    else
      perform public.notify_discord(
        new.room_id, 'combat',
        format('🏁 Combat ended in **%s**', new.name)
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists scenes_notify_combat_mode on public.scenes;
create trigger scenes_notify_combat_mode
after update on public.scenes
for each row execute function public.trg_notify_combat_mode();

create or replace function public.trg_notify_turn_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text;
begin
  if new.active_combatant_id is distinct from old.active_combatant_id
     and new.active_combatant_id is not null then
    select name into v_name
    from public.combatants where id = new.active_combatant_id;
    perform public.notify_discord(
      new.room_id, 'combat',
      format('➡️ It''s now **%s**''s turn (round %s)', coalesce(v_name, 'someone'), new.round)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists scenes_notify_turn on public.scenes;
create trigger scenes_notify_turn
after update on public.scenes
for each row execute function public.trg_notify_turn_change();

-------------------------------------------------------------------------------
-- Combatant downed (non-PC dropped to 0 HP)
-------------------------------------------------------------------------------
create or replace function public.trg_notify_combatant_downed()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not new.is_player
     and new.hp is not null and new.hp <= 0
     and (old.hp is null or old.hp > 0) then
    perform public.notify_discord(
      new.room_id, 'combat',
      format('💀 **%s** has fallen!', new.name)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists combatants_notify_downed on public.combatants;
create trigger combatants_notify_downed
after update on public.combatants
for each row execute function public.trg_notify_combatant_downed();
