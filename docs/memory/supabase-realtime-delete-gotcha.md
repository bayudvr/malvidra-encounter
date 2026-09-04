# Supabase realtime DELETE gotcha

Filtered Supabase realtime subscriptions never see DELETE events unless the table is
REPLICA IDENTITY FULL.

Supabase `postgres_changes` subscriptions in this app are filtered by `room_id=eq.<id>`.
With the default (primary-key) replica identity, a DELETE's `old` record contains only
the PK — so the `room_id` filter never matches and **the DELETE event is silently dropped**.

Symptoms seen: DM "remove combatant" did nothing in the UI (row was deleted in DB);
kicked players stayed stuck in the room until refresh.

Fix (migration `0002_combat_tokens_realtime.sql`): `alter table <t> replica identity full;`
on `room_members`, `combatants`, `tokens`. Then the filter matches and the existing
`payload.old.id` handlers in [project-overview](project-overview.md)'s `useRoomState` work.

Belt-and-suspenders: also call `room.reloadScene()` right after a client-initiated delete
instead of waiting for the realtime round-trip.
