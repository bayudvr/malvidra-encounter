# Casting the projector view

Two ways the DM gets the player-safe view onto a big screen. Both live behind
DM-only `CastControls` in the `RoomView` header (`src/components/room/CastControls.tsx`).

## 1. "📺 Cast" — second window (original)

`window.open("/rooms/<id>/cast")`. `CastView` runs `useRoomState(..., "player")`
against the DM's own authed session; viewport mirrors the DM via the ephemeral
broadcast channel `cast:<roomId>` (see [[project-overview]] / SceneCanvas).
DM drags that window onto a projector. No infra, works offline-of-Chromecast.

## 2. "📡 Cast to TV" — Presentation API → Chromecast / smart display

`new PresentationRequest("/cast/<token>").start()` launches the **public**
`/cast/<token>` route directly on the receiver device. The receiver is an
anonymous browser with **no Supabase session**, so:

- `rooms.cast_token` (migration `0014_room_cast_token.sql`) — random 32-hex,
  unique, per room. `rotate_cast_token(p_room)` RPC (DM-only) revokes it.
- `/cast/<token>` (`src/app/cast/[token]/`) is allow-listed in
  `src/lib/supabase/middleware.ts` `PUBLIC_PATHS`.
- `createCastClient(token)` (`src/lib/supabase/client.ts`) — anon client that
  sends the token as the `x-cast-token` **header**. `isSingleton: false` is
  mandatory: `@supabase/ssr` `createBrowserClient` otherwise returns (or
  overwrites) the shared cached singleton, leaking the header onto the authed
  client.
- RLS: `cast_room_id()` resolves `request.headers ->> 'x-cast-token'` to one
  room id; every room-scoped **SELECT** policy gained `or room_id =
  cast_room_id()`. Read-only — DM-only write policies unchanged. Grants only
  the same rows a guest player sees; `CastView` still forces the player
  perspective on top (fog opaque, hidden tokens gone, stats hidden).
- **`request.headers` is not populated for Realtime**, only PostgREST. So the
  cast-token screen can't use `postgres_changes` — `useRoomState` takes
  `{ client, realtime: false }` and **polls every 2.5s** instead. Viewport
  mirroring still works (broadcast channel, not RLS-gated). Fine for a projector.

### Gotchas / limits

- Presentation API needs a **secure context** — works on `localhost` and the
  Vercel https deploy, not plain-http LAN IPs.
- Chrome/Edge desktop only; no Firefox/Safari. `CastControls` hides the button
  when `window.PresentationRequest` is absent.
- The receiver only re-renders on the 2.5s poll; viewport still follows the DM
  live via the `cast:<roomId>` broadcast (needs the DM's room page open, same
  as mode 1).
