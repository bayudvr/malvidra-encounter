-- Malvidra Encounter — initial schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).

-------------------------------------------------------------------------------
-- Extensions
-------------------------------------------------------------------------------
create extension if not exists pgcrypto;

-------------------------------------------------------------------------------
-- profiles
-------------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Adventurer',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      split_part(new.email, '@', 1),
      'Adventurer'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-------------------------------------------------------------------------------
-- rooms
-------------------------------------------------------------------------------
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  dm_id uuid not null references public.profiles (id) on delete cascade,
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),
  active_scene_id uuid,
  created_at timestamptz not null default now()
);

alter table public.rooms enable row level security;

-------------------------------------------------------------------------------
-- room_members
-------------------------------------------------------------------------------
create table if not exists public.room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('dm', 'player')),
  joined_at timestamptz not null default now(),
  unique (room_id, user_id)
);

alter table public.room_members enable row level security;
create index if not exists room_members_room_idx on public.room_members (room_id);
create index if not exists room_members_user_idx on public.room_members (user_id);

-------------------------------------------------------------------------------
-- Membership helper functions (security definer -> avoid RLS recursion)
-------------------------------------------------------------------------------
create or replace function public.is_room_member(p_room uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.room_members m
    where m.room_id = p_room and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_room_dm(p_room uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.rooms r
    where r.id = p_room and r.dm_id = auth.uid()
  );
$$;

-------------------------------------------------------------------------------
-- assets (DM token library, per room)
-------------------------------------------------------------------------------
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  name text not null,
  image_url text not null,
  created_at timestamptz not null default now()
);

alter table public.assets enable row level security;
create index if not exists assets_room_idx on public.assets (room_id);

-------------------------------------------------------------------------------
-- scenes
-------------------------------------------------------------------------------
create table if not exists public.scenes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  name text not null,
  mode text not null default 'exploration' check (mode in ('exploration', 'combat')),
  map_url text,
  grid_size int not null default 70,
  grid_enabled boolean not null default true,
  snap_to_grid boolean not null default true,
  position int not null default 0,
  round int not null default 1,
  active_combatant_id uuid,
  created_at timestamptz not null default now()
);

alter table public.scenes enable row level security;
create index if not exists scenes_room_idx on public.scenes (room_id);

-- rooms.active_scene_id -> scenes (added after scenes exists)
alter table public.rooms
  drop constraint if exists rooms_active_scene_fk;
alter table public.rooms
  add constraint rooms_active_scene_fk
  foreign key (active_scene_id) references public.scenes (id) on delete set null;

-------------------------------------------------------------------------------
-- tokens
-------------------------------------------------------------------------------
create table if not exists public.tokens (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  asset_id uuid references public.assets (id) on delete set null,
  label text not null default 'Token',
  image_url text,
  x double precision not null default 0,
  y double precision not null default 0,
  size int not null default 1,
  color text,
  owner_user_id uuid references public.profiles (id) on delete set null,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.tokens enable row level security;
create index if not exists tokens_scene_idx on public.tokens (scene_id);
create index if not exists tokens_room_idx on public.tokens (room_id);

-------------------------------------------------------------------------------
-- combatants
-------------------------------------------------------------------------------
create table if not exists public.combatants (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  name text not null,
  initiative numeric,
  sort_order int not null default 0,
  hp int,
  max_hp int,
  ac int,
  is_player boolean not null default false,
  user_id uuid references public.profiles (id) on delete set null,
  token_id uuid references public.tokens (id) on delete set null,
  conditions text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.combatants enable row level security;
create index if not exists combatants_scene_idx on public.combatants (scene_id);
create index if not exists combatants_room_idx on public.combatants (room_id);

-------------------------------------------------------------------------------
-- join_room RPC (players self-join via invite code)
-------------------------------------------------------------------------------
create or replace function public.join_room(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select id into v_room_id
  from public.rooms
  where invite_code = upper(trim(p_code));

  if v_room_id is null then
    raise exception 'invalid invite code';
  end if;

  insert into public.room_members (room_id, user_id, role)
  values (v_room_id, auth.uid(), 'player')
  on conflict (room_id, user_id) do nothing;

  return v_room_id;
end;
$$;

-------------------------------------------------------------------------------
-- seed_player_combatants RPC (called by DM when starting combat)
-------------------------------------------------------------------------------
create or replace function public.seed_player_combatants(p_scene uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
begin
  select room_id into v_room_id from public.scenes where id = p_scene;
  if v_room_id is null then
    raise exception 'scene not found';
  end if;
  if not public.is_room_dm(v_room_id) then
    raise exception 'only the DM can seed combatants';
  end if;

  insert into public.combatants (scene_id, room_id, name, is_player, user_id, token_id)
  select
    p_scene,
    v_room_id,
    coalesce(p.display_name, 'Player'),
    true,
    m.user_id,
    (select t.id from public.tokens t
       where t.scene_id = p_scene and t.owner_user_id = m.user_id
       order by t.created_at limit 1)
  from public.room_members m
  join public.profiles p on p.id = m.user_id
  where m.room_id = v_room_id
    and m.role = 'player'
    and not exists (
      select 1 from public.combatants c
      where c.scene_id = p_scene and c.user_id = m.user_id
    );
end;
$$;

-------------------------------------------------------------------------------
-- RLS policies
-------------------------------------------------------------------------------

-- profiles ---------------------------------------------------------------
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
  );

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- rooms ------------------------------------------------------------------
drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms
  for select using (dm_id = auth.uid() or public.is_room_member(id));

drop policy if exists rooms_insert on public.rooms;
create policy rooms_insert on public.rooms
  for insert with check (dm_id = auth.uid());

drop policy if exists rooms_update on public.rooms;
create policy rooms_update on public.rooms
  for update using (dm_id = auth.uid()) with check (dm_id = auth.uid());

drop policy if exists rooms_delete on public.rooms;
create policy rooms_delete on public.rooms
  for delete using (dm_id = auth.uid());

-- room_members ---------------------------------------------------------
drop policy if exists room_members_select on public.room_members;
create policy room_members_select on public.room_members
  for select using (user_id = auth.uid() or public.is_room_dm(room_id) or public.is_room_member(room_id));

drop policy if exists room_members_insert on public.room_members;
create policy room_members_insert on public.room_members
  for insert with check (public.is_room_dm(room_id));

drop policy if exists room_members_update on public.room_members;
create policy room_members_update on public.room_members
  for update using (public.is_room_dm(room_id)) with check (public.is_room_dm(room_id));

drop policy if exists room_members_delete on public.room_members;
create policy room_members_delete on public.room_members
  for delete using (public.is_room_dm(room_id) or user_id = auth.uid());

-- generic room-scoped tables: assets / scenes / tokens / combatants ----
do $$
declare
  tbl text;
begin
  foreach tbl in array array['assets', 'scenes', 'tokens', 'combatants']
  loop
    execute format('drop policy if exists %1$s_select on public.%1$s', tbl);
    execute format(
      'create policy %1$s_select on public.%1$s for select using (public.is_room_member(room_id) or public.is_room_dm(room_id))',
      tbl
    );
    execute format('drop policy if exists %1$s_write on public.%1$s', tbl);
    execute format(
      'create policy %1$s_write on public.%1$s for all using (public.is_room_dm(room_id)) with check (public.is_room_dm(room_id))',
      tbl
    );
  end loop;
end;
$$;

-- NOTE (future): to let a player drag their own token, add:
--   create policy tokens_owner_move on public.tokens for update
--     using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

-------------------------------------------------------------------------------
-- Realtime
-------------------------------------------------------------------------------
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'rooms', 'room_members', 'scenes', 'tokens', 'combatants', 'assets'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = tbl
    ) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    end if;
  end loop;
end;
$$;
