-- Inner walls: freehand closed shapes (same authoring model as fog_polygons,
-- 0012) whose edges block token movement. Independent of fog_of_war (a scene
-- with fog disabled can still have walls) and independent of fog_doors — a
-- wall is a permanent barrier, not something the DM ever toggles open/closed
-- like a door. Purely a collision aid: never rendered to players, only the DM
-- sees the outline while placing/managing them.
create table if not exists public.walls (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  points jsonb not null, -- [[x,y], [x,y], ...], >= 3 points, implicitly closed
  created_at timestamptz not null default now()
);

alter table public.walls enable row level security;
alter table public.walls replica identity full;
create index if not exists walls_scene_idx on public.walls (scene_id);
create index if not exists walls_room_idx on public.walls (room_id);

-------------------------------------------------------------------------------
-- RLS: same room-scoped pattern as fog_polygons/fog_doors (0001/0012).
-------------------------------------------------------------------------------
drop policy if exists walls_select on public.walls;
create policy walls_select on public.walls for select
  using (public.is_room_member(room_id) or public.is_room_dm(room_id));

drop policy if exists walls_write on public.walls;
create policy walls_write on public.walls for all
  using (public.is_room_dm(room_id))
  with check (public.is_room_dm(room_id));

-------------------------------------------------------------------------------
-- Realtime
-------------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'walls'
  ) then
    alter publication supabase_realtime add table public.walls;
  end if;
end;
$$;
