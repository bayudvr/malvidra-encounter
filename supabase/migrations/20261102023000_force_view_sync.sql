-- The DM alone can toggle forced player-camera following, via rooms RLS.
-- Camera coordinate broadcasts remain ephemeral; the toggle persists per room.
alter table public.rooms add column if not exists force_view_sync boolean not null default false;
