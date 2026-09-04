# Project overview

What malvidra-encounter is and its core architecture decisions.

Malvidra Encounter = web app: initiative tracker + VTT battle map for tabletop RPG.
Scaffolded 2026-09-03 (greenfield, first build).

Flow: DM signs up (email+password) → creates a **room** → shares `/join/<code>`.
**Players join as guests** via Supabase **anonymous auth** (`signInAnonymously`, name only,
no account) — `src/app/join/[code]/GuestJoin.tsx`. Only the DM needs a real account.
Anon users get `user.is_anonymous === true`; `/rooms` redirects them straight to their room.
Requires "Anonymous sign-ins" enabled in Supabase Auth settings.
Room has many **scenes** (one scene = one encounter). Scene has a **map** (image URL, NOT
uploaded) + grid + draggable tokens, and a **mode**: `exploration` | `combat`. Combat mode
shows the initiative tracker. All state syncs live via Supabase Realtime.

Stack: Next.js 16 (App Router, **Turbopack default**, `proxy.ts` not `middleware.ts`),
TypeScript, Tailwind v4, react-konva (canvas map, loaded via `next/dynamic` ssr:false),
Supabase (Postgres + Auth + Realtime), no shadcn (hand-rolled `src/components/ui.tsx`).

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
- RoomView is responsive: side panels + initiative editor become drawers below `lg`.
- Kicked players are bounced to `/rooms` live (realtime on `room_members`; needs
  REPLICA IDENTITY FULL — see [supabase-realtime-delete-gotcha](supabase-realtime-delete-gotcha.md)).
- Client talks to Supabase directly (browser client); RLS is the security boundary.
  State + realtime live in `src/lib/room/useRoomState.ts` (returns `RoomStore`).
- 3D dice roller: floating 🎲 button bottom-right, `src/components/dice/DiceTray.tsx`.
  3D animation is local-only per roller; numeric result is shared to the table via a
  `dice_rolls` log table + realtime INSERT toasts. See [dice-roller](dice-roller.md).

DB: migrations `supabase/migrations/000{1,2,3,4}_*.sql`, applied via `npm run db:push`
(`scripts/db-push.mjs`, `pg` direct — Supabase CLI mis-escapes `!` in the pooler password).
User keeps `DATABASE_URL` in a gitignored `.env` now, so `npm run db:push` works bare.
Hand-written types in `src/lib/database.types.ts` (keep in sync with migrations by hand).
Supabase project ref: `ldrpyeghbsbgbmqyvsbr` (ap-northeast-1). Needs "Anonymous sign-ins"
ON and "Confirm email" OFF in Auth settings.

Deployed on Vercel (`main` auto-deploys). Build uses `next build --webpack` — see
[nextjs16-gotchas](nextjs16-gotchas.md). `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` set as Vercel env vars.
The `bayudvr-patch-1` PR #1 (a guest-only rewrite) was closed — model on `main` stands.

## Status as of 2026-09-05 (commit 3a4f04f)

All requested features are implemented, built green, and pushed to `main`: responsive
mobile drawers (player + DM, incl. during combat), player-owned token drag, live
combatant removal, live player-kick, token-driven combat seeding, on-token HP/AC display
(player-visibility gated for non-PC), Foundry-style `InitiativeBar` with click-to-set-turn
+ Next round, movement ruler + free-distance measure tool (disappears on release, no
persist), mobile pinch-zoom + zoom buttons, stackable condition rings, greyed-out downed
NPCs (combat-only), and the 3D dice roller.

**Only open item:** migration `0004_dice_rolls.sql` — check whether the user has actually
run `npm run db:push` for it (they were told to but it wasn't confirmed). If dice rolls
error out or don't share, that's the first thing to check.

No other bug reports or feature requests were pending at last check-in.
