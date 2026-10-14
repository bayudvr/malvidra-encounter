-- Malvidra Encounter — 0032
-- Explicitly remove anonymous Data API EXECUTE grants. Some Supabase projects
-- grant EXECUTE to anon directly through default privileges, not only PUBLIC.
-- The spawn RPC is DM-checked internally and must require an authenticated role.
revoke all on function public.spawn_asset_token(
  uuid, uuid, double precision, double precision, boolean
) from public, anon;
grant execute on function public.spawn_asset_token(
  uuid, uuid, double precision, double precision, boolean
) to authenticated;

-- Trigger helper functions are not standalone Data API endpoints.
-- Existing triggers can continue using them without caller EXECUTE grants.
revoke all on function public.bump_token_state_at()
  from public, anon, authenticated;
revoke all on function public.bump_token_state_from_combatant()
  from public, anon, authenticated;
revoke all on function public.bump_token_state_from_counter()
  from public, anon, authenticated;
revoke all on function public.sync_combatant_hidden_from_token()
  from public, anon, authenticated;
