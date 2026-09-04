# Project overview

What malvidra-encounter is and its core architecture decisions.

Malvidra Encounter = web app: initiative tracker + VTT battle map for tabletop RPG.
Scaffolded 2026-09-03 (greenfield, first build). See [West Marches PBP](west-marches-pbp.md)
for what the user actually runs on it and why several features (Discord webhook,
spotlight, "your turn" badge) exist.

Flow: DM signs up (email+password) → creates a **room** → shares `/join/<code>`.
**Players join as guests** via Supabase **anonymous auth** (`signInAnonymously`, name only,
no account) — `src/app/join/[code]/GuestJoin.tsx`. Only the DM needs a real account.
Anon users get `user.is_anonymous === true`; `/rooms` redirects them straight to their room.
Requires "Anonymous sign-ins" enabled in Supabase Auth settings.
**Known gap (accepted, not yet fixed):** guest identity is tied to browser/local-storage
session — a player who switches device or clears cookies loses it and must rejoin,
losing their token ownership link (DM must manually re-assign). Fine unless a real
account is used.
Room has many **scenes** (one scene = one encounter). Scene has a **map** (image URL, NOT
uploaded) + grid + draggable tokens, and a **mode**: `exploration` | `combat`. Combat mode
shows the initiative tracker. All state syncs live via Supabase Realtime.

Stack: Next.js 16 (App Router, **Turbopack default** for `next dev`, `proxy.ts` not
`middleware.ts`), TypeScript, Tailwind v4, react-konva (canvas map, loaded via
`next/dynamic` ssr:false), Supabase (Postgres + Auth + Realtime + `pg_net`), no shadcn
(hand-rolled `src/components/ui.tsx`).

Key decisions:
- Map image = pasted URL only, no Supabase Storage.
- **Players CAN drag a token assigned to them** (`tokens.owner_user_id === auth.uid()`,
  RLS `tokens_owner_move`, migration 0002). DM drags everything. Owned token = blue ring.
- **Combatants are seeded from the tokens on the scene**, not the player roster —
  `seed_scene_combatants(p_scene)` RPC (migration 0002, renamed from `seed_player_combatants`).
  One combatant per token; token with an owner ⇒ PC (`is_player`). No monster/character library.
- Combat view = `InitiativeBar.tsx` (Foundry-style floating strip over the map; DM clicks a
  combatant to give the turn — action-based init — plus Next turn / Next round). The right
  panel `InitiativeTracker.tsx` is the DM-only value editor (AC/HP/temp HP/init/conditions).
- Combat extras: token shows HP bar + HP/AC (hidden from players for non-PC tokens);
  `combatants.conditions` text[] renders as stacked coloured arc rings on the token +
  chips in the panel (presets in `src/lib/conditions.ts`); non-PC at 0 HP → greyed + skull.
  All combat-only; exploration renders tokens plain.
- Movement ruler while dragging a token + floating "📏 Measure" free-distance tool
  (players too). `scenes.feet_per_square` (migration 0003, default 5). Chebyshev metric.
- Canvas: pan (drag), wheel-zoom, pinch-zoom + on-screen −/+ buttons (mobile).
- **Snap-to-grid snaps a token's footprint (size-aware) to sit centered inside its
  cell(s)**, not its center point to a grid-line intersection (fix in `SceneCanvas.tsx
  moveToken()` — the old behavior made grid lines cut through the middle of the token).
  Grid line color/opacity/thickness are per-scene and DM-configurable
  (`grid_color`/`grid_opacity`/`grid_thickness`, migration 0005).
- **Token size follows D&D 5e categories** (Tiny=0.5, Small=1, Medium=1, Large=2, Huge=3,
  Gargantuan=4 grid squares) via a dropdown in `TokenInspector`; `tokens.size` is
  `numeric` (migration 0009) to allow Tiny's fractional value. Small/Medium sharing a
  footprint value is correct per the actual rules, not a bug.
- **Token images are optional.** With no `image_url` a token/library entry renders as a
  deterministic-hue circle (`colorFromString`) with up to 4 uppercase initials
  (`tokenInitials` in `src/lib/utils.ts`) — one letter per word for multi-word names, or
  the first 4 letters of a single-word name. `assets.image_url` is nullable (migration
  0008), matching `tokens.image_url` which already was.
- **Room / Scene / Token-library names are all renamable** (Room: click-to-edit in the
  header, DM-only, `EditableRoomName` in `RoomView.tsx`; Scene: field in
  `SceneSettings.tsx`; Token library: inline input in `AssetPanel.tsx`'s `AssetRow`).
  Per-scene token instances already had this via `TokenInspector`'s Label field — that's
  how you distinguish multiple dropped copies of the same library token in combat.
- **Rooms can be archived** (nullable `rooms.archived_at`, migration 0007) instead of
  deleted — hides a finished mission from the default `/rooms` list (collapsed "Archived"
  section still shows it); doesn't affect access, DM-only toggle per room.
- **"Your turn" badge on `/rooms`**: server-side check per room — is the active scene in
  combat and does its `active_combatant_id` belong to the viewing user — shown as an
  amber badge/highlight on that room's row (`src/app/rooms/page.tsx` + `RoomRow.tsx`).
- **Scene "spotlight" marker** for exploration/RP (outside combat, which has no turn
  tracker): DM tags a player and/or a free-text note (`scenes.spotlight_user_id`/
  `spotlight_note`, migration 0010) — shown as a banner in `RoomView.tsx`'s header for
  everyone, and pushed through the Discord webhook (`scene` category) like a turn change.
- RoomView is responsive: side panels + initiative editor become drawers below `lg`.
- Kicked players are bounced to `/rooms` live (realtime on `room_members`; needs
  REPLICA IDENTITY FULL — see [Supabase realtime DELETE gotcha](supabase-realtime-delete-gotcha.md)).
- Client talks to Supabase directly (browser client); RLS is the security boundary.
  State + realtime live in `src/lib/room/useRoomState.ts` (returns `RoomStore`).
- 3D dice roller: floating 🎲 button bottom-right. See [Dice roller](dice-roller.md).
- **Optional per-room Discord webhook** (combat/dice/scene events). See
  [Discord webhooks](discord-webhooks.md) — security-sensitive, read before touching
  `room_webhooks` or `notify_discord`.

DB: migrations `supabase/migrations/00{01..10}_*.sql`, applied via `npm run db:push`
(`scripts/db-push.mjs`, `pg` direct — Supabase CLI mis-escapes `!` in the pooler password).
**Gotcha:** the script reads `process.env.DATABASE_URL` with plain Node, no dotenv — a
fresh shell needs `set -a; source .env; set +a` before `npm run db:push`, even though
`.env` already has the var and Next.js itself auto-loads it fine.
Hand-written types in `src/lib/database.types.ts` (keep in sync with migrations by hand).
Supabase project ref: `ldrpyeghbsbgbmqyvsbr` (ap-northeast-1). Needs "Anonymous sign-ins"
ON and "Confirm email" OFF in Auth settings. `pg_net` extension enabled (migration 0006).

Deployed on Vercel (`main` auto-deploys). Build uses `next build --webpack`; dev uses
Turbopack with an explicit empty `turbopack: {}` in `next.config.ts` so it doesn't flag
the webpack() block as an accidental leftover — see [Next.js 16 gotchas](nextjs16-gotchas.md).
`NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` set as Vercel env vars.
The `bayudvr-patch-1` PR #1 (a guest-only rewrite) was closed — model on `main` stands.

## Status as of 2026-09-05

Everything through commit `9dc12e9` is implemented, typechecked/linted clean, migrations
0001-0010 pushed, and committed to `main` in per-feature commits (dice fixes, rename +
grid, Discord webhooks, room archive, optional token images, D&D sizes, your-turn badge,
spotlight marker). Dev server boots clean. No open bugs or pending items at last check-in.

Discord webhook end-to-end tested by the user and confirmed working ("Send test" button).
