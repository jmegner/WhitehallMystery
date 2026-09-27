import { describe, expect, test } from 'vitest'
import { chooseJackMove, JACK_TIE_MARGIN } from './aiJack'
import { jackEscapeForecast } from './aiJackLookahead'
import { coveringArrests, nextStreetLocations, orderedSearches, planInvestigatorMoves } from './aiInvestigators'
import { createInvestigatorWeights } from './aiInvestigatorWeights'
import { aiTurnRandom, rankWithRandomTies } from './aiRandom'
import { playAiTurn } from './ai'
import { createInitialGame, gameReducer, legalInvestigatorDestinations, legalNormalDestinations } from './gameEngine'
import { createGameHistory, currentHistoryState } from './history'
import { adjacentCirclesForCrossing, crossings, reachableCrossings, startingCrossings } from './mapData'
import { possibleJackLocations, type SearchOutcome } from './inference'
import { INVESTIGATOR_ORDER, type GameState } from './types'

const base = (currentJack = 85): GameState => ({ ...createInitialGame(), stage: 'jackMove', currentJack,
  moveSlot: 1, discoveryLocations: [33, 46, 147, 159], reachedDiscoveries: [33], roundTrail: [currentJack],
  investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' }, specialRemaining: { coach: 0, alley: 0, boat: 0 },
  publicRound: { start: 33, moves: [], observations: [] } })

describe('investigator pursuit', () => {
  const reachableLocations = (crossing: string, turns: number) =>
    new Set([...reachableCrossings(crossing, 2 * turns)].flatMap(adjacentCirclesForCrossing))

  test('moves distant investigators toward future actions even when Blue alone can act in the 36 opening', () => {
    const positions = { yellow: 'FP', blue: 'JD', red: 'JH' }
    const state: GameState = { ...base(37), stage: 'investigatorMove', reachedDiscoveries: [36],
      discoveryLocations: [36, 46, 147, 159], roundTrail: [36, 37],
      investigatorPositions: positions, publicRound: { start: 36, observations: [], moves: [
        { type: 'normal', startSlot: 1, endSlot: 1, investigatorPositions: positions },
      ] } }
    const possible = possibleJackLocations(state.publicRound)
    const weights = createInvestigatorWeights(state)
    for (const color of ['yellow', 'red'] as const) {
      const reachable = [...reachableCrossings(positions[color], 2)].flatMap(adjacentCirclesForCrossing)
      expect(reachable.some(id => possible.has(id))).toBe(false)
    }
    expect([...reachableCrossings(positions.blue, 2)].flatMap(adjacentCirclesForCrossing).some(id => possible.has(id))).toBe(true)

    for (const seed of ['opening1', 'opening2', 'opening5']) {
      const plan = planInvestigatorMoves(state, aiTurnRandom(seed, state))
      expect(adjacentCirclesForCrossing(plan.blue!).some(id => possible.has(id))).toBe(true)
      let moved = state
      for (const color of INVESTIGATOR_ORDER) {
        expect(legalInvestigatorDestinations(moved)).toContain(plan[color])
        moved = gameReducer(moved, { type: 'moveInvestigator', crossingId: plan[color]! })
      }
      const future = nextStreetLocations(possible, plan)
      const futureCoverage = (crossing: string) => [...reachableLocations(crossing, 1)]
        .filter(id => future.has(id)).reduce((sum, id) => sum + weights!.locationWeights.get(id)!, 0)
      for (const color of ['yellow', 'red'] as const) {
        expect(plan[color]).not.toBe(positions[color])
        expect(futureCoverage(plan[color]!)).toBeGreaterThan(futureCoverage(positions[color]))
      }
      const changedSecrets = { ...state, currentJack: 73, discoveryLocations: [36, 5, 130, 139], roundTrail: [36, 73] }
      expect(planInvestigatorMoves(changedSecrets, aiTurnRandom(seed, changedSecrets))).toEqual(plan)
    }
  })

  test.each([1, 7, 173, 188])('brings all three investigators closer when Jack starts at %s and nobody can act yet', start => {
    const positions = { yellow: 'FP', blue: 'HP', red: 'HZ' }
    const state: GameState = { ...base(), stage: 'investigatorMove', reachedDiscoveries: [start],
      investigatorPositions: positions, publicRound: { start, observations: [], moves: [
        { type: 'normal', startSlot: 1, endSlot: 1, investigatorPositions: positions },
      ] } }
    const possible = possibleJackLocations(state.publicRound)
    for (const crossing of Object.values(positions)) {
      expect([...reachableLocations(crossing, 1)].some(id => possible.has(id))).toBe(false)
    }
    const plan = planInvestigatorMoves(state, aiTurnRandom('all-away', state))
    const future = nextStreetLocations(nextStreetLocations(possible, plan), plan)
    const coverage = (crossing: string) => [...reachableLocations(crossing, 2)].filter(id => future.has(id)).length
    let moved = state
    for (const color of INVESTIGATOR_ORDER) {
      expect(legalInvestigatorDestinations(moved)).toContain(plan[color])
      moved = gameReducer(moved, { type: 'moveInvestigator', crossingId: plan[color]! })
      expect(plan[color]).not.toBe(positions[color])
      expect(coverage(plan[color]!)).toBeGreaterThan(coverage(positions[color]))
    }
  })
})

describe('random AI ties', () => {
  test('reproduces saved turns, varies by game, and excludes private information from the seed', () => {
    const state = base()
    const sample = (id: string, state: GameState) => {
      const random = aiTurnRandom(id, state)
      return Array.from({ length: 12 }, random)
    }
    expect(sample('game-a', structuredClone(state))).toEqual(sample('game-a', state))
    expect(sample('game-b', state)).not.toEqual(sample('game-a', state))
    expect(sample('game-a', { ...state, currentJack: 189, discoveryLocations: [1, 7, 173, 188], roundTrail: [189], jackMoveSelection: { type: 'coach', path: [130] } })).toEqual(sample('game-a', state))
    expect(sample('game-a', state).every(value => value >= 0 && value < 1)).toBe(true)
  })

  test('randomizes equal scores without promoting inferior candidates or mutating inputs', () => {
    const candidates = [{ id: 'a', score: 0 }, { id: 'b', score: 0 }, { id: 'c', score: 3 }]
    const compare = (a: typeof candidates[number], b: typeof candidates[number]) => a.score - b.score
    expect(rankWithRandomTies(candidates, compare, () => 0).map(item => item.id)).toEqual(['b', 'a', 'c'])
    expect(rankWithRandomTies(candidates, compare, () => 0.999).map(item => item.id)).toEqual(['a', 'b', 'c'])
    expect(candidates.map(item => item.id)).toEqual(['a', 'b', 'c'])
  })

  test('varies actual Jack moves within the score margin', () => {
    const state = base(1)
    const best = chooseJackMove(state, () => 0)!
    const alternative = chooseJackMove(state, () => 0.999)!
    expect(best.path).not.toEqual(alternative.path)
    expect(best.score - alternative.score).toBeLessThanOrEqual(JACK_TIE_MARGIN)
    expect(legalNormalDestinations(state)).toContain(alternative.path[0])
    expect(chooseJackMove(state, aiTurnRandom('game-a', state))).toEqual(chooseJackMove(state, aiTurnRandom('game-a', state)))
  })

  test('randomizes search ties while retaining smallest-positive-first priorities', () => {
    const possible = new Set([36, 72, 73])
    const outcomes = new Map<number, SearchOutcome>([
      [1, { ifYes: new Set([36]), ifNo: new Set([72, 73]), positiveMeansJackIsThereNow: false }],
      [2, { ifYes: new Set([36]), ifNo: new Set([72, 73]), positiveMeansJackIsThereNow: false }],
      [3, { ifYes: new Set([72, 73]), ifNo: new Set([36]), positiveMeansJackIsThereNow: false }],
    ])
    const first = orderedSearches([1, 2, 3], outcomes, possible, {}, () => 0)
    const other = orderedSearches([1, 2, 3], outcomes, possible, {}, () => 0.999)
    expect(first[0]).not.toBe(other[0])
    expect(first.at(-1)).toBe(3)
    expect(other.at(-1)).toBe(3)
  })

  test('varies investigator deployments among legal coordinated plans', () => {
    const state: GameState = { ...createInitialGame(), stage: 'investigatorSetup' }
    const plans = ['one', 'two', 'three'].map(id => planInvestigatorMoves(state, aiTurnRandom(id, state)))
    expect(new Set(plans.map(plan => JSON.stringify(plan))).size).toBeGreaterThan(1)
    for (const plan of plans) {
      expect(new Set(Object.values(plan)).size).toBe(3)
      for (const id of Object.values(plan)) expect(startingCrossings.map(crossing => crossing.id)).toContain(id)
    }
  })

  test('randomized arrest plans still cover every remaining target with distinct pieces', () => {
    const state: GameState = { ...base(), stage: 'investigatorMove', publicRound: { start: 33, moves: [{ type: 'normal', startSlot: 1, endSlot: 1, investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' } }], observations: [] } }
    const all = [...possibleJackLocations(state.publicRound)]
    const targets = new Set(all.slice(0, 3))
    state.publicRound!.observations = all.slice(3).map(circleId => ({ kind: 'arrest', circleId, hit: false, afterMove: 1, investigator: 'yellow' }))
    const used = new Set<string>()
    for (const [index, color] of INVESTIGATOR_ORDER.entries()) {
      const crossing = crossings.find(crossing => !used.has(crossing.id) && adjacentCirclesForCrossing(crossing.id).includes([...targets][index]!))!
      used.add(crossing.id)
      state.investigatorPositions[color] = crossing.id
    }
    for (const id of ['one', 'two', 'three']) {
      const plan = planInvestigatorMoves(state, aiTurnRandom(id, state))
      expect(coveringArrests(targets, plan)).not.toBeNull()
      let moved = state
      for (const color of INVESTIGATOR_ORDER) {
        expect(legalInvestigatorDestinations(moved)).toContain(plan[color])
        moved = gameReducer(moved, { type: 'moveInvestigator', crossingId: plan[color]! })
      }
    }
  })

  test('replays the same pending AI turn after refresh', () => {
    const initial = createGameHistory(createInitialGame())
    const first = playAiTurn(initial, 'investigators', aiTurnRandom('saved-id', currentHistoryState(initial)))
    const restored = JSON.parse(JSON.stringify(initial))
    expect(playAiTurn(restored, 'investigators', aiTurnRandom('saved-id', currentHistoryState(restored)))).toEqual(first)
    const turn = createGameHistory(base(1))
    const before = JSON.stringify(turn)
    expect(playAiTurn(turn, 'investigators', aiTurnRandom('saved-id', currentHistoryState(turn)))).toEqual(
      playAiTurn(structuredClone(turn), 'investigators', aiTurnRandom('saved-id', currentHistoryState(turn))),
    )
    expect(JSON.stringify(turn)).toBe(before)
  })
})

describe('Jack trap lookahead', () => {
  test('finds a real coordinated blockade despite eight currently open street exits', () => {
    const state = base()
    expect(legalNormalDestinations(state)).toHaveLength(8)
    const forecast = jackEscapeForecast(state)
    expect(forecast.minimumLegalExits).toBe(0)
    expect(forecast.trapPositions).not.toBeNull()
    let reply: GameState = { ...state, stage: 'investigatorMove', activeInvestigator: 0 }
    for (const color of INVESTIGATOR_ORDER) {
      const crossingId = forecast.trapPositions![color]!
      expect(legalInvestigatorDestinations(reply)).toContain(crossingId)
      reply = gameReducer(reply, { type: 'moveInvestigator', crossingId })
    }
    expect(new Set(Object.values(reply.investigatorPositions)).size).toBe(3)
    expect(legalNormalDestinations(reply)).toEqual([])
    // One piece cannot independently occupy every blocking crossing.
    expect(jackEscapeForecast({ ...state, investigatorPositions: { yellow: 'FP' } }).minimumLegalExits).toBeGreaterThan(0)
  })

  test('accounts for available escapes, spent tokens and Coach move-track limits', () => {
    const state = base()
    expect(jackEscapeForecast({ ...state, specialRemaining: { coach: 1, alley: 0, boat: 0 } }).minimumLegalExits).toBeGreaterThan(0)
    expect(jackEscapeForecast({ ...state, specialRemaining: { coach: 0, alley: 1, boat: 0 } }).minimumLegalExits).toBeGreaterThan(0)
    expect(jackEscapeForecast({ ...state, specialRemaining: { coach: 0, alley: 0, boat: 1 } }).minimumLegalExits).toBe(0)
    expect(jackEscapeForecast({ ...state, moveSlot: 14, specialRemaining: { coach: 1, alley: 0, boat: 0 } }).minimumLegalExits).toBe(0)
    expect(jackEscapeForecast({ ...state, moveSlot: 0, specialRemaining: { coach: 1, alley: 0, boat: 0 } }).minimumLegalExits).toBeGreaterThan(0)
  })

  test('keeps alternate street paths open when there are no investigators to close them', () => {
    const state = { ...base(33), investigatorPositions: {} }
    const forecast = jackEscapeForecast(state)
    expect(forecast.minimumStreetExits).toBe(legalNormalDestinations(state).length)
    expect(forecast.minimumSafeExits).toBe(forecast.minimumStreetExits)
    expect(forecast.trapPositions).toBeNull()
  })

  test('avoids a tempting move whose next escapes investigators can all threaten', () => {
    const state = base(83)
    expect(legalNormalDestinations(state)).toEqual(expect.arrayContaining([82, 100]))
    expect(jackEscapeForecast({ ...state, currentJack: 100, moveSlot: 2 }).minimumSafeExits).toBe(0)
    expect(jackEscapeForecast({ ...state, currentJack: 82, moveSlot: 2 }).minimumSafeExits).toBeGreaterThan(0)
    for (const random of [() => 0, () => 0.999]) expect(chooseJackMove(state, random)?.path).toEqual([82])
  })
})
