# Encounter embedded build: experimental

The existing production website remains the canonical app. The Activity build is opt-in, using the same code, public Supabase project URL and publishable/anon key. Never add a service-role key or transfer an admin session from the hub.

## Build and route

Build a separate project from main only with NEXT_PUBLIC_ENCOUNTER_BASE_PATH=/encounter. Keep the normal website build unset. The Discord URL mapping must preserve /encounter in the destination (verify with a test GET before enabling). Do not expose arbitrary upstream HTML under the Activity origin. Add /encounter-supabase -> ldrpyeghbsbgbmqyvsbr.supabase.co for browser Auth, REST and Realtime connections, including WebSocket upgrades. The server continues to use the canonical Supabase URL.

Cookies use a separate storage key, /encounter path, Secure, SameSite=None, Partitioned. A scoped path is NOT a security boundary against scripts on the same Activity origin. Audit all game adapters and third-party scripts before exposing a privileged DM session; if isolation cannot be assured, use a dedicated Encounter Activity origin instead. Do not enable the embedded launcher publicly until this is verified.

## Asset security

Do not map third-party websites directly into the Activity origin. Existing assets are loaded through /encounter/api/activity-image, with exact HTTPS hostname allowlist, no redirect following, authenticated access, raster MIME allowlist, 10 MiB bound and sandbox/nosniff headers. Reference JSON uses /encounter/api/activity-reference with a fixed upstream directory, safe path segments, 12 MiB bound and JSON reserialization. No cookies, authorization headers or client-provided upstream headers are forwarded. Original stored URLs are not changed. Unsupported formats, redirects and non-allowlisted hosts can fail; test existing maps before enabling.

## Acceptance criteria before enabling

- Existing web login and OAuth still work; compare original user UUID, rooms, scenes and assets.
- In test Activity, existing password login creates the same Supabase user session; test cookie refresh and logout, and no cookie on unrelated game/media requests.
- Validate nested iframe navigation and routes, then two clients in DM and guest/spectator roles: token movement, initiative, scene switching, dice assets, image display and RLS isolation.
- Validate invite and cast links point to the ordinary web app. Test unsupported browser APIs and CSP failures.
- SSO from Discord SDK is not implemented. OAuth access tokens are not Supabase ID tokens. Investigate a normal PKCE authorization handoff with a one-time challenge and proof of the linked identity; never authorize based on display name or email alone. The standalone OAuth login remains supported.

No migrations or database writes are needed for this build. No production embedded deployment or Discord mapping is enabled by this PR.
