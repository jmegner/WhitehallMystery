// Reproducible AI-vs-AI diagnostics. Decisions receive the same public knowledge
// as normal play; secret positions are recorded only afterward for analysis.
import { createServer } from 'vite'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const output = resolve(process.argv[2] ?? 'node_modules/.cache/ai-review/playthroughs.json')
const seeds = process.argv.slice(3)
if (!seeds.length) seeds.push('review-1', 'review-2', 'review-3', 'review-4')
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false } })
try {
  const { playAiTurn } = await server.ssrLoadModule('/src/game/ai.ts')
  const { aiTurnRandom } = await server.ssrLoadModule('/src/game/aiRandom.ts')
  const { createInitialGame } = await server.ssrLoadModule('/src/game/gameEngine.ts')
  const { createGameHistory, currentHistoryState, playerViewForState } = await server.ssrLoadModule('/src/game/history.ts')
  const { possibleJackLocations } = await server.ssrLoadModule('/src/game/inference.ts')
  const { createInvestigatorWeights } = await server.ssrLoadModule('/src/game/aiInvestigatorWeights.ts')
  const { circlesById, crossingsById } = await server.ssrLoadModule('/src/game/mapData.ts')
  const games = []
  await mkdir(dirname(output), { recursive: true })
  for (const seed of seeds) {
    let history = createGameHistory(createInitialGame())
    const turns = []
    const started = performance.now()
    for (let turn = 0; turn < 120; turn++) {
      const before = currentHistoryState(history)
      if (before.stage === 'gameOver') break
      const role = playerViewForState(before)
      const weights = role === 'investigators' ? createInvestigatorWeights(before) : undefined
      const possibilities = weights ? [...possibleJackLocations(before.publicRound)] : []
      const cursor = history.cursor
      const turnStarted = performance.now()
      history = playAiTurn(history, role === 'jack' ? 'investigators' : 'jack', aiTurnRandom(seed, before))
      const elapsedMilliseconds = performance.now() - turnStarted
      const after = currentHistoryState(history)
      const actions = history.entries.slice(cursor + 1).map(entry => entry.action)
      const searches = actions.filter(action => action.type === 'searchCircle')
      const repeatedNegativeSearches = searches.filter(action => before.publicRound?.observations.some(observation =>
        observation.kind === 'clue' && !observation.found && observation.circleId === action.circleId,
      )).map(action => action.circleId)
      turns.push({ role, round: before.round, move: before.moveSlot, start: before.publicRound?.start, elapsedMilliseconds,
        jackBefore: before.currentJack, jackAfter: after.currentJack, trail: after.roundTrail,
        reached: after.reachedDiscoveries, discoveries: after.discoveryLocations,
        positionsBefore: before.investigatorPositions, positionsAfter: after.investigatorPositions,
        targets: weights ? [...weights.targets] : [],
        possibilities: possibilities.map(id => ({ id, weight: weights.locationWeights.get(id), quadrant: circlesById.get(id).quadrant })),
        actions, repeatedNegativeSearches,
        log: after.publicLog.slice(before.publicLog.length),
      })
      if (history.cursor === cursor) throw new Error(`No progress: ${seed} ${before.stage}`)
    }
    const final = currentHistoryState(history)
    const game = { seed, result: final.result, round: final.round, move: final.moveSlot,
      discoveries: final.discoveryLocations, reached: final.reachedDiscoveries,
      searches: turns.flatMap(turn => turn.actions).filter(action => action.type === 'searchCircle').length,
      repeatedNegativeSearches: turns.reduce((sum, turn) => sum + turn.repeatedNegativeSearches.length, 0),
      elapsedSeconds: (performance.now() - started) / 1000, turns }
    games.push(game)
    await writeFile(output, JSON.stringify({ games, crossings: Object.fromEntries([...crossingsById].map(([id, c]) => [id, { x: c.x, y: c.y }])) }, null, 2))
    console.log(JSON.stringify({ seed, result: game.result, discoveries: game.discoveries, reached: game.reached, turns: turns.length, seconds: game.elapsedSeconds }))
  }
} finally { await server.close() }
