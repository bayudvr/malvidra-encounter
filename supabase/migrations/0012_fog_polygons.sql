-- Replace the rectangle-door / per-cell fog model (migration 0011) with
-- freehand room polygons + wall-segment doors that physically block token
-- movement. That model shipped earlier this same session with no real fog
-- data from actual play yet, so dropping and replacing outright instead of
-- migrating rows.

drop table if exists public.fog_cells;
drop table if exists public.fog_doors;

-------------------------------------------------------------------------------
-- fog_polygons: a freehand closed room shape. Its interior is revealed the
-- moment it exists — deleting the row re-covers that area.
-------------------------------------------------------------------------------
create table public.fog_polygons (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  points jsonb not null, -- [[x,y], [x,y], ...], >= 3 points, implicitly closed
  created_at timestamptz not null default now()
);

alter table public.fog_polygons enable row level security;
alter table public.fog_polygons replica identity full;
create index fog_polygons_scene_idx on public.fog_polygons (scene_id);
create index fog_polygons_room_idx on public.fog_polygons (room_id);

-------------------------------------------------------------------------------
-- fog_doors: a wall segment (placed on a polygon's edge) that blocks token
-- movement across it while closed. Decoupled from any specific polygon/edge
-- index by design -- it's just a line segment -- so editing a polygon's
-- shape later can't orphan or misalign a door.
-------------------------------------------------------------------------------
create table public.fog_doors (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  x1 double precision not null,
  y1 double precision not null,
  x2 double precision not null,
  y2 double precision not null,
  is_open boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.fog_doors enable row level security;
alter table public.fog_doors replica identity full;
create index fog_doors_scene_idx on public.fog_doors (scene_id);
create index fog_doors_room_idx on public.fog_doors (room_id);

-------------------------------------------------------------------------------
-- RLS + realtime: same room-scoped pattern as 0001/0011 (re-declared since
-- these tables were just dropped and recreated).
-------------------------------------------------------------------------------
do $$
declare
  tbl text;
begin
  foreach tbl in array array['fog_polygons', 'fog_doors']
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

do $$
declare
  tbl text;
begin
  foreach tbl in array array['fog_polygons', 'fog_doors']
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
