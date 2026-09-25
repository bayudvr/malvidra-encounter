-- Malvidra Encounter — 0024
-- Room chat log. Mirrors dice_rolls (0004): append-only, room-scoped, realtime.
-- A message may optionally be spoken "as" a token (token_id) — that's what
-- triggers a speech bubble on the board (SceneCanvas/TokenSprite). token_id
-- null = plain OOC chat, no bubble.

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  token_id uuid references public.tokens (id) on delete set null,
  -- Snapshot of the speaker's display name at send time (token label, or the
  -- sender's profile name for OOC) — same reasoning as dice_rolls.actor_name:
  -- history stays readable even if the token is later renamed/deleted.
  speaker_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.chat_messages enable row level security;
create index if not exists chat_messages_room_idx
  on public.chat_messages (room_id, created_at desc);

drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages
  for select using (
    public.is_room_member(room_id) or public.is_room_dm(room_id)
  );

-- Speaking "as" a token is restricted: the DM may speak as any token in the
-- room, a player may only speak as a token they own (mirrors tokens_owner_move,
-- 0002) — otherwise a player could puppet another player's PC or an NPC.
-- token_id null (OOC) has no such restriction.
drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
  for insert with check (
    (public.is_room_member(room_id) or public.is_room_dm(room_id))
    and user_id = auth.uid()
    and (
      token_id is null
      or public.is_room_dm(room_id)
      or exists (
        select 1 from public.tokens t
        where t.id = token_id
          and t.room_id = room_id
          and t.owner_user_id = auth.uid()
      )
    )
  );
-- no update / delete policies: the log is append-only

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.chat_messages';
  end if;
end;
$$;
