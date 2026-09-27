Web implementation of Whitehall Mystery with emphasis on figuring out possibilities for you.

See [MULTIPLAYER.md](MULTIPLAYER.md) for local and Cloudflare online-multiplayer setup.

## Versus AI

Choose **New game → Versus AI**, then play Jack or control all three investigators.
Games and roles are saved locally, including turns interrupted by a refresh. The
opponent runs in a Web Worker; leaving the board cancels pending computation and
resuming restarts it. Undo and Undo Side can rewind either side, including during
AI computation and after game over. The AI pauses when reviewing its earlier
actions, including after refresh. Redo restores recorded actions; Resume AI turn
or a new human action continues from that point and replaces the undone future.

Jack rates legal street and special routes for safety, mobility, discovery progress,
recent revisits and the 15-move deadline. Backtracking is permitted and special
tokens carry a conservation cost. His start is selected by scoring the first move
from each discovery after investigator deployment.

Jack also looks one investigator movement turn ahead. It considers coordinated
legal positions that close streets or threaten exits, then penalizes destinations
that can leave him trapped or without a safe next move. The forecast respects
alternate street paths, remaining special tokens, Coach costs and discovery round
resets. It retains every reachable blocking crossing and six pressure candidates
plus staying put per piece; it is a short defensive forecast, not a full-game search.

Both AIs randomize tied decisions. Jack may choose routes within half a scoring
point of the best; investigators preserve the best next-turn metric, then the
best pursuit score, randomizing only equal plans. Search ties still prioritize the smallest
positive outcome, then the smallest negative next-turn frontier. Each AI turn is
seeded from the saved game ID and public state, so refreshing a pending turn
doesn't reroll it and the investigator's randomness never uses Jack's secrets.

The investigator uses public evidence only. It checks coordinated arrest coverage
of up to three possible locations before considering joint movement plans. A
bounded greedy search retains six candidate crossings per piece and scores the
team's expected **weighted next street-move destinations**, accounting for occupied
crossings, searches stopping on a clue and overlapping coverage. Each unique
destination receives `0.20 + 0.80 * 2^(-(distance + detour) / 2)`: distance is the
shortest Street route to a white location in an unrevealed quadrant, and detour is
the least extra Street distance from the public round start via this location to
any eligible discovery. Earlier positive clues rule out visited discovery
candidates. These weights use public information and unrestricted Street distances;
the forecast itself respects investigator blockages.

Locations that cannot reach any eligible discovery by move 15 contribute zero,
including to hypothetical search probabilities and pursuit. The deadline bound
allows the remaining Alley/Boat tiles, requires a final Street arrival, and counts
Coach as two slots. It ignores future blocks and unknown secret discoveries, so
only positions that lose even under optimistic conditions are discarded from
planning. Forecasts normally use Street moves, but retain special escapes when
every Street reply loses. Arrival on move 15 and discoveries awaiting reveal at
the end of the investigator turn remain viable; projected discovery arrivals
reset the forecast budget. Exact deduction and displayed clue counts are unchanged.

Branch weights use counts of deadline-viable possible locations, not a learned
probability model; hypothetical joint branches
are a conservative approximation. Actual searches re-run exact deduction after
every answer, preferring smaller positive branches. Pieces without useful nearby
actions pursue the projected street frontier one and two turns ahead. Pursuit
scores combine the team's nearest response with each investigator's own travel
delay, so one nearby investigator cannot hide the benefit of moving distant
teammates toward future searches. Forecasts keep all teammates' street blockages.

Discovery difficulty matches [Tim Jeanes's Whitehall Mystery Randomizer](https://whitehallmystery.com/):
the Easy threshold is 4.212505796. Its location/connectivity data and fractional
trip costs are stored in `src/data/whitehall/aiDiscovery.json`; the sampler also
uses its reduced selection frequency for location 130. Refresh that factual data
with `node scripts/update-ai-discovery-data.mjs`. Gameplay requires no connection
to the randomizer. Its difficulty distances intentionally remain separate from
this project's corrected game board.

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
