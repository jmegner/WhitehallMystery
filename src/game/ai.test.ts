import { describe, expect, test } from 'vitest'
import { chooseEasyDiscoveries, discoveryDifficulty, EASY_DISCOVERY_LIMIT } from './aiDiscoveries'
import { chooseJackMove, chooseJackStart, jackMoveActions } from './aiJack'
import { coveringArrests, expectedNextPossibilities, investigatorAction, nextStreetLocations, orderedSearches, planInvestigatorMoves } from './aiInvestigators'
import { playAiTurn } from './ai'
import { aiHistoryReducer, needsAiTurn, resumeAiHistory } from './aiSession'
import { createInitialGame, gameReducer, legalInvestigatorDestinations, legalNormalDestinations } from './gameEngine'
import { createGameHistory, currentHistoryState, gameHistoryReducer, playerViewForState } from './history'
import { adjacentCirclesForCrossing, circlesById, crossings, jackTransitions, reachableCrossings, startingCrossings } from './mapData'
import { possibleJackLocations, possibleJackSearchOutcomes, type SearchOutcome } from './inference'
import { normalizeRemoteHistory } from './remoteHistory'
import { INVESTIGATOR_ORDER, type GameState } from './types'

const positions = { yellow: 'FP', blue: 'HP', red: 'HZ' }
function seeded(seed = 1) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 } }
const startState = (): GameState => gameReducer({ ...createInitialGame(), stage: 'jackChooseStart', discoveryLocations: [33, 46, 147, 159], investigatorPositions: positions }, { type: 'chooseJackStart', circleId: 33 })
function evidenceState(count = 3): GameState {
  let state = startState()
  state = gameReducer(state, { type: 'selectJackDestination', circleId: legalNormalDestinations(state)[0]! })
  state = gameReducer(state, { type: 'confirmJackMove' })
  state = gameReducer(state, { type: 'continueHandoff' })
  const possible = [...possibleJackLocations(state.publicRound)]
  const evidence = state.publicRound!
  return { ...state, publicRound: { ...evidence, observations: possible.slice(count).map(circleId => ({ kind: 'arrest', circleId, hit: false, afterMove: 1, investigator: 'yellow' })) } }
}

describe('Jack AI', () => {
  test('uses the original Easy threshold, legal quadrants and varying discovery sets', () => {
    const random = seeded(29)
    const sets = Array.from({ length: 100 }, () => chooseEasyDiscoveries(random))
    for (const ids of sets) {
      expect(discoveryDifficulty(ids)).toBeLessThanOrEqual(EASY_DISCOVERY_LIMIT)
      expect(new Set(ids.map(id => circlesById.get(id)!.quadrant)).size).toBe(4)
      expect(ids.every(id => circlesById.get(id)!.color === 'white')).toBe(true)
    }
    expect(new Set(sets.map(ids => ids.join(','))).size).toBeGreaterThan(50)
    expect(discoveryDifficulty(chooseEasyDiscoveries(() => 0))).toBeLessThanOrEqual(EASY_DISCOVERY_LIMIT)
  })

  test('chooses the starting discovery with the best available first move', () => {
    const state: GameState = { ...startState(), stage: 'jackChooseStart', currentJack: null, reachedDiscoveries: [] }
    const id = chooseJackStart(state, seeded())
    const scores = state.discoveryLocations.map(circleId => chooseJackMove(gameReducer(state, { type: 'chooseJackStart', circleId }), () => 0)!.score)
    expect(chooseJackMove(gameReducer(state, { type: 'chooseJackStart', circleId: id }), () => 0)!.score).toBe(Math.max(...scores))
  })

  test('records legal routes and spends only the selected special token', () => {
    for (const currentJack of [33, 72, 110, 162]) {
      const state = { ...startState(), currentJack, roundTrail: [33, currentJack] }
      const plan = chooseJackMove(state, seeded())!
      const result = jackMoveActions(state, seeded()).reduce(gameReducer, state)
      expect(result.stage).toBe('handoffInspectorsTurn')
      expect(result.currentJack).toBe(plan.path.at(-1))
      expect(result.moveSlot).toBe(plan.type === 'coach' ? 2 : 1)
      for (const type of ['coach', 'boat', 'alley'] as const) expect(result.specialRemaining[type]).toBe(2 - Number(type === plan.type))
    }
  })

  test('reaches a discovery on the last move instead of losing to timeout', () => {
    const state = startState()
    const target = legalNormalDestinations(state).find(id => circlesById.get(id)!.color === 'white')!
    const urgent = { ...state, moveSlot: 14, discoveryLocations: [33, target], specialRemaining: { coach: 0, alley: 0, boat: 0 } }
    expect(chooseJackMove(urgent)?.path).toEqual([target])
  })

  test('allows backtracking when every legal street move revisits the trail', () => {
    const state = startState()
    const destination = legalNormalDestinations(state)[0]!
    const revisiting = { ...state, specialRemaining: { coach: 0, alley: 0, boat: 0 }, roundTrail: [destination, ...legalNormalDestinations(state), 33] }
    const plan = chooseJackMove(revisiting)!
    expect(plan.type).toBe('normal')
    expect(revisiting.roundTrail).toContain(plan.path[0])
  })

  test('stays outside arrest range when a safe street move is practical', () => {
    const threatened = new Set(Object.values(positions).flatMap(start => [...reachableCrossings(start)].flatMap(adjacentCirclesForCrossing)))
    let checked = 0
    for (const currentJack of jackTransitions.keys()) {
      const state = { ...startState(), currentJack, roundTrail: [currentJack], specialRemaining: { coach: 0, alley: 0, boat: 0 } }
      const legal = legalNormalDestinations(state)
      if (!legal.some(id => !threatened.has(id)) || !legal.some(id => threatened.has(id))) continue
      expect(threatened.has(chooseJackMove(state)!.path.at(-1)!)).toBe(false)
      checked += 1
    }
    expect(checked).toBeGreaterThan(5)
  })

  test('uses special moves to escape when all street destinations are threatened', () => {
    const threatened = new Set(Object.values(positions).flatMap(start => [...reachableCrossings(start)].flatMap(adjacentCirclesForCrossing)))
    const escapes = [...jackTransitions.keys()].map(currentJack => {
      const state = { ...startState(), currentJack, roundTrail: [currentJack] }
      const street = legalNormalDestinations(state)
      if (!street.length || street.some(id => !threatened.has(id))) return null
      const plan = chooseJackMove(state)
      return plan && !threatened.has(plan.path.at(-1)!) ? plan : null
    }).filter(plan => plan !== null)
    expect(escapes.length).toBeGreaterThan(0)
    expect(escapes.every(plan => plan.type !== 'normal')).toBe(true)
  })
})

describe('investigator AI', () => {
  test('values a negative at high-mobility 36 more than at 72, beyond current counts', () => {
    const possible = new Set([36, 72])
    const outcomes = new Map<number, SearchOutcome>([
      [36, { ifYes: new Set([36]), ifNo: new Set([72]), positiveMeansJackIsThereNow: true }],
      [72, { ifYes: new Set([72]), ifNo: new Set([36]), positiveMeansJackIsThereNow: true }],
    ])
    expect(nextStreetLocations(new Set([36]), {}).size).toBeGreaterThan(nextStreetLocations(new Set([72]), {}).size)
    expect(orderedSearches([72, 36], outcomes, possible, {})).toEqual([36, 72])
    expect(expectedNextPossibilities(possible, {}, [[36]], outcomes)).toBeLessThan(expectedNextPossibilities(possible, {}, [[72]], outcomes))
  })

  test('searches the smallest positive branch first even when the other negative is stronger', () => {
    const possible = new Set([36, 72, 73])
    const outcomes = new Map<number, SearchOutcome>([
      [36, { ifYes: new Set([36, 73]), ifNo: new Set([72]), positiveMeansJackIsThereNow: false }],
      [72, { ifYes: new Set([72]), ifNo: new Set([36, 73]), positiveMeansJackIsThereNow: true }],
    ])
    expect(orderedSearches([36, 72], outcomes, possible, {})[0]).toBe(72)
  })

  test('requires a distinct investigator for each arrest target', () => {
    const crossing = crossings.find(c => adjacentCirclesForCrossing(c.id).length >= 3)!
    const targets = new Set(adjacentCirclesForCrossing(crossing.id).slice(0, 3))
    expect(coveringArrests(targets, { yellow: crossing.id })).toBeNull()
    const assigned = Object.fromEntries(INVESTIGATOR_ORDER.map((color, i) => [color, crossings.find(c => adjacentCirclesForCrossing(c.id).includes([...targets][i]!))!.id]))
    expect(new Set(Object.values(coveringArrests(targets, assigned)!))).toEqual(targets)
  })

  test('does not count redundant searches by multiple investigators as new information', () => {
    const possible = new Set([36, 72, 73])
    const outcomes = new Map<number, SearchOutcome>([[1, { ifYes: new Set([36, 72]), ifNo: new Set([72, 73]), positiveMeansJackIsThereNow: false }]])
    expect(expectedNextPossibilities(possible, {}, [[1], [1], [1]], outcomes)).toBe(expectedNextPossibilities(possible, {}, [[1]], outcomes))
  })

  test('coordinates legal moves to cover all three remaining locations', () => {
    const state = evidenceState()
    const possible = possibleJackLocations(state.publicRound)
    const close = { ...state, investigatorPositions: Object.fromEntries(INVESTIGATOR_ORDER.map((color, i) => [color, crossings.filter(c => adjacentCirclesForCrossing(c.id).includes([...possible][i]!))[0]!.id])) }
    const plan = planInvestigatorMoves(close)
    expect(coveringArrests(possible, plan)).not.toBeNull()
    let moved = close
    for (const color of INVESTIGATOR_ORDER) {
      expect(legalInvestigatorDestinations(moved)).toContain(plan[color])
      moved = gameReducer(moved, { type: 'moveInvestigator', crossingId: plan[color]! })
    }
    expect(new Set(Object.values(moved.investigatorPositions)).size).toBe(3)
  })

  test('arrests a sole adjacent current-or-never possibility and adapts after misses', () => {
    const state = evidenceState(2)
    const possible = [...possibleJackLocations(state.publicRound)]
    const crossing = crossings.find(c => adjacentCirclesForCrossing(c.id).includes(possible[0]!) && !adjacentCirclesForCrossing(c.id).includes(possible[1]!))!
    const acting: GameState = { ...state, stage: 'investigatorAction', inspectorActionMode: 'search', activeInvestigator: 2, investigatorPositions: { ...positions, red: crossing.id } }
    expect(investigatorAction(acting)).toContainEqual({ type: 'arrestCircle', circleId: possible[0] })
    expect(investigatorAction({ ...acting, checkedThisAction: [189] })).toContainEqual({ type: 'searchCircle', circleId: possible[0] })
  })

  test('does not use Jack secrets in movement or search decisions', () => {
    const state = evidenceState(2)
    const changed = { ...state, currentJack: 189, roundTrail: [189], discoveryLocations: [1, 7, 173, 188] }
    expect(planInvestigatorMoves(changed, seeded())).toEqual(planInvestigatorMoves(state, seeded()))
    expect(investigatorAction({ ...changed, stage: 'investigatorAction' }, seeded())).toEqual(investigatorAction({ ...state, stage: 'investigatorAction' }, seeded()))
  })

  test('counts only unblocked next-turn street destinations', () => {
    const from = 36
    const to = [...jackTransitions.get(from)!.keys()][0]!
    const blocked = jackTransitions.get(from)!.get(to)!.flat()
    const occupied = Object.fromEntries(blocked.map((id, i) => [String(i), id]))
    expect(nextStreetLocations(new Set([from]), occupied).has(to)).toBe(false)
  })
})

describe('AI turn lifecycle', () => {
  test('automates each opponent and stops at a human turn without a hot-seat handoff', () => {
    let history = playAiTurn(createGameHistory(createInitialGame()), 'investigators', seeded())
    expect(currentHistoryState(history).stage).toBe('investigatorSetup')
    for (const crossing of startingCrossings.slice(0, 3)) history = aiHistoryReducer(history, { type: 'apply', action: { type: 'placeInvestigator', crossingId: crossing.id } }, 'investigators')
    expect(needsAiTurn(history, 'investigators')).toBe(true)
    const before = history
    history = playAiTurn(history, 'investigators')
    expect(currentHistoryState(history).stage).toBe('investigatorMove')
    expect(aiHistoryReducer(history, { type: 'bigUndo' }, 'investigators').cursor).toBeLessThan(history.cursor)
    expect(aiHistoryReducer(before, { type: 'undo' }, 'investigators').cursor).toBeLessThan(before.cursor)
    const next = playAiTurn(history, 'jack')
    expect(['jackMove', 'gameOver']).toContain(currentHistoryState(next).stage)
  }, 30000)

  test('can undo human planning and cancel a pending AI turn', () => {
    let history = createGameHistory(startState())
    history = aiHistoryReducer(history, { type: 'apply', action: { type: 'selectJackDestination', circleId: legalNormalDestinations(startState())[0]! } }, 'jack')
    expect(aiHistoryReducer(history, { type: 'undo' }, 'jack').cursor).toBe(0)
    history = aiHistoryReducer(history, { type: 'apply', action: { type: 'confirmJackMove' } }, 'jack')
    expect(playerViewForState(currentHistoryState(history))).toBe('investigators')
    const undone = aiHistoryReducer(history, { type: 'undo' }, 'jack')
    expect(currentHistoryState(undone).stage).toBe('jackMove')
    expect(needsAiTurn(undone, 'jack')).toBe(false)
    expect(aiHistoryReducer(undone, { type: 'redo' }, 'jack')).toEqual(history)
  })

  test('allows undo and redo after game over', () => {
    const state = { ...startState(), moveSlot: 14 }
    let history = createGameHistory(state)
    history = gameHistoryReducer(history, { type: 'apply', action: { type: 'selectJackDestination', circleId: legalNormalDestinations(state)[0]! } })
    history = gameHistoryReducer(history, { type: 'apply', action: { type: 'confirmJackMove' } })
    expect(currentHistoryState(history).stage).toBe('gameOver')
    for (const role of ['jack', 'investigators'] as const) {
      const undone = aiHistoryReducer(history, { type: 'undo' }, role)
      expect(currentHistoryState(undone).stage).toBe('jackMove')
      expect(aiHistoryReducer(undone, { type: 'redo' }, role)).toEqual(history)
      expect(aiHistoryReducer(history, { type: 'bigUndo' }, role).cursor).toBe(0)
    }
  })

  test('resumes Jack AI from an undone partial discovery selection', () => {
    const history = playAiTurn(createGameHistory(createInitialGame()), 'investigators', seeded())
    const undone = aiHistoryReducer(history, { type: 'undo' }, 'investigators')
    expect(currentHistoryState(undone).discoveryLocations).toHaveLength(4)
    const resumed = playAiTurn(resumeAiHistory(undone), 'investigators', seeded())
    expect(currentHistoryState(resumed).stage).toBe('investigatorSetup')
    expect(discoveryDifficulty(currentHistoryState(resumed).discoveryLocations)).toBeLessThanOrEqual(EASY_DISCOVERY_LIMIT)
  })

  test('resumes Jack AI from a partially selected Coach route', () => {
    let state = gameReducer(startState(), { type: 'setJackMoveType', moveType: 'coach' })
    state = gameReducer(state, { type: 'selectJackDestination', circleId: legalNormalDestinations(state)[0]! })
    const plan = chooseJackMove(state, seeded())!
    const resumed = jackMoveActions(state, seeded()).reduce(gameReducer, state)
    expect(resumed.currentJack).toBe(plan.path.at(-1))
    expect(resumed.stage).toBe('handoffInspectorsTurn')
  })

  test('completes a seeded game without illegal moves, lost evidence, or stalled turns', () => {
    let history = createGameHistory(createInitialGame())
    for (let turn = 0; turn < 100 && currentHistoryState(history).stage !== 'gameOver'; turn += 1) {
      const side = playerViewForState(currentHistoryState(history))
      history = playAiTurn(history, side === 'jack' ? 'investigators' : 'jack', seeded(turn + 1))
      const state = currentHistoryState(history)
      if (state.publicRound && state.currentJack !== null && state.stage !== 'gameOver') expect(possibleJackLocations(state.publicRound).has(state.currentJack)).toBe(true)
    }
    expect(currentHistoryState(history).stage).toBe('gameOver')
    // Every committed AI action is replayable by the ordinary rules engine.
    let replay = createGameHistory(createInitialGame())
    for (const entry of history.entries.slice(1)) if (entry.action) replay = gameHistoryReducer(replay, { type: 'apply', action: entry.action })
    expect(currentHistoryState(normalizeRemoteHistory(replay))).toEqual(currentHistoryState(history))
    expect(possibleJackSearchOutcomes(currentHistoryState(history).publicRound).size).toBeGreaterThan(0)
  }, 60000)
})
