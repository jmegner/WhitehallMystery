# Whitehall Mystery Web App Implementation Plan

## Scope

Build a complete local hot-seat implementation of the base game. One person plays Jack and one person controls the yellow, blue, and red Investigators. The app enforces setup, movement, clue, arrest, round, and victory rules while hiding Jack's private information during Investigator phases.

The initial release implements the base rules. Optional variants such as Murderer at Large, Newspaper Fabrications, Roll Up Your Sleeves, Smoker, and expansion rules are deferred.

## Map data

- Use `public/map_pptx_simplified.jpg` as the board.
- Copy `circles.jsonl`, `squares.jsonl`, `connections.jsonl`, `alley_groups.jsonl`, and `water_groups.jsonl` from `image_tools/wm_helper` into `src/data/whitehall`.
- Parse and validate all IDs, coordinates, colors, starting crossings, connections, alley groups, and water groups.
- Derive Jack adjacency from numbered circles that share a crossing.
- Derive Investigator adjacency from directly connected crossings and crossings joined through a numbered circle.
- Preserve disconnected water areas; they are reachable through Boat movement where the water-group data permits it.

## Rules engine

- Model the game as a pure reducer/state machine with explicitly validated actions.
- Keep Jack's Discovery Locations and trail private.
- Maintain a separate public evidence record for the Investigator view and possibility calculation.
- Enforce one white Discovery Location per board quadrant.
- Enforce three distinct Investigator starting crossings.
- Run every Investigator phase in yellow, blue, red priority order.
- Implement normal, Coach, Alley, and Boat movement, including move-track costs and Discovery Location restrictions.
- Implement searches, positive and negative clue results, arrests, round resets, trapped-Jack losses, the fifteen-move limit, and both victory conditions.

## Hot-seat flow

1. Jack privately chooses four Discovery Locations.
2. A handoff screen hides the selections.
3. The Investigator player deploys all three figures.
4. A handoff screen returns control to Jack.
5. Jack chooses the starting Discovery Location and makes a move.
6. A handoff screen hides Jack's trail.
7. All Investigators move in priority order, then all Investigators search or arrest in priority order.
8. Resolve a reached Discovery Location or pass back to Jack for the next turn.

## Interface

- Render the 1200 by 1200 board and overlays in a responsive SVG.
- Draw Investigator positions as compact colored circles centered on crossings.
- Draw clues as translucent yellow overlays and Discovery Locations as translucent red overlays.
- Highlight legal and selected destinations without obscuring printed numbers.
- Provide map zoom controls and list-based target buttons alongside map clicking.
- Recreate the public 0-15 move track, including the current position and publicly declared special moves.
- Provide a public log and an Inspector toggle showing all locations Jack could occupy using only public evidence.
- Use neutral full-screen handoff gates and remove private Jack UI from the rendered Investigator view.

## Inspector inference

- Reconstruct possibilities only from the revealed round start, public move types, Investigator positions at each Jack move, clue answers, failed arrests, and revealed round endings.
- Account for Coach intermediate locations and the fact that clues apply to the entire current-round trail.
- Use history-aware dynamic programming rather than a simple current-location flood fill.

## Verification

- Test data integrity and both derived movement graphs.
- Test setup, every movement type, crossing blocks, priority order, clue history, arrests, round transitions, and all win/loss conditions.
- Test that Inspector inference receives no hidden state.
- Exercise the complete hot-seat flow in Playwright at desktop and mobile sizes.
- Run `npm run lint`, `npm run build`, and `npm run test` after implementation milestones.
