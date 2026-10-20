# Twist & Dread

The DM opens **Twist & Dread** in the room sidebar, chooses the quota Q and the
players taking part in this session, then starts the session. N is the number
of selected players, excluding the DM and spectators. Guest accounts can participate
once the DM makes them players in **Members**.

| Resource | Initial value | Maximum |
| --- | --- | --- |
| Each selected player's Twist | Q | Q |
| DM Dread | N | Q × N |
| Shared Twist Pool | 0 | Q × N |

For Q=5 and N=4: each player has 5/5 Twist, Dread starts at 4/20, and the pool
starts at 0/20. These values follow the user's clarified rules, which supersede
the PDF's initial pool description. Q is a whole number from 1 to 100.

The selected roster and capacity are fixed for the session. A player joining,
leaving, or switching scenes does not recalculate or reset them. A new session
resets the balances after the DM confirms. Resolve pending rerolls first; the
DM can close an abandoned one by keeping its original result. Historical
sessions/events remain stored, though the panel shows the active session.
Making a player a spectator keeps their existing balance as inactive; neither
they nor the DM can spend or distribute their Twist until they become a player
again. This does not recalculate the current session's capacity. A newly promoted
player needs to be included in the next session setup to receive resources.

## Using resources

- **Twist:** the player spends one Twist; DM Dread increases by one, capped at
  capacity. The player may choose either the original or rerolled result.
- **Dread:** the DM spends one Dread; the pool increases by one, capped at
  capacity. For a player's public roll, the DM chooses **Dread ↓** (lower) or
  **Dread ↑** (higher) before rerolling; the server selects the appropriate full
  roll total. For DM/NPC rolls, the DM chooses either result after rerolling.
- **Give from pool:** the DM chooses a selected player and an amount. The pool
  must contain enough points, and the player's resulting Twist cannot exceed Q.
- Resource generation at capacity is capped, rather than preventing the spend.
  Distributions exceeding a cap or balance are rejected rather than silently reduced.

## Public rerolls

Open the dice tray and use the resource buttons beneath an eligible result.
Only public rolls from the current session can be rerolled this way. Players
can use Twist only on their own rolls. The DM can use Dread on selected session
players' rolls or on DM/NPC rolls. Rolls by the DM are treated as DM/NPC rolls;
there is no character-sheet or automatic creature identity lookup.

A resource is spent when the reroll starts. Then roll the same notation in the
existing 3D tray. Server-side validation checks the dice and computes the total,
including normal modifiers and keep-highest/keep-lowest dice notation. Selecting
a new result links the original to its replacement and updates any completed
DM action request referencing the original. Original rows remain in the shared
log; replaced results are marked. Both outcomes and the choice are retained in
Twist/Dread history. Keeping the original still spends the resource.

Pending rerolls survive closing the tray, reloading the page, and reconnecting:
**Resume** continues the pending roll or saved choice. Once new dice values are
saved, they cannot be overwritten with another attempt. If saving landed dice
fails, the open page retains the same values for **Retry saving roll**. As with
ordinary rolls, randomness originates in the existing client-side dice engine.

For private or external/Discord dice, use the panel's **External / private roll**
section to record the resource spend manually. No private dice result is written
to the shared log. The DM can record an external Twist spend on a player's behalf.

## Access and notifications

Room members can read resource balances, public reroll results, and activity.
Cast-token access is not granted to these tables. Only checked authenticated RPCs
can write them; ordinary clients have SELECT access only. Transactions lock the
session so concurrent actions cannot overspend. Operation IDs prevent a retried
setup/spend from resetting or charging resources twice. Cross-room actions,
nonparticipants, kicked users, and stale-session mutations are rejected.

The replacement link on dice rows is server-controlled. A helper in a private
schema validates roll arithmetic and has no client EXECUTE permission. Each
result choice uses the existing optional **dice** Discord notification toggle;
choosing a new roll also fires the ordinary public-dice notification. Manual
resource spends are recorded in the panel's activity log.

Realtime subscriptions refresh the state, with an additional refresh on tab
focus and a 15-second fallback poll. No changes are sent through generic room
counter rows; existing manually created counters remain independent.

## Local verification and rollout

```sh
npm run test:twist-dread
npm run test:action-requests
npm run lint
npm run build
```

The database tests use isolated embedded Postgres and do not read `.env` or
connect to any remote database. They cover quotas/caps, permissions, retries,
rollback, pending rerolls, result selection, action-request updates, and session
reset. The tests do not verify live Realtime, Discord HTTP delivery, or browser
3D rendering.

Apply the earlier `20261020085239_action_requests.sql` migration first, followed
by `20261020111142_twist_dread_sessions.sql`, to the intended development database.
The latter depends on the action-request table and the project's existing
`notify_discord` helper. The single-file script applies exactly the named migration.
On `dev`, `db:push` uses `public.schema_migrations` to skip applied filenames;
this tracker is separate from MCP migration history, so check it before a future
CI rollout. Both new migrations are idempotent. Local testing does not apply SQL
to a remote database or trigger Vercel deployments.

## Supabase rollout — 2026-10-20

Applied to the existing **MalvidraEncounter** project (`ldrpyeghbsbgbmqyvsbr`)
at the user's explicit request:

- `20261020112841_action_requests`
- `20261020112849_twist_dread_sessions`

The remote migration versions were assigned by Supabase; the source files retain
their original local timestamps. All five new tables have RLS, SELECT-only client
grants, and Realtime publication membership. All seven new RPCs deny the unauthenticated
`anon` role and enforce caller/room checks. A live rollback-only probe verified all
seven authorization guards; the private arithmetic helper returned the expected result.
No house session, quota, or gameplay rows were created by rollout or verification.

Security Advisor additionally reports seven [authenticated SECURITY DEFINER
endpoints](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
and five [anonymous-sign-in policies](https://supabase.com/docs/guides/database/database-advisors?queryGroups=lint&lint=0012_auth_allow_anonymous_sign_ins).
These correspond to the intended checked RPCs and room-member guest access; new
RPCs are not executable by the unauthenticated `anon` role. Existing unrelated
advisor findings remain unchanged.

Applying these database migrations did not push Git branches or deploy anything
to Vercel. The frontend is developed on `dev`; `vercel.json` disables automatic
Git deployments for `dev` so its pushes do not create previews. Production
release remains a separate step through `main`.
