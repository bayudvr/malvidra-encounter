-- Fog of war: manual per-cell reveal + door/window rectangles that reveal
-- the cells they cover while open. No line-of-sight calculation — the DM
-- reveals cells directly (brush/click) or via a door toggle.

alter table public.scenes
  add column if not exists fog_enabled boolean not null default false,
  add column if not exists fog_color text not null default '#000000',
  add column if not exists fog_dm_opacity numeric not null default 0.1;

-------------------------------------------------------------------------------
-- fog_cells: one row per manually-revealed grid cell
-------------------------------------------------------------------------------
create table if not exists public.fog_cells (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  cell_x int not null,
  cell_y int not null,
  created_at timestamptz not null default now(),
  unique (scene_id, cell_x, cell_y)
);

alter table public.fog_cells enable row level security;
-- Filtered realtime subscriptions (room_id=eq.<id>) only see DELETEs if the
-- table is FULL replica identity -- see [[supabase-realtime-delete-gotcha]].
alter table public.fog_cells replica identity full;
create index if not exists fog_cells_scene_idx on public.fog_cells (scene_id);
create index if not exists fog_cells_room_idx on public.fog_cells (room_id);

-------------------------------------------------------------------------------
-- fog_doors: a rectangle that reveals the cells it covers while is_open
-------------------------------------------------------------------------------
create table if not exists public.fog_doors (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  label text,
  x double precision not null,
  y double precision not null,
  width double precision not null,
  height double precision not null,
  is_open boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.fog_doors enable row level security;
alter table public.fog_doors replica identity full;
create index if not exists fog_doors_scene_idx on public.fog_doors (scene_id);
create index if not exists fog_doors_room_idx on public.fog_doors (room_id);

-------------------------------------------------------------------------------
-- RLS: same room-scoped pattern as assets/scenes/tokens/combatants (0001) --
-- members can read, only the DM can write.
-------------------------------------------------------------------------------
do $$
declare
  tbl text;
begin
  foreach tbl in array array['fog_cells', 'fog_doors']
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

-------------------------------------------------------------------------------
-- Realtime
-------------------------------------------------------------------------------
do $$
declare
  tbl text;
begin
  foreach tbl in array array['fog_cells', 'fog_doors']
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
