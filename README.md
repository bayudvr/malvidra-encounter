# Malvidra Encounter

Initiative tracker + battle map for tabletop RPG encounters.

- **DM** signs up (email + password), creates a **room**, shares an invite link.
- **Players** open the invite link and join as a **guest** — just a name, no account
  (Supabase anonymous auth). Only the DM needs a real account.
- A room holds many **scenes** (one scene = one encounter).
- Each scene has a **map** (image URL) with draggable **tokens** and a grid.
- A scene runs in **exploration** or **combat** mode. Combat opens the **initiative tracker**.
- Everything syncs in real time to every participant via Supabase Realtime.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · react-konva · Supabase (Postgres + Auth + Realtime).

## Setup

### 1. Create a Supabase project

At <https://supabase.com/dashboard>, create a project. Then:

- **SQL Editor** → paste and run [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
  (If the project already has a conflicting `public` schema, run
  [`supabase/setup_fresh.sql`](supabase/setup_fresh.sql) instead — it wipes `public` first.)
  Alternatively, from a checkout:
  `DATABASE_URL='<pooler connection string>' npm run db:push`
- **Authentication → Sign In / Providers**:
  - **Email** → turn **"Confirm email"** off (otherwise every sign-up sends a verification
    email — the built-in mailer is capped at ~2–3/hour and you'll hit
    `email rate limit exceeded`).
  - **Anonymous sign-ins** → turn **on** (required for guest players to join without an account).
- **Project Settings → API**: copy the Project URL and the `anon` public key.

### 2. Configure env

```bash
cp .env.example .env.local
```

Fill in:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### 3. Run

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

## Trying it end-to-end

1. Open the app in two browsers (or one normal + one incognito). Sign up a **DM** account
   in browser A.
2. Browser A → **Create a room**. Open it, copy the invite link from the *Party* panel.
3. Browser B → open the invite link → enter a name → **Join as guest** (no account). You land
   in the room as a player and appear in browser A's party list instantly.
4. Browser A → **Add scene** with a map image URL, then **Go live**. Browser B sees the map.
5. Browser A → **Token library**: add a token (name + image URL), click **+ Scene**, then
   click the token on the map to assign it to the player. Drag it — browser B sees it move;
   the player's own token shows a blue ring.
6. Browser A → **Start combat**. Player combatants are seeded automatically. Set initiative
   values, click **Sort**, then **Next ▸** to advance turns; wrapping past the last combatant
   bumps the round. Browser B sees the active turn and round update live.
7. **End combat** hides the tracker but keeps tokens and map. Switching the live scene moves
   every participant.

## Data model

See [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql). Row Level Security
is enabled on every table: room members can read their room's data, only the room's DM can
write. Players self-join through the `join_room(code)` RPC.

### Regenerating DB types

```bash
npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts
```

The checked-in `src/lib/database.types.ts` is hand-written to match the migration.

## Known limitations / next steps

- Tokens are moved by the DM only. `tokens.owner_user_id` is already stored — to let players
  drag their own token, add the commented-out RLS policy in the migration and set
  `draggable` per-owner in `SceneCanvas`.
- Auth is email + password. Magic links / OAuth can be added via Supabase.
- No fog of war, dice roller, monster stat blocks, or chat yet.

## Deploy

Deploys to Vercel as-is. Set the three `NEXT_PUBLIC_*` env vars in the Vercel project and
point `NEXT_PUBLIC_SITE_URL` at the deployed URL.
