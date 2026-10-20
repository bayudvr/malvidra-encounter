# Players and spectators

Authentication and participation are separate: both guest and registered accounts
join through the same invite as **spectators**. Rejoining preserves the existing
role. Existing members stay players when this migration is installed.

The DM uses **Members → Play / Watch** to change a member's role. Only the room
owner remains DM. Changes update connected clients through the membership
subscription and broadcast refresh, without requiring a page reload.

Spectators see the active map with the usual player fog and hidden-token rules,
initiative, shared counters, public chat and public dice history. They can pan
and zoom their own map but cannot move tokens, change HP/conditions, end a turn,
draw, ping, chat, roll, request actions or spend resources. A private trigger
guards persistent gameplay writes, including legacy privileged RPCs, even if a
spectator still owns a token from before their role changed. The existing RLS
continues to restrict what players may edit. Ephemeral Realtime broadcasts retain
the app's existing channel security model; this change does not add a new
authenticated broadcast protocol.

Action requests, spotlight and token-owner pickers list players only. Twist/Dread
setup offers only players, so spectators do not inflate N, initial Dread or the
maximum pools. Session rosters remain fixed snapshots: demotion keeps token state
and balances, disables spending/distribution, and does not change capacity.
The DM can close a demoted player's pending reroll by keeping its original roll.
Promoting a new player does not silently change or reset the active session.

The projector remains forced read-only even when opened by an authenticated DM.
Unlike the projector, a spectator controls their own local viewport.

## Migration and verification

Apply `20261020114534_room_spectators.sql` after the action-request and Twist/Dread
migrations. It is safe to replay and creates no game/session data. It changes
future joins to spectator and adds the DM-only `set_room_member_role` RPC, role
invariants, and private write guards. It preserves existing players and balances.

`npm run test:spectators` uses isolated embedded Postgres with the real existing
RLS and gameplay RPCs. It covers joins, promotion/demotion, read access, blocked
writes, retained ownership, resource quotas, pending rerolls and cascading room
deletion. It never loads `.env` or contacts a live database. Browser interaction
and live Realtime delivery require separate verification.
