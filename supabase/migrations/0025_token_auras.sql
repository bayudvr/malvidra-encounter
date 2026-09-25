-- Malvidra Encounter — 0025
-- Circle aura attached to a token — a persistent AoE-style ring around the
-- token that follows it automatically (SceneCanvas renders it at the live
-- token.x/token.y every frame, so no offset tracking is needed). Reuses the
-- same circle-AoE visual math as the transient measuring tool (AoeShape in
-- SceneCanvas.tsx), just persisted instead of drag-only. Multiple auras per
-- token are allowed (e.g. two different spell effects stacked).

create table if not exists public.token_auras (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references public.tokens (id) on delete cascade,
  scene_id uuid not null references public.scenes (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  radius_ft numeric not null default 10,
  color text not null default '#c084fc',
  created_at timestamptz not null default now()
);

alter table public.token_auras enable row level security;
alter table public.token_auras replica identity full;
create index if not exists token_auras_scene_idx on public.token_auras (scene_id);
create index if not exists token_auras_room_idx on public.token_auras (room_id);
create index if not exists token_auras_token_idx on public.token_auras (token_id);

-------------------------------------------------------------------------------
-- RLS: visible to the whole room (it's meant to be seen), but only
-- manageable by the DM or by the player who owns the token it's on —
-- same ownership check as tokens_owner_move (0002) / chat_messages (0024).
-------------------------------------------------------------------------------
drop policy if exists token_auras_select on public.token_auras;
create policy token_auras_select on public.token_auras for select
  using (public.is_room_member(room_id) or public.is_room_dm(room_id));

drop policy if exists token_auras_write on public.token_auras;
create policy token_auras_write on public.token_auras for all
  using (
    public.is_room_dm(room_id)
    or exists (
      select 1 from public.tokens t
      where t.id = token_id and t.owner_user_id = auth.uid()
    )
  )
  with check (
    public.is_room_dm(room_id)
    or exists (
      select 1 from public.tokens t
      where t.id = token_id and t.owner_user_id = auth.uid()
    )
  );

-------------------------------------------------------------------------------
-- Realtime
-------------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'token_auras'
  ) then
    alter publication supabase_realtime add table public.token_auras;
  end if;
end;
$$;
