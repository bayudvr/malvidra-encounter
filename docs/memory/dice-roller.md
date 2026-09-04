# Dice roller

How the 3D dice roller is wired (dice-box + Next 16 webpack + shared log).

3D dice = `@3d-dice/dice-box@1.1.4` in `src/components/dice/DiceTray.tsx`, rendered by
`RoomView`. Design (per user): the 3D animation is **local to the roller only**; only the
numeric result is shared.

- `new DiceBox({ container: "#mv-dice-overlay", id, assetPath: "/assets/dice-box/", ... })`
  — v1.1.4 takes ONE config object (README's two-arg form is stale). `container` is a
  CSS selector; it appendChild's a canvas into that node.
- Loaded via dynamic `import("@3d-dice/dice-box")` inside a useEffect on first tray-open
  (never a static import — it touches `window`). `import type DiceBox` + `src/types/dice-box.d.ts`
  for types (no published types).
- Assets vendored at `public/assets/dice-box/` (ammo.wasm + default theme, ~600KB, committed).
  `npm i` also dumps a copy to `public/assets/` — delete that, keep only the `dice-box/` subdir.
- `next.config.ts` has `transpilePackages: ["@3d-dice/dice-box"]` so webpack handles its
  relative dynamic `import("./world.offscreen.js")` (Babylon world + inline-blob worker).
- `box.roll(["2d6","1d20"])` returns a Promise of `[{sides,value}, ...]`; sum + modifier.
- Shared log = `dice_rolls` table (migration 0004, append-only, RLS select/insert for room
  members). DiceTray loads last 25 + subscribes to INSERTs on `dice:<roomId>` channel.

Overlay div is `position: fixed inset-0 pointer-events-none z-[60]`; button/panel z-[62].
