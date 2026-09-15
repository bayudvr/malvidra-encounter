-- Cast-to-device support.
--
-- The "Cast" screen (`/rooms/<id>/cast`) is DM-only: the DM opens it in a
-- second window and drops it on a projector. To cast it to a *Chromecast /
-- smart display* via the browser Presentation API, the receiver device loads
-- the URL itself as an anonymous browser with no Supabase session — so it
-- needs an unauthenticated, per-room, revocable way in.
--
-- `rooms.cast_token` is that key. The public route `/cast/<token>` sends it as
-- an `x-cast-token` request header; `cast_room_id()` resolves the header to a
-- room id, and every room-scoped SELECT policy gains an `or <table>.room_id =
-- cast_room_id()` branch. It grants READ ONLY, and only to the same
-- player-perspective data a guest already sees (fog opaque, hidden tokens
-- gone, monster stats hidden — enforced client-side in CastView, same as the
-- authed cast screen). Writes stay DM-only.
--
-- `request.headers` is only populated for PostgREST (REST) requests, so this
-- branch never widens Realtime subscriptions — the cast screen polls instead.

-------------------------------------------------------------------------------
-- rooms.cast_token
-------------------------------------------------------------------------------
alter table public.rooms
  add column if not exists cast_token text not null
    default encode(gen_random_bytes(16), 'hex');

-- Backfill any pre-existing rows that took a shared default at add-column time
-- (they won't have, given the volatile default, but be explicit) and lock in
-- uniqueness.
create unique index if not exists rooms_cast_token_key on public.rooms (cast_token);

-------------------------------------------------------------------------------
-- Header -> room resolution
-------------------------------------------------------------------------------
create or replace function public.cast_token_from_request()
returns text
language sql
stable
as $$
  select nullif(
    current_setting('request.headers', true)::json ->> 'x-cast-token',
    ''
  );
$$;

create or replace function public.cast_room_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select r.id
  from public.rooms r
  where r.cast_token = public.cast_token_from_request()
  limit 1;
$$;

-------------------------------------------------------------------------------
-- rotate_cast_token: DM revokes an old cast link
-------------------------------------------------------------------------------
create or replace function public.rotate_cast_token(p_room uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if not public.is_room_dm(p_room) then
    raise exception 'only the DM can rotate the cast token';
  end if;
  v_token := encode(gen_random_bytes(16), 'hex');
  update public.rooms set cast_token = v_token where id = p_room;
  return v_token;
end;
$$;

-------------------------------------------------------------------------------
-- SELECT policies: add the cast-token read branch
-------------------------------------------------------------------------------

-- rooms ----------------------------------------------------------------------
drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms
  for select using (
    dm_id = auth.uid()
    or public.is_room_member(id)
    or id = public.cast_room_id()
  );

-- room_members -------------------------------------------------------------
drop policy if exists room_members_select on public.room_members;
create policy room_members_select on public.room_members
  for select using (
    user_id = auth.uid()
    or public.is_room_dm(room_id)
    or public.is_room_member(room_id)
    or room_id = public.cast_room_id()
  );

-- profiles ----------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1
      from public.room_members me
      join public.room_members them on them.room_id = me.room_id
      where me.user_id = auth.uid() and them.user_id = profiles.id
    )
    or exists (
      select 1 from public.room_members rm
      where rm.user_id = profiles.id and rm.room_id = public.cast_room_id()
    )
  );

-- assets / scenes / tokens / combatants / fog_polygons / fog_doors --------
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'assets', 'scenes', 'tokens', 'combatants', 'fog_polygons', 'fog_doors'
  ]
  loop
    execute format('drop policy if exists %1$s_select on public.%1$s', tbl);
    execute format(
      'create policy %1$s_select on public.%1$s for select using ('
      || 'public.is_room_member(room_id) or public.is_room_dm(room_id) '
      || 'or room_id = public.cast_room_id())',
      tbl
    );
  end loop;
end;
$$;
