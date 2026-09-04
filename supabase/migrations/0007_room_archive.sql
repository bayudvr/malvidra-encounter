-- Malvidra Encounter — 0007
-- Let a DM archive a room (e.g. a finished West-March mission) instead of
-- deleting it — hides it from the default room list without losing history.

alter table public.rooms
  add column if not exists archived_at timestamptz;
