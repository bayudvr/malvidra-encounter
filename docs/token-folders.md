# Token library folders

DMs can organize their room's library into folders such as Party, NPCs, and
Monsters. Folders have one level and belong to a single room.

- Use **+ Folder** to create an empty folder, then choose it in the folder filter.
- Use **Rename** or **Delete folder** for the selected folder.
- Choose a folder on any token row to move it, or **Unfiled** to remove it from a folder.
- New tokens start in the selected folder; the creation form can choose another.
- **All tokens** shows the whole library. Search filters token names within the current selection.
- Deleting a folder moves its tokens to **Unfiled**. Library tokens and tokens on
  scenes retain their images, ownership, positions, and combat state.

Folders and membership are stored in Postgres and survive a page refresh.
Other tabs receive an empty broadcast and re-fetch through RLS; folder names
are not included in broadcast payloads. Only the room DM can read or manage
folder records. A composite foreign key prevents assigning a token to a folder
from another room.

## Database update

Apply `supabase/migrations/20261027071825_token_asset_folders.sql` using the
existing migration workflow before enabling folders in a deployed build.
The migration adds `asset_folders` and a nullable `assets.folder_id`; existing
tokens begin in Unfiled. It does not change the scene-token data model.

If the database update has not run, the library keeps its existing operations
available and disables folder management with a status message.

Local development currently uses a hosted Supabase project without a separate
development branch. The migration is tested in an isolated PGlite database;
applying it to a shared hosted database is a separate release step.

## Validation

Run `npm run test:asset-folders` for real Postgres constraints and RLS checks
without loading live credentials. Coverage includes room boundaries, non-DM
access, duplicate names, moving tokens, migration replay, and preservation of
library and placed tokens when a folder is deleted.
