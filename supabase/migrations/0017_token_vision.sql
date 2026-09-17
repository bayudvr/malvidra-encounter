-- Malvidra Encounter — 0017
-- Per-token line-of-sight vision: a player-owned token with a vision radius
-- punches a hole in fog_of_war shaped by what it can actually see (occluded
-- by walls and by the edges of any fog_polygon room that isn't currently
-- revealed) instead of the DM manually toggling doors/rooms alone. Nullable,
-- default null — no radius means the token doesn't contribute a reveal at
-- all (the existing manual door-based reveal is untouched either way).
alter table public.tokens
  add column if not exists vision_radius_ft numeric;
