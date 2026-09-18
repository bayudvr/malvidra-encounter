-- Malvidra Encounter — 0022
-- Persist which bestiary monster a token was spawned from (name/source/CR), set once by the
-- encounter builder at spawn time and left null for every other token-creation path (manual
-- drop, asset drag). Nothing today links a token/combatant back to its 5etools origin once
-- created — this is needed so a "loot this monster" action later knows the token's CR without
-- re-searching the reference index. CR is text, not numeric: 5e CRs include fractions ("1/8",
-- "1/4", "1/2"). No RLS change needed, same as 0009 (plain column add to an existing table).

alter table public.tokens
  add column monster_name text,
  add column monster_source text,
  add column monster_cr text;
