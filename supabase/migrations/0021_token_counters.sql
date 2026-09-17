-- Malvidra Encounter — 0021
-- Generic per-token counters (name + current/max), same idea as 5etools' DM Screen "custom
-- counter" widget — legendary resistances, lair actions, recharge abilities, whatever the DM
-- needs to track for a monster. Deliberately just three fields, no per-type logic. DM-only:
-- players track their own resources (spell slots included) on their own character sheet, so
-- this never needs owner-editable access like tokens_owner_move (0002) does for dragging — same
-- DM-only read+write pattern as room_webhooks (0006)/saved_references/dm_notes.
create table if not exists public.token_counters (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references public.tokens (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  name text not null default 'Counter',
  current integer not null default 0,
  max integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.token_counters enable row level security;
create index if not exists token_counters_token_idx on public.token_counters (token_id);
create index if not exists token_counters_room_idx on public.token_counters (room_id);

drop policy if exists token_counters_select on public.token_counters;
create policy token_counters_select on public.token_counters
  for select using (public.is_room_dm(room_id));

drop policy if exists token_counters_write on public.token_counters;
create policy token_counters_write on public.token_counters
  for all using (public.is_room_dm(room_id))
  with check (public.is_room_dm(room_id));

-- NOTE: deliberately NOT added to the supabase_realtime publication, same reasoning as
-- room_webhooks (0006) — the only place this renders is the DM's own TokenInspector, no second
-- window/Cast screen ever shows it (Cast is forced player role).
