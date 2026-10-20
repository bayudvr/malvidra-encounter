# DM action and roll requests

Open **📣 Requests** beside the dice button in a room. This is separate from the
existing **🙋 Request DM** button, which sends attention requests in the opposite direction.

- The DM selects a player and sends instructions, choosing either an action or a d20 roll.
- d20 requests support checks/saves, an optional DC (visible to the player), and a player-chosen
  modifier plus normal/advantage/disadvantage. Requested rolls are public.
- Addressed players see a pending banner and can open their requests after returning to the room.
  An action has **Mark done**; a roll opens the existing 3D dice tray.
- The DM sees pending requests, recent results, and **Cancel request**. Requests are room-wide
  and survive scene changes. They do not replace exploration spotlight or advance combat turns.
- Everyone's existing freeform dice roller continues working as before.

## Persistence and permissions

`action_requests` stores pending requests and the most recent 30 resolved requests are loaded
alongside all pending ones. Only the DM and the addressed current room member can read a
request. The cast screen and other players cannot read it. Public dice results remain visible
in the existing shared dice log.

The browser cannot insert, update, or delete request rows directly. Three authenticated RPCs
create, complete, and cancel requests; each checks the caller and room membership. Completion
locks the row and writes the dice log and request result in one transaction. Repeating a
completion returns the original result. Completing a cancelled request fails. Dice values,
mode, and modifier are validated; total and notation are computed by Postgres. Random dice
values still originate in the existing client-side 3D engine, as regular rolls do.

Landed rolls that fail to save are retained in component state: **Retry saving roll** submits
the same values. This local retry buffer lasts while the room page remains open. If a server
commit succeeded before a connection failure, reopening the room loads the persisted result.

Changes use Postgres Realtime, with a refresh on tab focus and every 30 seconds to recover
missed events. Initial subscription also refreshes to close the load/subscribe gap.

## Discord

Uses the existing optional per-room webhook; no client receives webhook credentials.
Request creation and action completion use **scene notifications**. Roll results use the
existing **dice notifications** and shared dice log. Both respect the DM's existing toggles.
Notifications require the existing `notify_discord` function and dice-roll trigger.

## Migration and rollout

Apply **only** `supabase/migrations/20261020085239_action_requests.sql` to the intended
**development database** before testing the feature against Supabase. The application expects
this table/RPCs; without the migration, the Requests panel displays a load error.

The existing `scripts/apply-migration.mjs` accepts the filename and uses `DATABASE_URL`.
On `dev`, `db:push` applies only files missing from `public.schema_migrations`; verify that
tracker before using it against an existing database, since some historical migrations are
destructive if replayed. MCP migration history is separate from this filename tracker.
The action-request migration was applied to the main Supabase project on 2026-10-20;
see the rollout record in [Twist & Dread](twist-dread.md#supabase-rollout--2026-10-20).
Local tests never apply SQL to a remote database or trigger Vercel deployments.

## Verification

```sh
npm run test:action-requests
npx tsc --noEmit
npm run lint
npm run build
```

The database suite uses a fresh embedded Postgres with minimal profiles/rooms/auth helpers and
a notification stub. It verifies the actual migration, RLS/grants, recipient membership,
normal/advantage/disadvantage math, invalid inputs, cancellation, retry deduplication, and
transaction rollback. It never reads `.env` or connects to a remote database. It does not
verify Supabase Realtime delivery, Discord HTTP delivery, or the 3D/browser interaction.
