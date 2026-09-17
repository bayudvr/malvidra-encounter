-- Malvidra Encounter — 0019
-- DM-only free-text scratchpad, one per room: session prep to read from, or running notes typed
-- during play and copied out to Obsidian afterwards (not synced with it — this is a workspace,
-- not an integration). A separate table (not a `rooms.notes` column) on purpose: `rooms` itself
-- is readable by any room member (0001's rooms_select policy), so a column there would need its
-- own column-level guard everywhere it's selected — easy to leak. A dedicated table with its own
-- DM-only RLS (same pattern as room_webhooks, 0006) can't leak that way.
create table if not exists public.dm_notes (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  content text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.dm_notes enable row level security;

drop policy if exists dm_notes_select on public.dm_notes;
create policy dm_notes_select on public.dm_notes
  for select using (public.is_room_dm(room_id));

drop policy if exists dm_notes_write on public.dm_notes;
create policy dm_notes_write on public.dm_notes
  for all using (public.is_room_dm(room_id))
  with check (public.is_room_dm(room_id));

-- NOTE: deliberately NOT added to the supabase_realtime publication — DM-only scratchpad,
-- nobody else needs it pushed live (same reasoning as room_webhooks).
