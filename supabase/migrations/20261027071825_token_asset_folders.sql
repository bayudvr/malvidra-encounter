-- Room-scoped, DM-managed organization of the existing token library.
create table if not exists public.asset_folders (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  constraint asset_folders_name_check check (name = btrim(name) and length(name) between 1 and 80),
  constraint asset_folders_room_id_id_key unique (room_id, id)
);

create unique index if not exists asset_folders_room_name_idx
  on public.asset_folders(room_id, lower(name));

alter table public.asset_folders enable row level security;
revoke all on public.asset_folders from anon, authenticated;
grant select, insert, update, delete on public.asset_folders to authenticated;

drop policy if exists asset_folders_select on public.asset_folders;
create policy asset_folders_select on public.asset_folders
  for select to authenticated using (public.is_room_dm(room_id));
drop policy if exists asset_folders_insert on public.asset_folders;
create policy asset_folders_insert on public.asset_folders
  for insert to authenticated with check (public.is_room_dm(room_id));
drop policy if exists asset_folders_update on public.asset_folders;
create policy asset_folders_update on public.asset_folders
  for update to authenticated using (public.is_room_dm(room_id))
  with check (public.is_room_dm(room_id));
drop policy if exists asset_folders_delete on public.asset_folders;
create policy asset_folders_delete on public.asset_folders
  for delete to authenticated using (public.is_room_dm(room_id));

alter table public.assets add column if not exists folder_id uuid;
alter table public.assets drop constraint if exists assets_folder_room_fk;
alter table public.assets add constraint assets_folder_room_fk
  foreign key (room_id, folder_id) references public.asset_folders(room_id, id)
  on delete set null (folder_id);
create index if not exists assets_room_folder_idx on public.assets(room_id, folder_id);

-- Folder changes use an empty room broadcast followed by an RLS-protected
-- re-fetch, rather than exposing private folder names in Realtime DELETE data.
notify pgrst, 'reload schema';
