-- Malvidra Encounter — 0004
-- Shared dice-roll log. The 3D animation is local to each roller; only the
-- result is written here so the whole table sees what was rolled.

create table if not exists public.dice_rolls (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  actor_name text not null,
  notation text not null,
  detail jsonb not null default '[]'::jsonb,
  total int not null,
  created_at timestamptz not null default now()
);

alter table public.dice_rolls enable row level security;
create index if not exists dice_rolls_room_idx
  on public.dice_rolls (room_id, created_at desc);

drop policy if exists dice_rolls_select on public.dice_rolls;
create policy dice_rolls_select on public.dice_rolls
  for select using (
    public.is_room_member(room_id) or public.is_room_dm(room_id)
  );

drop policy if exists dice_rolls_insert on public.dice_rolls;
create policy dice_rolls_insert on public.dice_rolls
  for insert with check (
    (public.is_room_member(room_id) or public.is_room_dm(room_id))
    and user_id = auth.uid()
  );
-- no update / delete policies: the log is append-only

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'dice_rolls'
  ) then
    execute 'alter publication supabase_realtime add table public.dice_rolls';
  end if;
end;
$$;
