# Room counters (house rules)

Introduced in migration `0030_room_counters.sql`. Unlike `token_counters`, these counters
belong to the **room**, survive switching scenes, and are unrelated to a token.

- DM can create, rename, adjust ±1, reset, change max, change visibility, delete.
- A max of 0 means unlimited. The initial value is 0; values cannot go below 0 or above
  a positive max. Reducing a max clamps the current value if necessary.
- New counters default to **private**. **Public** means readable by all members in that
  room (including guests); players cannot edit. **Private** rows are readable and
  writable by the room DM only, enforced by Postgres RLS, not by UI alone.
- The UI is in the shared room sidebar, both exploration and combat.
- Deliberately no `postgres_changes` publication. An empty `room-counters:<roomId>`
  broadcast requests a fresh RLS-filtered fetch; there is also a 15-second fallback poll.
  Never put row data in the broadcast payload.
- No migrations or Vercel deployments should be automatically executed during dev.
  Apply migration 0030 to the target DB only when ready to run the feature.

## Manual validation (after applying migration to a safe DB)

1. DM creates a private counter and a public counter; confirm both appear for DM.
2. Guest player reads room counters: receives **only** the public row, even when
   querying Supabase directly; inserts/updates/deletes as player are denied.
3. DM adjusts public value; other player's UI refreshes (or on 15s fallback).
4. DM switches public to private; player no longer receives it on refetch.
5. Changing scenes doesn't change counters. Deleting a room cascades its counters.
6. Test on desktop and mobile with sidebar drawer.
