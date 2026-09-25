---
name: feature-ideas-2026-09
description: "Playtester feedback (2026-09-22): ccfolia research done, chat speech bubbles BUILT, token auras (circle AoE attached to token) BUILT, freeform character sheet still open/undecided"
metadata:
  node_type: memory
  type: project
---

Relayed by the user from other players/GMs who tried the app, 2026-09-22.

## 1. Look at ccfolia as a reference for going system-agnostic

Motivation given: malvidra is still fairly D&D-5e-shaped (token size categories, PC/monster
combatant model — see [[project-overview]]) and the suggestion is to loosen that so other TRPG
systems can use it too.

Researched 2026-09-22 (web search — general/community sources, not ccfolia's own docs, so treat
specifics as reasonably-confident rather than verified):
- **No built-in ruleset or stat block.** A character "piece" (koma) on the board carries a
  freeform set of user-defined status/parameter fields, not a fixed D&D-style sheet. A large
  third-party tool ecosystem exists purely to convert various systems' character-sheet data
  (CoC6th, Emoklore, Monotone Museum, etc.) into ccfolia's piece + "chat palette" JSON format —
  the system-agnosticism is real and is clearly the thing that ecosystem is built around.
  Corroborates the "system agnostic" framing the playtesters used.
- **Chat palette**: each piece has an attached set of quick-send commands (dice rolls, canned
  text) that's entirely author-defined per system/character — not a fixed action list.
- **Chat-centric session flow**: the chat log (IC lines + dice rolls + OOC) is the main spine of
  a session, more so than tactical grid combat — consistent with "gak terlalu dnd fokus, sistem
  agnostik" and with point 2 below (speech bubbles tie directly into this chat-first design).
- Also generally known (not directly confirmed by search this pass): pieces render as flat
  "standee"-style cutouts rather than circular tokens, and boards are freeform (image + freely
  placed pieces) rather than requiring a strict grid — possibly relevant if "dynamic" also means
  loosening [[project-overview]]'s current grid/snap assumptions, but lower confidence than the
  points above.

## 2. Chat speech bubbles on tokens — BUILT 2026-09-22

`chat_messages` table (migration `0024_chat_messages.sql`), room-scoped, mirrors `dice_rolls`.
`token_id` nullable = OOC (no bubble); RLS lets a player only speak as a token they own, DM any
token. **Deliberately wired into the central `useRoomState`/`chatMessages` state, NOT a
self-contained hook like `DiceTray`** — CastView's anonymous client can't use
`postgres_changes` (falls back to polling), so anything that must reach the cast screen has to
go through the same fetch/poll path as tokens/combatants/etc., not its own realtime-only
subscription. Bubble rendering lives in `TokenSprite.tsx` (`speechText` prop) computed in
`SceneCanvas.tsx` (`speechByToken`, 8s TTL via a 1s ticking interval) — since `TokenSprite` is
shared by `RoomView` and `CastView`, the bubble reaches the projector for free. UI:
`ChatBox.tsx`, floating bottom-**left** (dice tray owns bottom-right), speaker dropdown (OOC +
owned/all tokens).

## 3. Shapes/AoE attached to a token, following it when the token moves — BUILT 2026-09-22 (circle only)

Scoped down from the original idea: **circle/aura only** (not cone/line/cube), authorable by
**DM or the token's owner** (not DM-only), visible to everyone. `token_auras` table (migration
`0025_token_auras.sql`), multiple auras per token allowed, RLS mirrors `tokens_owner_move`
(owner-or-DM). The "follows the token" mechanism turned out to be trivial: `SceneCanvas.tsx`
renders each aura's `Circle` at its token's **live** `x`/`y` every frame — no offset/attachment
tracking needed at all, just a `token_id` foreign key. Reuses the same circle math/opacity as
the pre-existing **transient** AoE measuring tool (`AoeShape` in `SceneCanvas.tsx` — cone/line/
cube/circle, drag-only, never persisted; don't confuse the two). DM manages auras from a new
section inside `TokenInspector`; a player manages their own token's aura from a new minimal
`TokenAuraPanel` — first time a non-DM click on a token does anything at all (`onSelect` was
previously `!isDM` gated with no owner exception).

Related, same session: `TokenInspector`/`TokenAuraPanel` are now **drag-to-reposition** by their
header (`usePanelDrag` hook, Pointer Events + `setPointerCapture`, resets to the default corner
per newly-selected token) — playtester feedback that the panel sometimes covers what you just
clicked. Also bumped the AoE measuring tool's distance-label contrast (thicker border, bigger
font, solid black bg) per feedback that it read as "thin"/low-contrast — note the label already
had *a* background before this tweak, so if it still reads as low-contrast the cause may be
stale dev server / browser cache rather than the component itself.

## 4. Character sheet — system-agnostic, easy to use — OPEN, not yet decided

Raised 2026-09-22 right after the above shipped. Direction discussed but not committed: a
**freeform key/value field list per token** (DM/player adds their own named fields — HP, Sanity,
whatever the system calls for) rather than the current fixed `hp`/`ac`/`vision_radius_ft`
columns, mirroring what the ccfolia research above found (point 1: no built-in stat block, a
piece just carries user-defined fields). Trade-off flagged but not resolved: freeform fields
lose the purpose-built UI the fixed fields currently get for free (HP bar, AC read in combat
stat line on `TokenSprite`) unless that's rebuilt per-field-type. Needs an actual design
discussion (data shape, whether/how it coexists with or replaces `hp`/`ac`, whether the
HP-bar-on-token visual survives) before any schema work — flagged, not started.
