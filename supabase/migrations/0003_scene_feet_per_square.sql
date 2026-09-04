-- Malvidra Encounter — 0003
-- Movement ruler: how many feet one grid square represents (D&D 5e default 5).

alter table public.scenes
  add column if not exists feet_per_square int not null default 5;
