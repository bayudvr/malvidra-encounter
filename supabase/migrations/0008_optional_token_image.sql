-- Malvidra Encounter — 0008
-- A library token can be created without an image — it renders as a
-- colored circle with initials instead (see tokenInitials() client-side).

alter table public.assets
  alter column image_url drop not null;
