# Dice roller

How the 3D dice roller is wired (dice-box + dice-parser-interface + Next 16 + shared log).

3D dice = `@3d-dice/dice-box@1.1.4` in `src/components/dice/DiceTray.tsx`, rendered by
`RoomView`. Design (confirmed twice with the user, incl. after discussing a shared-3D-
animation option): the 3D animation is **local to the roller only**; only the numeric
result is shared (via toast + log). dice-box has **no seed/deterministic-physics API** —
face values come from real physics sim (`window.crypto.getRandomValues()` only backs the
non-3D fallback path), so a truly-synced cross-client animation isn't feasible without
forking the library.

- `new DiceBox({ container: "#mv-dice-overlay", id, assetPath: "/assets/dice-box/",
  scale: 4, ... })` — v1.1.4 takes ONE config object (README's two-arg form is stale).
  `container` is a CSS selector; it appendChild's a bare `<canvas>` into that node with
  **no sizing CSS of its own** — without `#mv-dice-overlay canvas { position:absolute;
  inset:0; width/height:100% }` in `globals.css` it defaults to the browser's 300x150
  replaced-element box sitting in a corner. `scale` was tuned down from 7 to 4 (7 was
  "too big" per the user).
- Loaded via dynamic `import("@3d-dice/dice-box")` inside a useEffect on first tray-open
  (never a static import — it touches `window`). `import type DiceBox` + `src/types/dice-box.d.ts`
  for types (no published types).
- Assets vendored at `public/assets/dice-box/` (ammo.wasm + default theme, ~600KB, committed).
  `npm i` also dumps a copy to `public/assets/` — delete that, keep only the `dice-box/` subdir.
- `next.config.ts` has `transpilePackages: ["@3d-dice/dice-box"]` so webpack/Turbopack
  handles its relative dynamic `import("./world.offscreen.js")` (Babylon world + inline-
  blob worker). `@3d-dice/dice-parser-interface` (below) needed no such entry — it's
  plain ESM re-exports with no dynamic imports or DOM/window touch, safe to static-import.
- **Recurring bug class — `useToast()` returns a new object every render.** Any
  `useEffect` that lists `toast` in its deps re-fires on *every* re-render of the
  component, not just when something meaningful changed. Hit this twice in `DiceTray.tsx`:
  (1) the dice-engine loader effect re-firing before `box.init()` resolved spawned
  duplicate `DiceBox` instances → duplicate asset fetches ("spam fetch"); (2) the
  `dice:<roomId>` realtime-log effect tearing down/recreating the channel on every
  re-render → a roll INSERT landing in the async resubscribe gap was silently dropped
  (Postgres realtime doesn't replay missed events) → other players intermittently missed
  the "someone rolled" toast. Fix both times: drop `toast` from the deps array (its
  underlying `push` is stable via `useCallback` in `ToastProvider`, so behavior is
  unaffected) with an `eslint-disable-next-line react-hooks/exhaustive-deps`. **Check any
  new effect that closes over `toast` for this before shipping it.**
- Roll button is `disabled` while the engine isn't ready (`!boxReady`) instead of letting
  a click fire a "still loading" toast.
- **Advantage/disadvantage** via `@3d-dice/dice-parser-interface` (official companion to
  dice-box, wraps `@3d-dice/dice-roller-parser`; no published types, wrote
  `src/types/dice-parser-interface.d.ts`). Flow: `DP.parseNotation("2d20kh1")` →
  `{qty,sides,mods}[]` groups (this is also exactly the object-array shape dice-box's own
  `roll()` accepts, per its source comments) → `box.roll(dieGroups)` for the REAL physics
  roll → group the flat physics results back up **by `sides`** (safe because this app's
  own notation builder never emits two groups with the same `sides` in one roll — avoids
  needing to track dice-box's per-roll `groupId`, which is a persistent counter across the
  box's whole lifetime, not reset per call) → feed those real values into
  `DP.parseFinalResults(...)`, which replays the parser's internal RNG with the actual
  rolled floats so kh1/kl1 (or any future roll20 modifier) is computed from what's shown
  on screen, never an invented number. Verified this whole contract empirically via a
  temporary Next.js API route (plain Node can't load the package — no `"type":"module"`
  — only a bundler can) before wiring it into the UI.
  `@3d-dice/dice-ui`'s "Advanced Roller" addon (mentioned in a Discord VTT context) uses
  this exact same architecture — confirmed it does **not** force predetermined dice-box
  values either.
- Auto-hide: `box.hide("dice-box-canvas--hide")` (a CSS class toggle, needs the matching
  `.dice-box-canvas--hide { opacity: 0 }` + a `transition` rule in `globals.css` — dice-
  box's own `hide()` with no args just does `canvas.style.display="none"`, no fade) ~4s
  after a roll settles, and immediately (no class, instant) when the tray is closed. Every
  new roll calls `box.show()` first and clears any pending hide timer — `hide()`/`show()`
  don't reset automatically.
- `box.roll(dieGroups)` result items carry `sides`, `value`, `groupId`, etc.
- Shared log = `dice_rolls` table (migration 0004, append-only, RLS select/insert for room
  members). DiceTray loads last 25 + subscribes to INSERTs on `dice:<roomId>` channel.
  Also triggers `notify_discord` server-side — see [Discord webhooks](discord-webhooks.md).

Overlay div is `position: fixed inset-0 pointer-events-none z-[60]`; button/panel z-[62].
