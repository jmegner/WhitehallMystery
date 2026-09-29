# Jack AI: Coach reserves and round pacing

## Changes

- Increase base progress weight from 7 to 14; reduce each investigator's arrest-range penalty from 100 to 60. Being in range is a risk, rather than proof that an investigator knows where to arrest.
- Charge Coach's extra move-track slot in the progress score. Its token reserve costs 28 points in Round 1 versus 14 later, with another 8 for the last Coach. Alley/Boat retain their 12-point cost.
- Add an increasing penalty when the remaining Street route leaves fewer than four spare slots. This starts earlier for long routes and discourages repeated retreats. Recent revisits cost 8 instead of 5.
- Check deadline feasibility using remaining Alley/Boat tiles, a legal final Street arrival, and Jack's actual hidden discovery restrictions. Coach costs two slots, so cannot shorten an otherwise unblocked route's slot count. Future investigator blocks remain unknown.
- Count only deadline-viable exits in the trap forecast. Keep emergency specials and backtracking available.
- Keep the investigator deployment forecast's opening preferences aligned. Its best starting-crossing set changes from FP/JD/JH to HP/JD/JH.

## Reproductions

Inspected candidate scores with Node's debugger; no temporary application logging was added.

- Recorded Round 1, Move 6, Jack at 168, investigators at HB/GS/FR: previously Coach 168→145→112; now Street 168→145, preserving the last Coach. Location 145 is outside arrest range.
- Recorded timeout, Round 1, Move 8, Jack at 30: previously retreat to 28, later to 10; now advance to 51 despite arrest-range risk. With the same geometry at Move 5, the safer retreat remains preferred.
- Synthetic 72 opening with one investigator at DM and two in the south at GS/HB: reaches discovery 46 in four turns, preserving both Coaches. Investigators stay put and pass; this isolates pacing and does not claim to reproduce the user's exact game.
- Regression coverage includes Round 1 emergency Coach escapes, later-round reserve differences, and last-chance Alley/Boat routes followed by Street arrival on Move 15. Browser coverage checks the real AI worker's Coach conservation and persistence after refresh.

## Small simulation comparison

Four seeds (`review-1` through `review-4`), preserving each baseline investigator deployment while allowing Jack to choose his start with the new strategy:

| Metric | Previous Jack | Updated Jack |
| --- | ---: | ---: |
| Total Round 1 Coaches used | 8 | 6 |
| Timeouts | 1 | 0 |
| Jack wins | 0 | 0 |

The previous timeout game now reaches discovery 77 on Move 13 but is arrested before revealing it. These results support the intended change in behavior, not a claim of improved win rate. Four additional games with the updated deployment also had no timeouts; all ended in arrests.

Diagnostics are saved locally under the ignored `node_modules/.cache/ai-review/` directory: `jack-debug.json`, `jack-progress-fixed.json`, and `jack-progress.json`. The regular simulation can be repeated with `node scripts/analyze-ai-playthroughs.mjs`.
