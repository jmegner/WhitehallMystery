# Whitehall Mystery strategy-source review

Researched 2026-08-29. This is a source and hypothesis memo for the interactive map report, not a claim that forum advice is optimal play.

## Confidence labels

- **Rule/fact**: supported by the published rulebook or by source code describing its own behavior.
- **Observed claim**: a reviewer or player reports an experience. Useful for generating hypotheses, not for estimating win rates.
- **Heuristic**: an author-created proxy that has not been validated against a corpus of games.
- **Hypothesis**: a claim the graph analysis should test.

## Rules that materially constrain the analysis

The [official Fantasy Flight Games rulebook (PDF)](https://images-cdn.fantasyflightgames.com/filer_public/78/b4/78b4b240-ec1d-416d-8486-970fb5a941c9/whitehall_mystery_rulebook_small_copy.pdf) is the authority for these points:

- Jack secretly chooses four white circles, one in each quadrant. The investigators first deploy all three figures on three distinct yellow-bordered Crossings; only after setup does Jack reveal which of his four locations is the start. Therefore a rules-faithful evaluation of investigator starting sets cannot condition deployment on the revealed starting Discovery Location. It should report expectation and worst case across possible starts, in addition to the retrospective “distance to this revealed start” value.
- Jack has at most 15 move-track spaces in each of three rounds and may visit the remaining Discovery Locations in any order.
- Jack must move. An occupied Crossing blocks an ordinary street move through it; a Coach may pass through an occupied Crossing. The rules contain no ban on revisiting a previously visited circle, so backtracking is legal.
- Investigators each move 0–2 Crossings. All three movement phases happen first, in yellow-blue-red order; only then do all three clue/arrest actions happen in that order.
- A clue search tests adjacent circles one at a time in an investigator-chosen order. It stops on the first circle that appears anywhere in Jack’s current-round trail. A clue does not reveal when Jack visited that circle or whether he is there now. An arrest tests exactly one adjacent circle against Jack’s current position.
- Jack declares a reached Discovery Location only after the investigators complete their movement and clue/arrest phases for that turn. This gives investigators a final action at the destination. A Special Movement may not be used to enter the next Discovery Location.
- Jack has two Coaches, two Alleys, and two Boats for the whole game. Coach records two successive circles and consumes two move-track positions while investigators respond once. The rulebook’s Alley and Boat examples also place their tiles across two coinciding move-track symbols while recording one destination. The report should therefore distinguish **move-track cost** from **investigator-response turns**, rather than use “turns” ambiguously.
- Clues are cleared at the end of every round. Only the current round’s trail answers clue searches.

These rules make several simple graph metrics inadequate on their own. In particular, shortest-path length ignores time compression from Coach, information loss from undated clue markers, occupied-Crossing cuts, and the mandatory final investigator phase at a destination.

## Best source links and what they contribute

### 1. Official rules and publisher material — primary sources

- [Whitehall Mystery rulebook (Fantasy Flight Games, 2017)](https://images-cdn.fantasyflightgames.com/filer_public/78/b4/78b4b240-ec1d-416d-8486-970fb5a941c9/whitehall_mystery_rulebook_small_copy.pdf). Best source for the exact move, block, search, arrest, destination, and special-movement rules. It also gives limited official advice: assign Jack to the more experienced player, conserve Special Movements, watch the 15-move clock, and treat a failed clue search as information.
- [Fantasy Flight Games announcement and overview (June 9, 2017)](https://www.fantasyflightgames.com/en/news/2017/6/9/va102-whitehall-mystery/). Publisher framing rather than independent strategy. It recommends coordination and broad coverage for investigators and describes Special Movements as Jack’s way to navigate around investigators. Treat its balance language as marketing.

### 2. WhitehallMystery.com randomizer — the most important existing quantitative opinion

- [Whitehall Mystery Randomizer](https://whitehallmystery.com/), an unofficial fan tool by “teedyay.” It offers Easy, Medium, Hard, and fully random Discovery sets; the page defines Hard as harder for Jack.
- [The randomizer’s live JavaScript, version 7](https://whitehallmystery.com/main.js?v=7). The code is unusually valuable because it exposes the exact heuristic and thresholds. Its header claims copyright 2018.

The code enumerates `35 × 24 × 23 × 23 = 444,360` legal one-white-circle-per-quadrant sets. For each Discovery Location it stores:

- `circles`: used by a variable named `weightJackEscapeRoutes`;
- `squares`: used by a variable named `weightDetectivesToBlock`;
- a hard-coded all-pairs `costs` matrix, including some fractional values whose derivation is not documented in the source.

For a set `S`, it calculates the minimum and maximum three-leg tour costs over all 24 permutations, then applies:

```text
difficulty(S) =
  [sum over v in S of circles(v)^(-1) * squares(v)^(-0.8)]
  * minTour(S)^(0.75)
  * maxTour(S)^(0.25)
```

The source comments describe the minimum tour as the route Jack will “probably take” and the maximum tour as one Jack “might have to resort to if pressured.” Its selection bands are:

- Easy: score at most `4.212505796`, corresponding to the 35,000 lowest-ranked combinations.
- Medium: `5.560504654` through `7.136783123`, a deliberately separated middle band.
- Hard: at least `8.136795311`, corresponding to ranks 350,000–444,360.
- Sets in the gaps are returned only by fully random mode. Rejection sampling also suppresses overrepresented location 130 in Easy sets and 152 in Hard sets.

This directly answers the user’s suspicion: the site’s opinion is more complicated than “longer paths are harder.” It weights total route length heavily, but also treats low local Jack escape count and low number of Crossings to blockade as making a set harder for Jack.

Important caveats:

- This is a **hand-tuned heuristic**, not a published outcome model. The code contains no play data, calibration method, uncertainty, or validation against win rates.
- The all-pairs cost matrix is undocumented. Fractional entries show that it is not simply a transparent unweighted street shortest-path table.
- The formula has no investigator positions, investigator movement, clues, arrests, occupied Crossings, live route choice, target inference, or remaining Special-Movement inventory.
- A maximum over all 24 tour permutations is not the same thing as an adversarially forced route. It can reward a set for implausibly bad ordering.
- Total-tour aggregation can hide an illegal or nearly impossible leg. The actual constraint is 15 move-track spaces **per round**, not just a three-leg sum.
- Local `circles` and `squares` are static proxies. They do not distinguish useful escape branches from branches that immediately reconverge, run into a cut, or move toward already completed quadrants.
- The exponents (`-1`, `-0.8`, `0.75`, `0.25`) are assumptions. The report should show how rankings change under exact street distance alone, local escape/blockade metrics alone, and pursuit-aware metrics.

Recommended report treatment: reproduce the randomizer score as a named external benchmark, compare it to the report’s exact metrics, and highlight sets whose ranking changes substantially. Do not label its Easy/Hard classes as ground truth.

### 3. BoardGameGeek strategy forum — concentrated discussion index

- [Whitehall Mystery strategy forum](https://boardgamegeek.com/boardgame/190082/whitehall-mystery/forums/67). At research time it listed four dedicated strategy threads: “Choosing Discovery Locations,” “Favourite Map ‘Quirk’,” “Finally won with Jack!,” and “Is the lower right corner balanced for Jack?”

This is the best compact index of game-specific strategy discussion. Direct thread pages were blocked by BoardGameGeek’s bot check during this research pass, so this memo does not attribute unverified claims from their contents. The thread titles themselves suggest useful checks: quadrant imbalance, map quirks, Jack win lines, and Discovery selection. Link the forum index in the report, and avoid implying the threads establish optimal play.

### 4. “I don’t know Jack” Reddit discussion — strongest accessible tactics thread

- [“Whitehall Mystery — I don’t know Jack” (r/boardgames, June 23, 2022)](https://www.reddit.com/r/boardgames/comments/viphnp/whitehall_mystery_i_dont_know_jack/).

Recurring player claims:

- Backtrack, circle, or initially move the wrong way so investigators cannot confidently assign a time and direction to a clue.
- Move into areas where Jack’s location graph is faster or more branching than the Crossing graph; one commenter points to the large block around 181/129 as an Alley opportunity.
- Sometimes move behind or toward recently vacated investigators, because a chasing formation can leave its rear unsearched.
- Switch which unreached Discovery Location is the likely target when investigators commit to one direction.
- Plan the four Discovery Locations, rather than treating them as four independent endpoint distances.

Skeptical reading: these are anecdotes from a small self-selected discussion, including incompatible experiences about which side is favored. “Backtracking is crucial” is plausible because clues have no timestamps, but it spends scarce clock moves and can be bad when investigators retain central coverage. “Follow the investigators” depends on their ability to reverse in 0–2 Crossing moves and should be tested, not taught as universal advice.

One notable rules lesson in the thread is solid: revisiting an earlier circle is not forbidden. Some players had imported a non-revisit restriction from another hidden-movement game and unknowingly handicapped Jack.

### 5. Detailed play-by-post — best worked example of live deduction

- [“Anyone for a Whitehall Mystery?” play-by-post (tekeli.li, Dec. 2020–Jan. 2021)](https://discussion.tekeli.li/t/anyone-for-a-whitehall-mystery/1995), with especially useful reasoning on [page 4](https://discussion.tekeli.li/t/anyone-for-a-whitehall-mystery/1995?page=4) and [page 16](https://discussion.tekeli.li/t/anyone-for-a-whitehall-mystery/1995?page=16).

This is not a strategy guide, but it is a rare public transcript that records investigator reasoning. Examples include:

- deployment for quadrant coverage versus keeping a centrally located responder;
- moving toward a bridge while another investigator remains central;
- using negative searches to eliminate route branches;
- enumerating current-position candidates from a discovered clue and elapsed moves;
- deciding whether three exact arrest attempts are justified;
- explicitly recognizing that a backtrack can invalidate an otherwise complete frontier cover.

Its chief value is as a qualitative test case for the report’s belief-state model. It also demonstrates why a location-only shortest path is incomplete: investigators reason about timestamps, candidate frontiers, search order, and whether Jack reversed.

### 6. First-play rules discussion — useful because common errors change balance

- [“Chinatown and Whitehall Mystery — first play through recommendations” (r/boardgames, Feb. 8, 2022)](https://www.reddit.com/r/boardgames/comments/snhi7y/chinatown_and_whitehall_mystery_first_play/).

Good warnings include: destinations may be visited in any order; prior-round trail locations no longer answer current-round searches; Coach’s intermediate circle remains part of the searchable trail; Special Movements cannot enter a destination; and investigators all move before any of them investigate. The last sequencing error materially favors investigators because it lets later figures react to earlier searches before moving.

Do not copy the thread uncritically. One comment says to announce a drop-off on the turn after arrival, which conflicts with the official rule: Jack declares after the investigators complete phase 3 on the arrival turn.

### 7. Reviews with potentially testable strategic claims

- [RPGnet comped playtest review by Antonios S (Sept. 20, 2018)](https://www.rpg.net/reviews/view-printable.phtml?reviewNumber=17769). Claims Jack may want some locations near the center and others farther away, and that it is usually unwise to make the final two locations adjacent. This is an author opinion with no game log or analysis. Test whether adjacent endpoints are actually bad once the short final round, final action at the destination, investigator carry-over positions, and endpoint local degree are modeled.
- [Big Red Barrel review (Nov. 9, 2017)](https://www.bigredbarrel.com/2017/11/09/review-whitehall-mystery/). Its group found later legs dramatically harder for Jack because every completed destination reveals his exact location and narrows which quadrants remain. This is a single-group observation, not a balance result. It motivates measuring leg order and investigator carry-over state instead of scoring an unordered set only.
- [Lautapeliopas review by Sampsa Ritvanen (Mar. 26, 2021; updated Sept. 20, 2021, Finnish)](https://www.lautapeliopas.fi/peliarvostelut/whitehall-mystery/). Suggests investigators should pressure Jack into spending Special Movements early and notes that each completed quadrant reduces the possible target space. The “force resources early” claim should be tested through marginal value by round; a Boat or Alley’s value may be highly location-specific rather than monotonically greater late.
- [Just Push Start review by Oliver East (Oct. 1, 2017)](https://www.justpushstart.com/blog/2017/10/01/whitehall-mystery-review-hidden-movement-noticeably-awesome/). Emphasizes the speed mismatch between investigator Crossings and Jack circles, stationary blockade value, and Alley as an escape through or around a closing net. Useful intuition, but not quantitative evidence.

## Synthesis: claims worth testing

### Discovery-set difficulty is not one-dimensional

**Hypothesis D1 — Local escape geometry matters independently of route length.** For equal three-leg street tour cost, sets whose endpoints have more legal first street moves, more internally disjoint escape corridors, and more routes that do not immediately reconverge should be easier for Jack.

**Hypothesis D2 — Crossing blockade exposure matters more than raw location degree.** The right endpoint metric is not only the number of adjacent Jack destinations. It should include how many distinct Crossing vertices control those moves and the minimum number of investigators needed to eliminate all legal exits. This tests the randomizer’s `circles`/`squares` proxy exactly.

**Hypothesis D3 — The hardest leg, not total tour length, controls clock losses.** Compare total minimum Hamiltonian-path cost with maximum leg cost, number of feasible visit orders in which every leg is at most 15, and slack on each leg after reserving a final normal move into the destination.

**Hypothesis D4 — Order and carry-over dominate an unordered set score.** Each visit order should be scored separately because investigators end a round where they last searched, while Jack restarts from a public endpoint and clues disappear. A set may be easy in one direction and hard in the reverse.

**Hypothesis D5 — Shared chokepoints make apparently short sets dangerous.** Count how often shortest or near-shortest routes between different Discovery pairs share the same Crossing cuts. Investigators can defend a common separator even when pairwise distances are generous.

**Hypothesis D6 — Central locations have a tradeoff.** They reduce Jack’s travel and preserve target flexibility, but they may be closer to more investigator starting crossings and have higher search/block coverage. Report both effects instead of calling “central” generically good.

### Backtracking and revisits

**Hypothesis B1 — Backtracking’s value is informational, not geometric.** A revisit never shortens Jack’s path to the destination. Its benefit is an increase in investigator belief uncertainty because a clue reveals membership in the current-round trail without a timestamp. Measure the size/entropy of the current-position candidate set after the same search result with and without revisits.

**Hypothesis B2 — The best reversals cross an inference frontier.** Backtracking should be most valuable immediately after investigators advance beyond a cut or abandon coverage behind them, especially where their Crossing graph needs multiple turns to reverse. Test the change in earliest interception time caused by one reversal.

**Hypothesis B3 — Short cycles may outperform an immediate two-edge reversal.** A visible Special-Movement announcement or a clue near the turnaround may make a simple reversal easy to infer. Compare two-step backtracks, longer cycles, and a one-step feint toward a different remaining target under a belief-state search model.

**Hypothesis B4 — Revisit value falls with clock pressure.** Report the maximum extra “deception steps” available while still guaranteeing a legal final normal street move into some remaining destination by move 15.

### Investigator starts, searches, and arrests

**Hypothesis I1 — Best deployment is a robust set-cover problem.** For every 3-of-6 starting Crossing set (20 legal combinations), report mean and worst investigator-response turns until any investigator can act adjacent to every possible starting Discovery circle. Then add early candidate coverage: how many of Jack’s possible positions after 1, 2, and 3 moves can be searched or arrested.

**Hypothesis I2 — Central reserve plus two directional screens beats three equal quadrants.** The play-by-post uses this intuition. Test it against a pure “one investigator per region” deployment using minimax time to a Jack frontier, not just static average distance.

**Hypothesis I3 — Search order has calculable information value.** Because a search stops at its first positive circle, ordering changes which negatives become known. For each Crossing and belief state, choose the order that maximizes expected posterior reduction. A high historical-visit probability is not always the best first query if it is unlikely to be Jack’s current position and would suppress more useful negative tests.

**Hypothesis I4 — Arrest threshold depends on downstream containment.** Compare the immediate current-position probability of an arrest guess with the information lost by not searching and with whether other investigators cover the remaining candidates. The play-by-post’s three simultaneous arrest attempts are an example of a near-complete frontier cover, not evidence for frequent guessing.

### Blockades and pursuit

**Hypothesis P1 — Occupied Crossings should be modeled as vertex deletions.** For each investigator triple, calculate the increase in Jack’s shortest path from every origin quadrant to each destination quadrant after deleting their occupied Crossings. Report both ordinary street paths and paths with up to two Coach bypasses.

**Hypothesis P2 — A blockade is valuable when it hits a small separator, not merely a busy Crossing.** Rank Crossing sets by multicommodity flow lost, number of quadrant-pair paths cut, and forced-detour size. Three investigators on individually central Crossings may be worse than a coordinated cut set.

**Hypothesis P3 — Coach availability changes the best blockade.** A one-Crossing cut can be illusory while Jack retains Coach. A strong anti-Coach blockade either forces multiple occupied Crossings along the two-step route, exhausts Jack’s clock, or positions investigators to act on both recorded Coach circles.

**Hypothesis P4 — “Catch-up” and “outrun” are time-expanded properties.** Static degree is insufficient. For every area, compare Jack’s reachable set after `t` responses with the union of circles the three investigators can search/arrest after moving 0–2 Crossings for `t` turns. Useful outputs are containment time, escape-frontier size, and the ratio of Jack branching to investigator action coverage.

### Alleys, Boats, and Coaches

**Hypothesis S1 — Best Alley is not simply the largest street-distance saving.** Since a Special Movement is announced and consumes scarce clock/resources, rank Alley pairs by street detour saved, occupied-Crossing cuts bypassed, change in investigator candidate entropy, and time for the nearest investigator to regain action adjacency.

**Hypothesis S2 — Boats can cause an investigator “logistics reset.”** Test each Boat endpoint pair for Jack response-time advantage: Jack’s one-response relocation versus the fastest investigator Crossing route to cover the new shore. Recompute with the optional blue investigator Boat ability. Do not assume every dramatic river crossing is strong.

**Hypothesis S3 — Coach creates tempo rather than move-track savings.** It consumes two of Jack’s 15 move slots, so its value comes from crossing an occupied Crossing and giving investigators one response after two Jack locations. Report both clock cost and responses denied.

### Discovery pairs with low investigator leverage

For each ordered pair `(start, destination)`, the requested “good for Jack” score should not be only the Jack shortest path. Suggested layered score:

1. Jack feasibility: number of street-only and special-limited routes within 15 move-track spaces, with a final normal move into the destination.
2. Initial pressure: best investigator deployment is chosen before the start is revealed; compute earliest action adjacency from each legal starting set.
3. Route exposure: minimum and expected number of route circles lying in investigator search footprints under best response.
4. Interception structure: minimum Crossing separator, forced shared chokepoints among near-shortest paths, and detour under an optimal three-Crossing blockade.
5. Information ambiguity: number of trail-consistent current positions after plausible positive/negative searches, including backtracks.
6. Endpoint danger: investigators receive their full phase before Jack declares arrival, so include arrest/search coverage of the destination on the arrival turn.

This will distinguish a long but highly legible corridor from a shorter, branching, hard-to-date route—the central question raised by the randomizer.

## Recommended tone for the final report

- Present exact graph results as exact **under the stated movement model**, not as solved strategy for the full hidden-information game.
- Label reviewer/forum advice as claims or anecdotes and show where the analysis agrees or disagrees.
- Keep “hard for Jack” and “hard for investigators” explicit; several online discussions use “hard” without naming the beneficiary.
- Separate move-track spaces, Jack decision turns, and investigator response turns whenever Special Movements are allowed.
- If reporting win-rate or “best strategy,” require simulation with explicit policies or actual play data. Shortest paths, centrality, cuts, and reachability alone support tactical recommendations, not game-theoretic optimality.

## Compact source ranking

| Priority | Source | Best use | Main caution |
|---|---|---|---|
| 1 | Official rulebook | Rule semantics and modeling constraints | Suggestions are brief, not an analysis |
| 2 | WhitehallMystery.com source code | Exact external difficulty benchmark | Undocumented, unvalidated heuristic |
| 3 | Tekeli.li play-by-post | Real move-by-move belief reasoning | One game, informal play |
| 4 | Reddit “I don’t know Jack” | Backtracking, feints, route-asymmetry hypotheses | Anecdotal and self-selected |
| 5 | BGG strategy forum index | Concentrated follow-up reading | Individual threads were blocked in this pass |
| 6 | First-play Reddit thread | Common balance-changing rules mistakes | Contains at least one claim conflicting with the rulebook |
| 7 | Reviews | Claims about late-game pressure and location choice | Small or undisclosed play samples |
