# Encounter embedded build: experimental

The existing production website remains the canonical app. The Activity build is opt-in, using the same code, public Supabase project URL and publishable/anon key. Never add a service-role key or transfer an admin session from the hub.

## Build and route

Build a separate project from main only with NEXT_PUBLIC_ENCOUNTER_BASE_PATH=/encounter. Keep the normal website build unset. The Discord URL mapping must preserve /encounter in the destination (verify with a test GET before enabling). Add /encounter-supabase -> ldrpyeghbsbgbmqyvsbr.supabase.co for browser Auth, REST and Realtime connections, including WebSocket upgrades. The server continues to use the canonical Supabase URL.

Cookies use a separate storage key, /encounter path, Secure, SameSite=None, Partitioned. A scoped path is NOT a security boundary against scripts on the same Activity origin. Audit all game adapters and third-party scripts before exposing a privileged DM session; if isolation cannot be assured, use a dedicated Encounter Activity origin instead. Do not enable the embedded launcher publicly until this is verified.

## Asset mappings

The following known image hosts were observed in aggregate in existing rooms, assets and tokens. Configure explicit mappings; do not add a general arbitrary-host proxy. The prefix is /encounter-media- plus the hostname with dots replaced by hyphens. Start with i.imgur.com, 5e.tools and raw.githubusercontent.com; the remaining listed hosts can be added for coverage.

| Prefix | Target |
| --- | --- |
| /encounter-media-i-imgur-com | i.imgur.com |
| /encounter-media-5e-tools | 5e.tools |
| /encounter-media-raw-githubusercontent-com | raw.githubusercontent.com |
| /encounter-media-i-pinimg-com | i.pinimg.com |
| /encounter-media-encrypted-tbn0-gstatic-com | encrypted-tbn0.gstatic.com |
| /encounter-media-www-dndbeyond-com | www.dndbeyond.com |
| /encounter-media-dndplaybook-lon1-cdn-digitaloceanspaces-com | dndplaybook.lon1.cdn.digitaloceanspaces.com |
| /encounter-media-cdn-phototourl-com | cdn.phototourl.com |
| /encounter-media-media-discordapp-net | media.discordapp.net |
| /encounter-media-upload-wikimedia-org | upload.wikimedia.org |
| /encounter-media-images-ext-1-discordapp-net | images-ext-1.discordapp.net |
| /encounter-media-i-redd-it | i.redd.it |
| /encounter-media-github-com | github.com |

Original stored URLs are never modified. Redirects or other hosts may still require a mapping; do not open unknown hosts automatically.

## Acceptance criteria before enabling

- Existing web login and OAuth still work; compare original user UUID, rooms, scenes and assets.
- In test Activity, existing password login creates the same Supabase user session; test cookie refresh and logout, and no cookie on unrelated game/media requests.
- Validate nested iframe navigation and routes, then two clients in DM and guest/spectator roles: token movement, initiative, scene switching, dice assets, image display and RLS isolation.
- Validate invite and cast links point to the ordinary web app. Test unsupported browser APIs and CSP failures.
- SSO from Discord SDK is not implemented. OAuth access tokens are not Supabase ID tokens. Investigate a normal PKCE authorization handoff with a one-time challenge and proof of the linked identity; never authorize based on display name or email alone. The standalone OAuth login remains supported.

No migrations or database writes are needed for this build. No production embedded deployment or Discord mapping is enabled by this PR.
