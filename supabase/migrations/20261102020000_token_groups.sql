-- Reusable scene deployment presets. Group templates are DM-owned and
-- room-scoped, while placed tokens remain normal independent instances.
create table if not exists public.token_groups (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (id, room_id)
);

-- Composite constraints ensure a group never references another room's assets.
create unique index if not exists assets_id_room_unique
  on public.assets (id, room_id);

create table if not exists public.token_group_items (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null,
  group_id uuid not null,
  asset_id uuid not null,
  quantity integer not null default 1 check (quantity between 1 and 40),
  sort_order integer not null default 0,
  unique (group_id, asset_id),
  constraint token_group_items_group_fk foreign key (group_id, room_id)
    references public.token_groups (id, room_id) on delete cascade,
  constraint token_group_items_asset_fk foreign key (asset_id, room_id)
    references public.assets (id, room_id) on delete cascade
);

create index if not exists token_groups_room_idx on public.token_groups(room_id);
create index if not exists token_group_items_group_idx on public.token_group_items(group_id);

alter table public.token_groups enable row level security;
alter table public.token_group_items enable row level security;

drop policy if exists token_groups_dm on public.token_groups;
create policy token_groups_dm on public.token_groups for all to authenticated
  using (public.is_room_dm(room_id))
  with check (public.is_room_dm(room_id));

drop policy if exists token_group_items_dm on public.token_group_items;
create policy token_group_items_dm on public.token_group_items for all to authenticated
  using (public.is_room_dm(room_id))
  with check (public.is_room_dm(room_id));

grant select, insert, update, delete on public.token_groups to authenticated;
grant select, insert, update, delete on public.token_group_items to authenticated;
revoke all on public.token_groups, public.token_group_items from anon;

-- Transactional deployment: either every token is placed hidden or none are.
-- Uses the same source-of-truth spawn RPC as manual + Scene / drag placement.
create or replace function public.deploy_token_group(p_group uuid, p_scene uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_group public.token_groups;
  v_scene public.scenes;
  v_item record;
  v_total int;
  v_index int := 0;
  v_i int;
  v_grid int;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_group from public.token_groups where id = p_group;
  if not found or not public.is_room_dm(v_group.room_id) then
    raise exception 'Only the DM may deploy a room group';
  end if;
  select * into v_scene from public.scenes
    where id = p_scene and room_id = v_group.room_id;
  if not found then raise exception 'Scene must be in the same room'; end if;

  select coalesce(sum(quantity),0)::int into v_total
    from public.token_group_items where group_id = p_group;
  if v_total < 1 or v_total > 60 then
    raise exception 'A group must contain 1 to 60 token instances';
  end if;

  v_grid := greatest(1, v_scene.grid_size);
  for v_item in
    select asset_id, quantity
    from public.token_group_items
    where group_id = p_group and room_id = v_group.room_id
    order by sort_order, id
  loop
    for v_i in 1..v_item.quantity loop
      perform public.spawn_asset_token(
        p_scene, v_item.asset_id,
        ((2 + v_index % 6) * v_grid + v_grid / 2.0)::double precision,
        ((2 + v_index / 6) * v_grid + v_grid / 2.0)::double precision,
        false
      );
      v_index := v_index + 1;
    end loop;
  end loop;
  return v_index;
end;
$$;
revoke all on function public.deploy_token_group(uuid, uuid) from public, anon;
grant execute on function public.deploy_token_group(uuid, uuid) to authenticated;
