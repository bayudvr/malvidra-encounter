# Cross-scene token state continuity (0031)

Purpose: dropping a library token in a different scene should start from its
**latest actual state**, not stale starting HP/AC in the token library.

## Behavior

- DM toggles **Continue state between scenes** per library asset.
  The 0031 migration enables it for existing player-owned assets; generic
  monster assets default to OFF so repeated monster spawns stay fresh.
  Assigning a player owner to an unowned asset enables continuity automatically.
- Both + Scene and canvas drag/drop call `spawn_asset_token`. It is an
  authenticated, DM-authorized, transactional RPC. Only rows from the same
  room and asset id are considered. A freshly dropped token remains **hidden**.
- On drop with continuity on, choose the most recently **state-changed**
  token in **another scene** for that library asset; if there is none, start
  from library defaults. For combatants, carry current HP, max HP, temp HP,
  AC, and conditions. Also copy per-token custom counters, size, color,
  and vision radius. Library asset remains the authority on token name/image
  and owner. Position, fog, initiative, active turn and scene-local auras
  remain new-scene-specific.
- The clone is a *snapshot when placed*, not two live-synced tokens.
  Later edits to the older token are tracked with `state_changed_at`, so
  the most recently edited source wins next time a new scene token is placed.
- A carried combatant is created hidden until the DM reveals its token.
  `combatants_select` RLS filters out hidden combatants for players AND cast.
  Revealing the token automatically reveals its combatant.
- Alt-drag to duplicate on the **same** map remains the existing in-scene
  duplicate behavior, independent of this feature. Token per-instance
  counters and room-wide public/private counters remain separate.

## Apply and verify

Migration 0030 (room counters) and then 0031 must be applied before deploying
code that calls the new RPC. Do NOT run against production as part of a
feature-branch-only implementation.

1. In a test DB, enter combat with a player-owned token: change HP to
   7/20, temp HP to 3, add Poisoned, and set a token counter to 2/5.
2. Switch to another scene, drop the same library asset using + Scene;
   it must retain all those values in the DM combatant view / token counters.
3. Test drag-drop too. A second copy on the **same scene** should NOT
   inherit from its existing counterpart in that same scene.
4. Check a non-DM guest cannot SELECT a carried combatant while its token
   is hidden. Reveal the token; guest should see the combatant.
5. Update stats in a previous scene and place in a third scene: most recently
   edited state should win, not most recently created scene.
6. Disable continuity on an NPC library asset: every new scene spawn starts
   fresh. Switching continuity back on resumes last known state.
7. Verify fresh start, scene-switch reload, token deletion and casting on
   two browsers; verify RLS as player and as cast-token receiver.
