-- Malvidra Encounter — 0030
-- Room-wide house-rule counters independent of tokens and scenes.
-- 'private' is the safe default; public rows are visible to room members.
-- Only the room DM may create, change, or delete counters.
create table if not exists public.room_counters (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  name text not null default 'Counter',
  current integer not null default 0,
  max integer not null default 0,
  visibility text not null default 'private',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint room_counters_name_check check (length(btrim(name)) between 1 and 120),
  constraint room_counters_max_check check (max >= 0),
  constraint room_counters_current_check check (current >= 0 and (max = 0 or current <= max)),
  constraint room_counters_visibility_check check (visibility in ('public', 'private'))
);

create index if not exists room_counters_room_idx
  on public.room_counters(room_id, sort_order, created_at);

alter table public.room_counters enable row level security;

drop policy if exists room_counters_select on public.room_counters;
create policy room_counters_select on public.room_counters
  for select to authenticated
  using (
    public.is_room_dm(room_id)
    or (visibility = 'public' and public.is_room_member(room_id))
  );

drop policy if exists room_counters_insert on public.room_counters;
create policy room_counters_insert on public.room_counters
  for insert to authenticated
  with check (public.is_room_dm(room_id));

drop policy if exists room_counters_update on public.room_counters;
create policy room_counters_update on public.room_counters
  for update to authenticated
  using (public.is_room_dm(room_id))
  with check (public.is_room_dm(room_id));

drop policy if exists room_counters_delete on public.room_counters;
create policy room_counters_delete on public.room_counters
  for delete to authenticated
  using (public.is_room_dm(room_id));

-- New Supabase projects may not grant implicit Data API permissions.
revoke all on public.room_counters from anon, authenticated;
grant select, insert, update, delete on public.room_counters to authenticated;

-- Deliberately NOT in supabase_realtime publication. For private counters,
-- postgres_changes DELETE events cannot be filtered by RLS on old values.
-- RoomCountersPanel broadcasts ONLY an empty "changed" nudge and re-fetches
-- through RLS. No counter names/values are ever included in broadcasts.
