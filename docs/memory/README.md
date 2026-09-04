# Project notes — malvidra-encounter

Mirror of Claude's auto-memory for this project, committed here for visibility in the repo.
The live/authoritative copy is maintained by Claude's memory system outside this repo; these
files are a point-in-time snapshot and may drift — ask Claude to refresh them if stale.

- [Project overview](project-overview.md) — initiative tracker + VTT map; DM/room/scene/token model; stack & key decisions
- [Next.js 16 gotchas](nextjs16-gotchas.md) — Turbopack default, proxy.ts, react-hooks lint errors
- [Supabase realtime DELETE gotcha](supabase-realtime-delete-gotcha.md) — filtered subscriptions need REPLICA IDENTITY FULL to see deletes
- [Dice roller](dice-roller.md) — @3d-dice/dice-box + dice-parser-interface, adv/disadv, useToast()-in-deps bug class
- [Discord webhooks](discord-webhooks.md) — per-room webhook security model (pg_net, DM-only table) and event triggers
- [West Marches PBP](west-marches-pbp.md) — the user's actual campaign use case; why webhook/spotlight/your-turn exist
