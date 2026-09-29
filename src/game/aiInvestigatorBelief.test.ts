import { describe, expect, test } from 'vitest'
import { beliefLocations, createInvestigatorBelief, locationBit } from './aiInvestigatorBelief'
import { createInvestigatorWeights, viableJackLocations } from './aiInvestigatorWeights'
import { createInitialGame } from './gameEngine'
import { possibleJackLocations } from './inference'
import type { GameState, PublicRoundEvidence } from './types'

const positions = { yellow: 'FP', blue: 'HP', red: 'HZ' }
function stateFor(start: number, types: Array<'normal' | 'coach'>, observations: PublicRoundEvidence['observations'] = []): GameState {
  let slot = 0
  const moves = types.map(type => ({ type, startSlot: slot + 1, endSlot: slot += type === 'coach' ? 2 : 1,
    investigatorPositions: positions }))
  return { ...createInitialGame(), stage: 'investigatorMove', investigatorPositions: positions,
    moveSlot: slot, reachedDiscoveries: [start], publicRound: { start, moves, observations } }
}
const found = (circleId: number, afterMove: number, result = true) =>
  ({ kind: 'clue' as const, circleId, afterMove, found: result, investigator: 'yellow' as const })

function model(state: GameState) {
  const weights = createInvestigatorWeights(state)!
  const belief = createInvestigatorBelief(state, weights)
  const probabilities = beliefLocations(belief.histories)
  expect(new Set(probabilities.keys())).toEqual(viableJackLocations(possibleJackLocations(state.publicRound), weights))
  expect([...probabilities.values()].reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10)
  expect([...probabilities.values()].every(value => value > 0)).toBe(true)
  return { ...belief, probabilities }
}

describe('public route belief', () => {
  test('prefers useful progress from 72 while keeping every retreat possible', () => {
    const belief = model(stateFor(72, ['normal']))
    expect(belief.probabilities.get(73)).toBeGreaterThan(belief.probabilities.get(54)!)
    expect(belief.probabilities.get(54)).toBeGreaterThan(0)
  })

  test('conditions a Coach clue on the whole trail; an arrest miss excludes only the endpoint', () => {
    const state = stateFor(35, ['coach'], [found(37, 1),
      { kind: 'arrest', circleId: 37, hit: false, afterMove: 1, investigator: 'blue' }])
    const belief = model(state)
    expect(belief.histories.length).toBeGreaterThan(0)
    expect(belief.histories.every(history => (history.visited & locationBit(37)) !== 0n)).toBe(true)
    expect(belief.histories.every(history => history.position !== 37)).toBe(true)
    expect(belief.probabilities.has(21)).toBe(true) // 35 → 37 → 21.
  })

  test('permits a later visit after a negative search, but excludes all visits before a current negative', () => {
    const returned = model(stateFor(35, ['normal', 'normal'], [found(37, 1, false), found(37, 2)]))
    expect([...returned.probabilities.keys()]).toEqual([37])
    const absent = model(stateFor(35, ['normal', 'normal'], [found(37, 2, false)]))
    expect(absent.histories.every(history => (history.visited & locationBit(37)) === 0n)).toBe(true)
  })

  test('preserves endpoint support under multiple positive clues and excludes doomed endpoints only from planning', () => {
    const state = stateFor(35, ['normal', 'normal', 'coach'], [found(37, 1), found(21, 2)])
    const belief = model(state)
    expect(belief.histories.every(history => (history.visited & locationBit(37)) && (history.visited & locationBit(21)))).toBe(true)
    const late = { ...state, moveSlot: 14, specialRemaining: { alley: 0, boat: 0, coach: 0 } }
    const lateBelief = model(late)
    expect(lateBelief.probabilities.size).toBeLessThan(possibleJackLocations(late.publicRound).size)
    expect(possibleJackLocations(late.publicRound)).toEqual(possibleJackLocations(state.publicRound))
  })

  test('is reproducible and unaffected by Jack secrets or proposed investigator positions', () => {
    const state = stateFor(35, ['normal', 'normal', 'coach'], [found(21, 2)])
    const original = model(state)
    const changed = model({ ...state, currentJack: 189, roundTrail: [189], discoveryLocations: [1, 7, 173, 188],
      investigatorPositions: { yellow: 'AA', blue: 'AB', red: 'AC' }, jackMoveSelection: { type: 'coach', path: [130] } })
    expect(changed).toEqual(original)
    expect(model(structuredClone(state))).toEqual(original)
  })
})
