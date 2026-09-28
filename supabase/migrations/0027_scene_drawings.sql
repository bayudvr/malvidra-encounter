-- Malvidra Encounter — 0027
-- Freehand drawings on a scene (Owlbear-style pen) — anyone in the room can sketch on the map to
-- show something, and it stays until erased. One row per stroke; points is a flat
-- [x0, y0, x1, y1, ...] array in map pixels, exactly what Konva's <Line points> takes. width is
-- also in map pixels (picked at draw time from the drawer's zoom, so a stroke looks the same
-- thickness to them as they drew it). Pings are NOT stored here — those are broadcast-only.

create table if not exists public.scene_drawings (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  points jsonb not null,
  color text not null default '#f59e0b',
  width numeric not null default 4,
  created_at timestamptz not null default now()
);

alter table public.scene_drawings enable row level security;
alter table public.scene_drawings replica identity full;
create index if not exists scene_drawings_scene_idx on public.scene_drawings (scene_id);
create index if not exists scene_drawings_room_idx on public.scene_drawings (room_id);

-------------------------------------------------------------------------------
-- RLS: the whole room (and its cast screen, 0014) sees every drawing. Anyone in the room may
-- draw as themselves; a stroke can be erased by whoever drew it, or by the DM. No update —
-- strokes are only ever added or removed.
-------------------------------------------------------------------------------
drop policy if exists scene_drawings_select on public.scene_drawings;
create policy scene_drawings_select on public.scene_drawings for select
  using (
    public.is_room_member(room_id) or public.is_room_dm(room_id)
    or room_id = public.cast_room_id()
  );

drop policy if exists scene_drawings_insert on public.scene_drawings;
create policy scene_drawings_insert on public.scene_drawings for insert
  with check (
    user_id = auth.uid()
    and (public.is_room_member(room_id) or public.is_room_dm(room_id))
  );

drop policy if exists scene_drawings_delete on public.scene_drawings;
create policy scene_drawings_delete on public.scene_drawings for delete
  using (user_id = auth.uid() or public.is_room_dm(room_id));

-------------------------------------------------------------------------------
-- Realtime
-------------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'scene_drawings'
  ) then
    alter publication supabase_realtime add table public.scene_drawings;
  end if;
end;
$$;
