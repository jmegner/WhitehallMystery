import { expect, test } from 'vitest'
import { investigatorDiscoveryWarnings, jackDiscoveryWarnings } from './discoveryWarnings'
import { createInitialGame, legalJackDestinations } from './gameEngine'
import type { GameState } from './types'

const positions = { yellow: 'FP', blue: 'HP', red: 'HZ' }
const state: GameState = { ...createInitialGame(), stage: 'jackMove', round: 3, moveSlot: 11, currentJack: 81,
  discoveryLocations: [33, 46, 147, 159], reachedDiscoveries: [33, 46, 147], investigatorPositions: positions }
const jackWarnings = (state: GameState) => jackDiscoveryWarnings(state, new Set(legalJackDestinations(state)), new Set())

test('Jack’s warnings account for remaining slots and the availability of special moves', () => {
  const warnings = jackWarnings(state)
  expect(warnings.get(68)).toBe('unreachable')
  expect(warnings.get(118)).toBe('special-needed')
  expect(warnings.has(117)).toBe(false)
  expect(jackWarnings({ ...state, specialRemaining: { alley: 0, boat: 0, coach: 2 } }).get(118)).toBe('unreachable')

  const finalMove = { ...state, currentJack: 155, moveSlot: 14 }
  expect(legalJackDestinations(finalMove)).toContain(159)
  expect(jackWarnings(finalMove).has(159)).toBe(false)
  expect(jackWarnings(finalMove).size).toBe(legalJackDestinations(finalMove).length - 1)
})

test('Coach warnings include both slots and allow the best second stop', () => {
  const coach: GameState = { ...state, jackMoveSelection: { type: 'coach', path: [] } }
  expect(jackWarnings(coach).get(118)).toBe('unreachable')
  expect(jackWarnings(coach).has(117)).toBe(false)
  const second = jackWarnings({ ...coach, jackMoveSelection: { type: 'coach', path: [117] } })
  expect(second.get(118)).toBe('unreachable')
  expect(second.has(134)).toBe(false)
})

test.each([
  { type: 'alley', currentJack: 99, moveSlot: 11, destination: 118 },
  { type: 'boat', currentJack: 157, moveSlot: 12, destination: 138 },
] as const)('the $type destination uses up the selected tile before looking ahead', ({ type, currentJack, moveSlot, destination }) => {
  const special: GameState = { ...state, currentJack, moveSlot, jackMoveSelection: { type, path: [] },
    specialRemaining: { coach: 0, alley: 0, boat: 0, [type]: 1 } }
  expect(jackWarnings(special).get(destination)).toBe('unreachable')
  expect(jackWarnings({ ...special, specialRemaining: { ...special.specialRemaining, [type]: 2 } }).get(destination)).toBe('special-needed')
})

test('investigator warnings depend on public quadrants, not the chosen discovery or Jack’s position', () => {
  const publicRound: GameState['publicRound'] = { start: 147, observations: [],
    moves: [{ type: 'normal', startSlot: 11, endSlot: 11, investigatorPositions: positions }] }
  const afterMove: GameState = { ...state, stage: 'investigatorMove', publicRound }
  const warnings = investigatorDiscoveryWarnings(afterMove)
  expect(warnings.get(1)).toBe('unreachable')
  expect(warnings.get(131)).toBe('special-needed')
  expect(warnings.has(117)).toBe(false)
  const otherSecrets = { ...afterMove, discoveryLocations: [33, 46, 147, 117], currentJack: 131 }
  expect(investigatorDiscoveryWarnings(otherSecrets)).toEqual(warnings)

  const lastStreetMove = { ...publicRound.moves[0]!, startSlot: 15, endSlot: 15 }
  const lastSlot = { ...afterMove, moveSlot: 15, publicRound: { ...publicRound, moves: [lastStreetMove] } }
  expect(investigatorDiscoveryWarnings(lastSlot).has(117)).toBe(false)
  expect(investigatorDiscoveryWarnings({ ...lastSlot, publicRound: { ...publicRound,
    moves: [{ ...lastStreetMove, type: 'alley' }] } }).get(117)).toBe('unreachable')
})
