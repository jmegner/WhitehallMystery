# AI deployment and pursuit review

## Implemented in this change

Investigator deployment evaluates all 34,997 discovery sets classified as Easy by the existing original-randomizer dataset. Sets containing 130 receive the same reduced sampling weight as Jack AI's Easy selector. For each deployment and secret set, the model lets Jack choose both his starting discovery and his strongest legal first move. It averages those best responses over the Easy distribution and minimizes that score across all 20 legal three-crossing layouts.

The opening estimate uses Jack's safety, mobility, progress, discovery-arrival and special-token costs. It includes Street, Alley, Boat and Coach rules, including the ban on traversing unrevealed discoveries with special moves. It omits Jack's expensive trap lookahead; this is an opening heuristic, not a solved-game strategy. Investigator decisions never use the opponent's actual secret discoveries. The selected layout is now FP/JD/JH; colors vary among equivalent assignments. Partial deployments remain fixed.

The investigator hunt improvements below are now implemented too. Jack's move strategy is unchanged.

### Threat and route probabilities

The static threat formula is now `0.02 + 0.98 × 2^(-distance/2 - detour)`, with the existing optimistic deadline check still excluding doomed positions from planning. Exact deduction and displayed clue counts retain those positions. For the example round starting at 72, location 73 has threat 0.51, versus approximately 0.193 for 54.

A separate public-evidence model estimates likely routes. Its candidate next-goal quadrants use eligible white locations, with a 90% Easy-informed discovery prior and 10% uniform reserve. It does not track every full secret discovery set during pursuit. Observed Street, Alley, Boat and Coach moves are replayed with preferences for progress, safety, mobility and deadline pressure. Ten percent of each move's probability is shared across legal alternatives, retaining retreats and deception.

The model conditions on the entire visited trail for clues, including Coach intermediate locations; arrest misses exclude only the current location. It keeps every viable endpoint/goal state in forward inference. Deterministic backward trail samples approximate correlations between hypothetical searches, while preserving endpoint/goal probability masses under the heuristic policy. These probabilities are planning estimates, not calibrated odds or deductions.

### Coordinated decisions

The main team score combines threat-weighted uncertainty about Jack's **next** position with interception distance along likely routes over two future turns. Street moves are the ordinary forecast; finite special escapes are retained when all Street continuations lose. The nearest investigator contributes most to coverage, with smaller rewards for backup, so all three are not rewarded equally for covering the same exit.

Movement shortlists six destinations per investigator, then scores legal combinations jointly. Exhaustive guaranteed-arrest matching runs first, before pruning. Search branches use trail probabilities, stop on a positive clue, and re-evaluate subsequent searches after negative answers. Searches with a one-location positive outcome retain priority; other full-AI searches use expected future uncertainty and threat. InvAuto retains its existing smallest-positive-first ordering.

Repeated searches have no arbitrary ban. Their modeled information value must compete with the opportunity to intercept elsewhere. Exact public evidence is recalculated after each real answer, and guaranteed arrests always rely on conservative exact possibilities rather than sampled certainty. Neither deployment nor pursuit reads Jack's actual secret discoveries, location or trail.

### Pursuit comparison

After the deployment change, the same four seeds were replayed with the new hunt strategy:

| Seed | Previous hunt strategy | New hunt strategy | Discoveries revealed, including start: before → after |
| --- | --- | --- | --- |
| review-1 | Arrest at 5, R3 M7 | Arrest at 77, R1 M15 | 3 → 1 |
| review-2 | Jack escaped, R3 M3 | Arrest at 113, R2 M4 | 4 → 2 |
| review-3 | Arrest at 169, R3 M3 | Jack timed out, R1 M15 | 3 → 1 |
| review-4 | Arrest at 175, R3 M15 | Jack trapped, R2 M4 | 3 → 2 |

That is four investigator wins versus three previously, but this is a four-seed regression sample against one fixed Jack policy, not evidence of a reliable win rate against humans.

The isolated review-2 Coach regression also improves: with exactly the old public evidence at R1 M5, the model assigns about 71% probability to NE endpoints. The team chooses **CJ/DD/CG**, advancing all three pieces east from CH/DL/DG. The old choice was BW/DM/DG, leaving Red repeating rear-area searches. This behavior is covered by a regression test.

Repeated-negative search counts increased overall (53 to 104). Games followed different routes, and the new investigators kept Jack in earlier rounds longer; a repeated search count alone is therefore not a quality metric. In the new review-2 game, for example, investigators covered exits while Jack retreated through NW, then captured him after his eventual NE reveal. The implementation intentionally permits such containment and backtracking responses.

### Verification

Lint and production build pass. All 251 unit tests pass with `--maxWorkers=2`; the default concurrent run still hits the pre-existing five-second By Mail replay timeout. All 82 Playwright tests pass on fresh QA origins, including real AI workers, known-clue arrests, distant-piece approach, undo/redo, refresh recovery and privacy. New unit regressions cover public-only deterministic beliefs, Coach intermediate clues, later returns after negative searches, positive-clue conditioning, endpoint support, deadlines, special rescues and eastward interception.

In the final local simulation run, investigator hunt turns took a median 1.21 seconds and a maximum 2.92 seconds, excluding deployment. Shared route and response calculations preserved every action in all four comparison games while reducing computation time. These are local Node measurements, not browser timing guarantees.

## Earlier deployment-only observations

I ran four deterministic seeds with the previous deployment and the same four with the new deployment. All games used the actual AI turn functions and rules engine. Private positions were recorded afterward for analysis, not supplied to investigator decisions. The sample is diagnostic, too small to establish a win-rate improvement.

| Seed | Discovery set | Previous deployment result | New deployment result |
| --- | --- | --- | --- |
| review-1 | 9, 77, 129, 161 | Investigators: timeout, R2 M15; 28 Jack moves | Investigators: arrest at 5, R3 M7; 14 Jack moves |
| review-2 | 35, 78, 139, 142 | Jack escaped; 13 Jack moves | Jack escaped; 11 Jack moves |
| review-3 | 34, 77, 148, 161 | Investigators: arrest at 188, R3 M3; 20 Jack moves | Investigators: arrest at 169, R3 M3; 20 Jack moves |
| review-4 | 15, 77, 175, 183 | Investigators: arrest at 175, R3 M15; 25 Jack moves | Same result; 25 Jack moves |

“Jack moves” counts actions: a Coach is one action but consumes two move-track slots.

The clearest pursuit failure was **review-2**, which reproduced the general concern about clearing old territory while Jack advances elsewhere:

- Previous deployment, Round 1: Jack started at 35, then traveled 37 → 21 → 22, used Coaches to reach 46 and then 76, and reached discovery 78 on move-track slot 8.
- Blue reached DG and searched 33/15/34 on slot 3, stayed there and repeated those searches on slots 5 and 7. Repeating a negative search is legal after Jack moves, but here it spent three turns covering the same rear area.
- At slot 7, the public candidates already included 40 NE positions versus 36 NW positions. Their summed current strategic weights were approximately 35.14 NE versus 17.49 NW. Nevertheless, the team ended at BH/DG/CG, and Jack reached 78 on the next turn.
- With the new deployment, the same underlying problem remained: on slot 5 Jack was at 43, while Red stayed at DG and repeated 34/15/33. Jack reached 78 on slot 6. Thus deployment alone does not fix pursuit.

In review-1 with the previous deployment, Jack lost by timeout after a long retreat around the west and south. That is also a useful caution: pursuing a retreat sometimes succeeds by exhausting Jack's deadline. A new threat model should preserve blocking and guaranteed-capture opportunities instead of ignoring all backward moves.

Reproduce current playthroughs with:

```powershell
node scripts/analyze-ai-playthroughs.mjs node_modules/.cache/ai-review/playthroughs.json review-1 review-2 review-3 review-4
```

The JSON includes each turn's public candidate locations and weights, investigator placements, actions, logs, repeated-negative searches, computation time, and Jack's actual route for retrospective comparison.

## Diagnosis of the previous hunt strategy

1. Every viable location has a weight floor of **0.2**. Even an extreme detour can be worth one-fifth of an imminent discovery. Large collections of remote possibilities therefore accumulate substantial value.
2. These are desirability weights, not beliefs about Jack's behavior. Every candidate source location expands into all of its possible Street destinations, regardless of how unlikely Jack is to choose that route.
3. Simulated search branches use raw endpoint membership counts, not probabilities of the surviving histories. Current endpoints can occur in both yes and no branches, so these counts are only an approximation.
4. The main movement score concerns this turn's actions and next-turn possible locations. The one/two-turn approach score only breaks ties. Any small immediate information advantage can therefore outweigh much better positioning toward the next discovery.
5. The approach score rewards the nearest investigator plus a quarter of all three investigators' distances. This encourages movement by distant pieces, but can also pull all three toward the same trail instead of preserving an interceptor ahead of Jack.

## Original recommendations and implementation status

Recommendations 1–3 and the investigator portion of 4 are implemented above. The separate Jack deadline-planning suggestion remains outside this investigator-only change.

### 1. Sharpen progress weighting and give uncertainty a small total reserve

As a first measurable experiment, replace the current per-location floor with a much smaller floor, such as **0.02**, and penalize detours more strongly:

`threat(x) = 0.02 + 0.98 × 2^(-distanceToRemainingDiscovery(x)/2 - detour(x))`

Keep the existing optimistic deadline check: a position that cannot reach any eligible discovery in time, even using publicly available specials, receives zero strategic weight. An unrevealed discovery under Jack remains viable until the reveal opportunity. Do not remove low-weight locations from exact inference or displayed clue counts.

When adding a probability model, use a small *total* exploration allowance (for example 5–10% shared across legal alternatives), rather than granting a large independent floor to every remote location.

### 2. Forecast likely routes using public evidence

Maintain a separate probabilistic planning belief over plausible histories and remaining discovery sets. Weight Jack's legal continuations for progress, safety, mobility and deadline pressure, with an exploration allowance for retreats and deception. Condition those histories on clue/arrest results; a clue concerns the trail, not just the current location. Use observed move types when replaying history and Street moves for the normal future forecast.

Rank information by reduction in **threat-weighted next-turn uncertainty**, such as weighted entropy, rather than raw possibility count. Use the history probabilities for yes/no branch probabilities. Simply averaging posterior probability × threat would be insufficient: information alone preserves that expectation, so an uncertainty or decision-value term is needed to reward useful searches.

### 3. Make interception part of the primary team score

Evaluate the team's ability to cover likely progress routes and eligible discovery approaches over the next two turns, alongside immediate search/arrest value. Normalize and combine these objectives so forward positioning can beat a tiny immediate information gain; do not leave it solely as a tie-breaker.

Score complementary coverage jointly. Usually one investigator should pressure the recent trail while another approaches a likely exit or destination, but these should emerge from the score rather than fixed color roles. Keep exhaustive guaranteed-arrest matching as the first priority. This directly addresses all three pieces being pulled into an already-revealed quadrant.

### 4. Track repeated low-value searches and improve Jack's deadline planning

Instrument repeated searches after negative answers and measure how much they reduce threat-weighted uncertainty. Avoid a blanket ban: Jack may legitimately return. Penalize the opportunity cost when an investigator repeatedly checks a rear corridor while dangerous exits go uncovered.

For Jack, test a deadline-aware escape plan that reserves a feasible route to an unrevealed discovery, including remaining special tokens. The timeout game suggests his safety preference can allow too much retreat. Compare candidate changes with paired seeds, discovery completion, captures, timeouts, and time spent intercepting progress routes—not just overall win rate.
