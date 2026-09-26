-- Malvidra Encounter — 0026
-- Default owner on a library asset, so a player's character can be assigned once in the token
-- library instead of re-picking the owner on every token after it's dropped onto a scene. Copied
-- onto the token at drop time — same "snapshot, not a live reference" pattern hp/ac/image_url
-- use (0015) — so changing it later doesn't reassign tokens already placed. No RLS change: assets
-- are DM-managed already. `if not exists` because db-push.mjs replays every migration.

alter table public.assets
  add column if not exists owner_user_id uuid references public.profiles (id) on delete set null;
