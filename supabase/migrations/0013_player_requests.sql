-- Player -> DM attention requests: the reverse direction of scene spotlight
-- (0010, DM -> player). PBP over Discord with the map here means the DM
-- needs a lightweight in-app "ping me" a player can send without a full
-- chat feature — these stack (multiple pending at once) until the DM (or
-- the sender) dismisses each one.

create table public.player_requests (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

alter table public.player_requests enable row level security;
-- Filtered realtime subscriptions (room_id=eq.<id>) only see DELETEs if the
-- table is FULL replica identity -- see [[supabase-realtime-delete-gotcha]].
alter table public.player_requests replica identity full;
create index player_requests_room_idx on public.player_requests (room_id);

drop policy if exists player_requests_select on public.player_requests;
create policy player_requests_select on public.player_requests
  for select using (public.is_room_dm(room_id) or user_id = auth.uid());

drop policy if exists player_requests_insert on public.player_requests;
create policy player_requests_insert on public.player_requests
  for insert with check (user_id = auth.uid() and public.is_room_member(room_id));

drop policy if exists player_requests_delete on public.player_requests;
create policy player_requests_delete on public.player_requests
  for delete using (public.is_room_dm(room_id) or user_id = auth.uid());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'player_requests'
  ) then
    alter publication supabase_realtime add table public.player_requests;
  end if;
end;
$$;
