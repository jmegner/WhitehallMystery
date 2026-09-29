import { describe, expect, test } from 'vitest'
import { createInvestigatorWeights, viableJackLocations } from './aiInvestigatorWeights'
import { expectedNextPossibilities, nextStreetLocations, orderedSearches, pursuitScore, weightedNextPossibilities } from './aiInvestigators'
import { createInitialGame } from './gameEngine'
import { circlesById } from './mapData'
import type { SearchOutcome } from './inference'
import type { GameState } from './types'

const positions = { yellow: 'FP', blue: 'HP', red: 'HZ' }
function progress(moveSlot = 1, reachedDiscoveries = [72]): GameState {
  return { ...createInitialGame(), stage: 'investigatorMove', moveSlot, reachedDiscoveries,
    investigatorPositions: positions, specialRemaining: { alley: 0, boat: 0, coach: 0 },
    publicRound: { start: reachedDiscoveries.at(-1)!, observations: [], moves: Array.from({ length: moveSlot }, (_, index) => ({
      type: 'normal', startSlot: index + 1, endSlot: index + 1, investigatorPositions: positions,
    })) },
  }
}
const currentOrNever = (id: number, others: number[]): SearchOutcome => ({
  ifYes: new Set([id]), ifNo: new Set(others), positiveMeansJackIsThereNow: true,
})

describe('investigator progress weights', () => {
  test('values 73 over 54 when the round starts at 72, including their next-turn destinations', () => {
    const weights = createInvestigatorWeights(progress())!
    expect(weights.locationWeights.get(73)).toBeCloseTo(0.51)
    expect(weights.locationWeights.get(54)).toBeCloseTo(0.02 + 0.98 * 2 ** -2.5)
    expect(weights.minimumDiscoveryMoves(73)).toBe(2)
    expect(weights.minimumDiscoveryMoves(54)).toBe(3)
    expect(weightedNextPossibilities(new Set([73]), {}, weights)).toBeGreaterThan(weightedNextPossibilities(new Set([54]), {}, weights))
    const possible = new Set([73, 54])
    const outcomes = new Map([[73, currentOrNever(73, [54])], [54, currentOrNever(54, [73])]])
    expect(orderedSearches([54, 73], outcomes, possible, {}, undefined, weights)[0]).toBe(73)
    expect(expectedNextPossibilities(possible, {}, [[73]], outcomes, [], weights)).toBeLessThan(expectedNextPossibilities(possible, {}, [[54]], outcomes, [], weights))
  })

  test('weights the union of reachable next locations once, respecting occupied crossings', () => {
    const weights = createInvestigatorWeights(progress())!
    const possible = new Set([73, 54])
    for (const occupied of [{}, positions]) {
      const next = nextStreetLocations(possible, occupied)
      const expected = [...next].reduce((sum, id) => sum + weights.locationWeights.get(id)!, 0)
      expect(weightedNextPossibilities(possible, occupied, weights)).toBeCloseTo(expected)
    }
    expect(weightedNextPossibilities(possible, {}, weights)).toBeLessThan(
      weightedNextPossibilities(new Set([73]), {}, weights) + weightedNextPossibilities(new Set([54]), {}, weights),
    )
    expect(pursuitScore(possible, positions, weights)).toBeLessThan(pursuitScore(possible, positions))
  })

  test('uses public quadrants and excludes earlier positive clues, while retaining a possible pending discovery', () => {
    const state = progress(2)
    const weights = createInvestigatorWeights(state)!
    expect([...weights.targets].every(id => circlesById.get(id)!.color === 'white' && circlesById.get(id)!.quadrant !== 'NW')).toBe(true)
    const revealed = createInvestigatorWeights({ ...state, reachedDiscoveries: [72, 5] })!
    expect([...revealed.targets].some(id => circlesById.get(id)!.quadrant === 'NE')).toBe(false)
    const earlier = createInvestigatorWeights({ ...state, publicRound: { ...state.publicRound!, observations: [
      { kind: 'clue', circleId: 5, found: true, afterMove: 1, investigator: 'yellow' },
      { kind: 'clue', circleId: 6, found: false, afterMove: 1, investigator: 'blue' },
      { kind: 'clue', circleId: 7, found: true, afterMove: 2, investigator: 'red' },
    ] } })!
    expect(earlier.targets.has(5)).toBe(false)
    expect(earlier.targets.has(6)).toBe(true)
    expect(earlier.targets.has(7)).toBe(true)
  })

  test('keeps a nonzero strategic floor and does not use Jack’s secrets or planned investigator positions', () => {
    const state = progress()
    const original = createInvestigatorWeights(state)!
    const changed = createInvestigatorWeights({ ...state, currentJack: 189, discoveryLocations: [1, 7, 173, 188], roundTrail: [189],
      jackMoveSelection: { type: 'coach', path: [130] }, investigatorPositions: {},
    } as GameState)!
    expect(changed.locationWeights).toEqual(original.locationWeights)
    expect(changed.targets).toEqual(original.targets)
    for (const [id, weight] of original.locationWeights) {
      expect(weight).toBeGreaterThanOrEqual(0.02)
      expect(weight).toBeLessThanOrEqual(1)
      expect(changed.minimumDiscoveryMoves(id)).toBe(original.minimumDiscoveryMoves(id))
    }
    expect(createInvestigatorWeights(createInitialGame())).toBeUndefined()
  })
})

describe('investigator deadline weighting', () => {
  test('assigns no search or pursuit value to a location that cannot finish the round in time', () => {
    const weights = createInvestigatorWeights(progress(13))!
    const possible = new Set([54, 73])
    expect(viableJackLocations(possible, weights)).toEqual(new Set([73]))
    expect(possible).toEqual(new Set([54, 73])) // Exact deduction is not rewritten.
    expect(weightedNextPossibilities(new Set([54]), {}, weights)).toBe(0)
    expect(pursuitScore(new Set([54]), positions, weights)).toBe(0)
    const outcomes = new Map([[54, currentOrNever(54, [73])]])
    const withoutSearch = expectedNextPossibilities(possible, {}, [], outcomes, [], weights)
    expect(withoutSearch).toBeGreaterThan(0)
    expect(expectedNextPossibilities(possible, {}, [[54]], outcomes, [], weights)).toBe(withoutSearch)
  })

  test('still values a query at a doomed trail location when it distinguishes viable current locations', () => {
    const weights = createInvestigatorWeights(progress(13))!
    const possible = new Set([73, 57])
    const outcomes = new Map<number, SearchOutcome>([[54, {
      ifYes: new Set([73]), ifNo: new Set([57]), positiveMeansJackIsThereNow: false,
    }]])
    expect(expectedNextPossibilities(possible, {}, [[54]], outcomes, [], weights)).toBeLessThan(
      expectedNextPossibilities(possible, {}, [], outcomes, [], weights),
    )
  })

  test('allows arrival on move 15 and charges the forecast move against the remaining budget', () => {
    const weights = createInvestigatorWeights(progress(14))!
    expect(viableJackLocations(new Set([57, 73]), weights)).toEqual(new Set([57]))
    const reachableGoals = [...nextStreetLocations(new Set([57]), {})].filter(id => weights.targets.has(id))
    expect(reachableGoals.length).toBeGreaterThan(0)
    expect(weightedNextPossibilities(new Set([57]), {}, weights)).toBeCloseTo(reachableGoals.length)
  })

  test('retains a discovery awaiting reveal on move 15 and resets its forecast budget', () => {
    const state = progress(15)
    const weights = createInvestigatorWeights(state)!
    expect(weights.targets.has(5)).toBe(true)
    expect(viableJackLocations(new Set([5, 54]), weights)).toEqual(new Set([5]))
    expect(weightedNextPossibilities(new Set([5]), {}, weights)).toBeGreaterThan(0)
    const specialArrival = createInvestigatorWeights({ ...state, publicRound: { ...state.publicRound!, moves: [
      ...state.publicRound!.moves.slice(0, -1), { ...state.publicRound!.moves.at(-1)!, type: 'alley' },
    ] } })!
    expect(viableJackLocations(new Set([5]), specialArrival).size).toBe(0)
  })

  test.each([
    { name: 'Alley', id: 102, reached: [117, 129, 5], type: 'alley' as const },
    { name: 'Boat', id: 80, reached: [1, 5, 117], type: 'boat' as const },
  ])('preserves a last-chance $name rescue and requires a final Street move', ({ id, reached, type }) => {
    const state = progress(13, reached)
    const spent = createInvestigatorWeights(state)!
    const available = createInvestigatorWeights({ ...state, specialRemaining: { ...state.specialRemaining, [type]: 1 } })!
    expect(spent.minimumDiscoveryMoves(id)).toBe(3)
    expect(available.minimumDiscoveryMoves(id)).toBe(2)
    expect(weightedNextPossibilities(new Set([id]), {}, spent)).toBe(0)
    expect(weightedNextPossibilities(new Set([id]), {}, available)).toBeGreaterThan(0)
    expect(viableJackLocations(new Set([id]), { ...available, remainingMoves: 1 }).size).toBe(0)
  })

  test('respects finite special supplies and does not count Coach as a one-slot shortcut', () => {
    const state = progress(12, [117, 129, 5])
    const one = createInvestigatorWeights({ ...state, specialRemaining: { alley: 1, boat: 0, coach: 0 } })!
    const two = createInvestigatorWeights({ ...state, specialRemaining: { alley: 2, boat: 0, coach: 0 } })!
    expect(one.minimumDiscoveryMoves(120)).toBe(4)
    expect(two.minimumDiscoveryMoves(120)).toBe(3)
    expect(viableJackLocations(new Set([120]), one).size).toBe(0)
    expect(weightedNextPossibilities(new Set([120]), {}, two)).toBeGreaterThan(0)
    const coach = createInvestigatorWeights({ ...progress(13), specialRemaining: { alley: 0, boat: 0, coach: 2 } })!
    expect(coach.minimumDiscoveryMoves(54)).toBe(3)
    expect(viableJackLocations(new Set([54]), coach).size).toBe(0)
  })
})
