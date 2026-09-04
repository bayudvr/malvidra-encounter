-- Malvidra Encounter — 0009
-- Token size now follows D&D 5e categories (Tiny=0.5 .. Gargantuan=4 grid
-- squares) instead of a plain 1-3 picker — Tiny needs a fractional value,
-- so widen the column from int to numeric.

alter table public.tokens
  alter column size type numeric using size::numeric,
  alter column size set default 1;
