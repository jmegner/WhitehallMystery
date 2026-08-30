# Routes Through Whitehall

This folder contains an interactive, reproducible map and strategy report for
*Whitehall Mystery*. It is a second Vite entry point in the existing project.

## View the report

From the repository root:

```powershell
npm run dev
```

Then open `/reports/initial_report/` on the URL printed by Vite. The production
build includes the same page at `dist/reports/initial_report/index.html`.

## Rebuild the analysis

The analysis program is intentionally retained outside the generated report:

```powershell
python reports/scripts/analyze_whitehall.py
```

It uses Python 3.11+ and the standard library. The full run enumerates all
444,360 legal four-Discovery sets and writes
`reports/initial_report/analysis/analysis.json`. It also compares the exact map
graph with the published `whitehallmystery.com/main.js?v=7` heuristic, so that
part of regeneration requires internet access.

Use `--skip-discovery-sets` for a quicker graph-metric refresh. If the output
already contains exhaustive tour results, the script preserves them; a
first-time diagnostic run produces a smaller JSON file without that section.

## Important definitions

- A **Jack action-turn** is one Jack action followed by an investigator phase.
- A **move-track slot** is one recorded circle. Coach therefore costs one
  action-turn but two slots; Street, Alley, and Boat cost one of each.
- Ordinary shortest paths use the unoccupied static board. Only the blockade
  section removes occupied crossings.
- Special-movement Discovery tours enforce a normal Street arrival at the next
  Discovery. They remain planning lower bounds when a pairwise leg would touch
  another, not-yet-targeted Discovery early.
- Pursuit, catch-up, backtracking, and directed-pair rankings are structural
  proxies. They are not solved hidden-information play or win probabilities.

## Headline exact results

- Street radius is 7; centers are 86–89, 105–108, and 130. Only 130 is white.
- Street diameter is 12 across 20 pairs. Up to two Alleys lowers the radius to
  6; up to two Boats does not lower it.
- The shortest Street-only legal Discovery tour is 8 turns for
  `{71, 77, 123, 130}`; the longest minimum is 24 turns for four tied sets,
  including `{8, 27, 152, 171}`.
- With up to two Coaches, the best tour falls to 6 Jack turns / 8 track slots.
  With up to two of every special, it is 6 turns / 7 slots.
- The strongest robust investigator deployment is `{FP, JD, JH}`: every white
  starting circle can be reached to action-adjacency within 4 investigator
  movement turns.

The page exposes the complete tables, route maps, assumptions, source links,
and skeptical comparison with existing strategy discussions.
