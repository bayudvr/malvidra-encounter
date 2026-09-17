-- Malvidra Encounter — 0018
-- DM-only D&D reference library ("5e" panel): search a small local index (public/
-- reference-index.json, built from 5etools' data by scripts/build-reference-index.mjs) for a
-- monster/spell/condition, lazy-fetch its full entry from raw.githubusercontent.com on select,
-- and optionally pin it here so it's available again without re-fetching. Pure DM utility — no
-- player ever needs this, so (like room_webhooks, 0006) it's DM-only on both read and write and
-- deliberately not added to the realtime publication.
create table if not exists public.saved_references (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  name text not null,
  type text not null, -- "monster" | "spell" | "condition" | "disease" | "status"
  source text,
  -- The full fetched entry (monster/spell) or the condition/disease/status's own entries —
  -- whatever was rendered when saved, so re-opening this never needs another fetch.
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.saved_references enable row level security;
create index if not exists saved_references_room_idx on public.saved_references (room_id);

drop policy if exists saved_references_select on public.saved_references;
create policy saved_references_select on public.saved_references
  for select using (public.is_room_dm(room_id));

drop policy if exists saved_references_write on public.saved_references;
create policy saved_references_write on public.saved_references
  for all using (public.is_room_dm(room_id))
  with check (public.is_room_dm(room_id));
