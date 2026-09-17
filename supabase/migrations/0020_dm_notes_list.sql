-- Malvidra Encounter — 0020
-- Replace the one-row-per-room dm_notes (0019) with a list: multiple named notes per room,
-- same shape as saved_references' list+detail UI. That table shipped in this same session with
-- no real notes saved from actual play yet, so dropping and replacing outright instead of
-- migrating rows (same call as 0012 made for fog_cells/fog_doors).
drop table if exists public.dm_notes;

create table if not exists public.dm_notes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  title text not null default 'Untitled',
  -- Markdown — rendered read-only (react-markdown) in the panel, plain-text edited, same
  -- edit/preview split as Obsidian's own editor. Copy-pasted out to Obsidian as-is when done.
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dm_notes enable row level security;
create index if not exists dm_notes_room_idx on public.dm_notes (room_id);

drop policy if exists dm_notes_select on public.dm_notes;
create policy dm_notes_select on public.dm_notes
  for select using (public.is_room_dm(room_id));

drop policy if exists dm_notes_write on public.dm_notes;
create policy dm_notes_write on public.dm_notes
  for all using (public.is_room_dm(room_id))
  with check (public.is_room_dm(room_id));

-- NOTE: deliberately NOT added to the supabase_realtime publication — DM-only scratchpad,
-- nobody else needs it pushed live (same reasoning as room_webhooks, 0006).
