-- Malvidra Encounter — 0005
-- Configurable grid line appearance (color / opacity / thickness).

alter table public.scenes
  add column if not exists grid_color text not null default '#ffffff',
  add column if not exists grid_opacity numeric not null default 0.1,
  add column if not exists grid_thickness numeric not null default 1;
