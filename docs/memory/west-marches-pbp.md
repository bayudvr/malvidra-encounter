# West Marches PBP

The user's actual campaign use case for malvidra-encounter — async West Marches PBP on Discord.

The user (Bayu Devara / DM) runs a **West Marches style D&D campaign as async play-by-post
(PBP) on Discord** — replies can take hours-to-days per post, not live sessions. This is
the actual motivating use case behind malvidra-encounter and several of its features; keep
it in mind when suggesting or scoping new work.

Explicitly stated design intent (confirmed 2026-09-05, don't drift from this without
asking):
- **Malvidra is a tactical tool only** — opened when a party needs the map/initiative/
  dice for exploration or combat. Discord stays the actual hub for RP, chat, and
  scheduling. Don't push toward turning Malvidra into a bigger "return between sessions"
  hub (e.g. activity feeds, chat) unless the user asks — that was explicitly the option
  *not* chosen.
- **One Room per mission/expedition**, not one room for the whole campaign — a room is
  scoped to the specific party running that mission. Explains why webhooks are per-room
  (mission → its own Discord channel/thread) and why room archiving (migration 0007)
  matters: missions finish and pile up over a long campaign.
- Typically 1-3 parties/rooms active in parallel.

Features built specifically to support this async, room-per-mission, Discord-centric
model — see [Project overview](project-overview.md) for the implementation details:
- Per-room Discord webhook (combat/dice/scene events) — see
  [Discord webhooks](discord-webhooks.md). This is the main "presence" mechanism
  replacing what a live session's shared screen would give you for free.
- "Your turn" badge on `/rooms` — lets a DM/player running several parallel missions see
  which room needs them without opening each one.
- Exploration "spotlight" marker — combat already had a turn tracker; exploration/RP
  (where PBP stalls happen just as often) didn't, so the DM can now tag who/what the table
  is waiting on, surfaced the same way a combat turn change is.

Known accepted risk: guest (anonymous-auth) player identity doesn't survive a device
change / cleared cookies — acceptable for now per the user ("kecuali dia bikin akun kan
aman"), i.e. only a real account is safe across devices. Not asked to be fixed.

Ideas discussed but **not yet built** (raised, still open if the user wants to revisit):
- "Call for a roll" — DM requests a specific roll from a specific player, shown as a
  pending prompt in that player's dice tray. Flagged as the most complex of the three
  suggested async-support ideas; the user greenlit the first two (above) but this one
  wasn't explicitly confirmed.
