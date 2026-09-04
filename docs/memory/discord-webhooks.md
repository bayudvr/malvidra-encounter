# Discord webhooks

Per-room Discord webhook architecture — security model and event triggers (pg_net).

Optional per-room Discord notifications (migration 0006, plus the `spotlight` trigger
added in migration 0010). **Read this before touching `room_webhooks`, `notify_discord`,
or any `trg_notify_*` function.**

Security model (non-negotiable, don't regress it):
- The Discord webhook URL is a bearer secret — anyone with it can post to / manage that
  channel. It lives in its own table `room_webhooks`, **DM-only RLS** (select AND write,
  `is_room_dm(room_id)`), and is deliberately **not** added to the `supabase_realtime`
  publication. It must never reach a player's browser — don't put it on `rooms` or
  `scenes` (both of which players can already `select("*")`).
- Delivery happens **entirely inside Postgres**, via the `pg_net` extension
  (`net.http_post`, async/non-blocking) fired from `AFTER` triggers — never from the
  client. The client never even has the URL to POST with.
- `public.notify_discord(p_room_id, p_category, p_message)` is the single delivery
  helper: looks up the room's webhook + the matching `notify_combat`/`notify_dice`/
  `notify_scene` toggle, and wraps the whole thing in `exception when others` so a bad/
  removed webhook URL can **never** break the game action that triggered it (dice roll,
  turn change, etc. always succeeds regardless of Discord).
- `public.send_test_discord_webhook(p_room)` is a DM-only RPC (checks `is_room_dm` itself,
  raises if not DM or no URL set) the "Send test" button in `RoomWebhookPanel.tsx` calls —
  bypasses the category toggles since it's an explicit manual test.

Event triggers (all `AFTER UPDATE`/`AFTER INSERT`, all call `notify_discord`):
- `dice_rolls` insert → category `dice`.
- `rooms.active_scene_id` change → category `scene` ("Scene changed to X").
- `scenes.map_url` change, **only when that scene is the room's active one** (looked up
  live, not cached) → category `scene`.
- `scenes.mode` change (combat start/end) → category `combat`.
- `scenes.active_combatant_id` change (turn) → category `combat`.
- `combatants.hp` drops to ≤0 for a non-PC (`is_player = false`), edge-triggered (`old.hp`
  was null or >0) → category `combat` ("has fallen").
- `scenes.spotlight_user_id` / `spotlight_note` change (and not being cleared to both-
  null) → category `scene` ("Waiting on X: note") — added migration 0010, see
  [Project overview](project-overview.md)'s spotlight bullet.

Deliberately **not** implemented: token movement notifications — considered and rejected
as too spammy for live drag, though the user noted async PBP movement (once per post, not
per-pixel-drag) could be reconsidered later if wanted.

Message format is plain `content` (Discord webhook JSON: `{content, username}`), not
embeds — simpler to build correctly in raw SQL `format()`/string concatenation.
