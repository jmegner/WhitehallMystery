import { describe, expect, test } from 'vitest'
import { chooseJackMove, jackMoveActions } from './aiJack'
import { jackEscapeForecast } from './aiJackLookahead'
import { minimumDiscoveryMoves } from './aiDiscoveryDistance'
import { createInitialGame, gameReducer, legalNormalDestinations } from './gameEngine'
import { adjacentCirclesForCrossing, reachableCrossings } from './mapData'
import { INVESTIGATOR_ORDER, type GameState } from './types'

const base = (currentJack = 72): GameState => ({ ...createInitialGame(), stage: 'jackMove', currentJack,
  discoveryLocations: [72, 46, 147, 159], reachedDiscoveries: [72], roundTrail: [currentJack],
  investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' },
  publicRound: { start: 72, moves: [], observations: [] } })
const threatened = (state: GameState) => new Set(Object.values(state.investigatorPositions)
  .flatMap(start => [...reachableCrossings(start, 2)].flatMap(adjacentCirclesForCrossing)))

// Play through the ordinary reducer, leaving investigators in place and passing
// their actions. This isolates Jack's pacing without replacing movement rules.
function jackTurnWithPassingInvestigators(state: GameState): GameState {
  for (const action of jackMoveActions(state, () => 0)) state = gameReducer(state, action)
  for (let step = 0; step < 20 && state.stage !== 'jackMove' && state.stage !== 'gameOver'; step++) {
    if (state.stage === 'investigatorMove') state = gameReducer(state, { type: 'moveInvestigator',
      crossingId: state.investigatorPositions[INVESTIGATOR_ORDER[state.activeInvestigator]!]! })
    else if (state.stage === 'investigatorAction') state = gameReducer(state, { type: 'passInspectorAction' })
    else state = gameReducer(state, { type: 'continueHandoff' })
  }
  expect(['jackMove', 'gameOver']).toContain(state.stage)
  return state
}

describe('Jack Coach reserves and round pacing', () => {
  test('saves the last Coach when a safe forward Street move is available in Round 1', () => {
    // Recorded game: the old AI spent Coach on 168→145→112 for a tiny score gain.
    const state: GameState = { ...base(168), moveSlot: 6,
      discoveryLocations: [9, 77, 129, 161], reachedDiscoveries: [129],
      roundTrail: [129, 126, 181, 183, 185, 186, 168],
      investigatorPositions: { yellow: 'HB', blue: 'GS', red: 'FR' },
      specialRemaining: { coach: 1, alley: 1, boat: 2 } }
    expect(threatened(state).has(145)).toBe(false)
    for (const random of [() => 0, () => 0.999]) {
      expect(chooseJackMove(state, random)).toMatchObject({ type: 'normal', path: [145] })
    }
    expect(jackTurnWithPassingInvestigators(state).specialRemaining.coach).toBe(1)
  })

  test('sets a higher Coach reserve in Round 1 than in later rounds', () => {
    const state = base(14)
    expect(chooseJackMove(state, () => 0)?.type).toBe('normal')
    expect(chooseJackMove({ ...state, round: 2, reachedDiscoveries: [72, 159] }, () => 0)?.type).toBe('coach')
  })

  test('still uses Coach in Round 1 when it escapes every threatened Street destination', () => {
    const state = { ...base(88), specialRemaining: { coach: 2, alley: 0, boat: 0 } }
    const danger = threatened(state)
    const streets = legalNormalDestinations(state)
    expect(streets.length).toBeGreaterThan(0)
    expect(streets.every(id => danger.has(id))).toBe(true)
    const plan = chooseJackMove(state, () => 0)!
    expect(plan.type).toBe('coach')
    expect(danger.has(plan.path.at(-1)!)).toBe(false)
    const next = jackMoveActions(state, () => 0).reduce(gameReducer, state)
    expect(next.specialRemaining.coach).toBe(1)
    expect(next.moveSlot).toBe(2)
  })

  test('takes progress before retreating consumes the round, but retains retreats when time allows', () => {
    // Recorded timeout: at M8 Jack chose 28 and later 10, deeper in the NW.
    const state: GameState = { ...base(30), moveSlot: 8,
      discoveryLocations: [34, 77, 148, 161], reachedDiscoveries: [34],
      roundTrail: [34, 37, 21, 3, 2, 11, 14, 11, 30],
      investigatorPositions: { yellow: 'JR', blue: 'CC', red: 'DG' },
      specialRemaining: { coach: 1, alley: 2, boat: 2 } }
    const danger = threatened(state)
    expect(danger.has(28)).toBe(false)
    expect(danger.has(51)).toBe(true)
    expect(chooseJackMove({ ...state, moveSlot: 5 }, () => 0)?.path).toEqual([28])
    for (const random of [() => 0, () => 0.999]) expect(chooseJackMove(state, random)?.path).toEqual([51])
  })

  test('leaves 72 and completes the round promptly with two investigators occupied in the south', () => {
    let state: GameState = { ...base(), investigatorPositions: { yellow: 'DM', blue: 'GS', red: 'HB' } }
    let turns = 0
    while (state.round === 1 && state.stage !== 'gameOver' && turns < 15) {
      state = jackTurnWithPassingInvestigators(state)
      turns++
    }
    expect(state.result).toBeNull()
    expect(state.round).toBe(2)
    expect(state.reachedDiscoveries).toEqual([72, 46])
    expect(turns).toBeLessThanOrEqual(6)
    expect(state.specialRemaining.coach).toBe(2)
  })
})

describe('Jack deadline-aware escapes', () => {
  test.each([
    { from: 102, goal: 71, reached: [117, 129, 5], type: 'alley' as const },
    { from: 80, goal: 130, reached: [1, 5, 117], type: 'boat' as const },
  ])('uses a final $type shortcut followed by a Street arrival, accounting for the spent token', ({ from, goal, reached, type }) => {
    const state: GameState = { ...base(from), round: 3, moveSlot: 13, investigatorPositions: {},
      discoveryLocations: [...reached, goal], reachedDiscoveries: reached,
      specialRemaining: { coach: 0, alley: 0, boat: 0, [type]: 1 } }
    const distances = minimumDiscoveryMoves(new Set([goal]), state.specialRemaining, true)
    expect(distances[0]![0]!.get(from)).toBeGreaterThan(2)
    expect(distances[state.specialRemaining.alley]![state.specialRemaining.boat]!.get(from)).toBe(2)
    expect(jackEscapeForecast(state).minimumLegalExits).toBeGreaterThan(0)
    const first = chooseJackMove(state, () => 0)!
    expect(first.type).toBe(type)
    expect(first.path).not.toContain(goal) // Specials cannot reveal discoveries.
    const next = { ...state, currentJack: first.path.at(-1)!, moveSlot: 14,
      specialRemaining: { ...state.specialRemaining, [type]: 0 } }
    expect(chooseJackMove(next, () => 0)).toMatchObject({ type: 'normal', path: [goal] })
    expect(jackEscapeForecast({ ...state, specialRemaining: { coach: 0, alley: 0, boat: 0 } }).minimumLegalExits).toBe(0)
  })
})
