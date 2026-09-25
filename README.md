Web implementation of Whitehall Mystery with emphasis on figuring out possibilities for you.

See [MULTIPLAYER.md](MULTIPLAYER.md) for local and Cloudflare online-multiplayer setup.

## Updating map connections

After editing connections or marker coordinates in `image_tools/wm_helper`,
propagate those JSONL edits to `src/data/whitehall`, then run
`npm run generate:alley-groups`. This recalculates the enclosed alley boundaries
(excluding the outside and water faces), updates `alley_groups.jsonl` in both
directories, and regenerates the TypeScript map data used by the website and
Worker. `npm run check:map-data` also checks these calculations during builds.
The read-only `node scripts/inspect-map-changes.mjs [git-ref]` comparison reports
connection/group changes against a commit (default `HEAD`), including group
numbers and whether the helper and game copies agree.

Connection/alley changes affect movement legality: deploy the Worker as well as
the website and refresh both players. Old online/By Mail histories containing
now-illegal moves may fail replay validation; they are not silently rewritten.
