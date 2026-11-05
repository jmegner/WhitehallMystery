import { describe, expect, test } from 'vitest'
import { floatingTurnSummary } from './floatingTurnSummary'
import { createInitialGame, nearestUnvisitedDiscoveryStreetDistance } from './game/gameEngine'
import type { GameState, JackMoveType } from './game/types'

const jackState = (): GameState => ({ ...createInitialGame(), stage: 'jackMove', currentJack: 33,
  discoveryLocations: [33, 17, 147, 159], reachedDiscoveries: [33],
  investigatorPositions: { yellow: 'BS', blue: 'HP', red: 'HZ' } })

describe('nearest unvisited discovery Street distance', () => {
  test('counts a blocked first move as a detour, then allows that crossing on later moves', () => {
    const state = { ...jackState(), discoveryLocations: [33, 17] }
    // 33–17 is one Street move without BS occupied. Blocking BS permanently
    // would require three moves; only the next move is blocked, so it takes two.
    expect(nearestUnvisitedDiscoveryStreetDistance({ ...state, investigatorPositions: {} })).toBe(1)
    expect(nearestUnvisitedDiscoveryStreetDistance(state)).toBe(2)
  })

  test('skips reached discoveries and chooses the closest of the remaining locations', () => {
    const state = { ...jackState(), currentJack: 85, discoveryLocations: [33, 46, 147, 159],
      investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' } }
    expect(nearestUnvisitedDiscoveryStreetDistance({ ...state, reachedDiscoveries: [] })).toBe(3)
    expect(nearestUnvisitedDiscoveryStreetDistance(state)).toBe(5)
  })

  test('distinguishes unavailable, already at a discovery, and no legal Street exit', () => {
    expect(nearestUnvisitedDiscoveryStreetDistance(createInitialGame())).toBeUndefined()
    expect(nearestUnvisitedDiscoveryStreetDistance({ ...jackState(), discoveryLocations: [33] })).toBeUndefined()
    expect(nearestUnvisitedDiscoveryStreetDistance({ ...jackState(), reachedDiscoveries: [] })).toBe(0)
    expect(nearestUnvisitedDiscoveryStreetDistance({ ...jackState(), currentJack: 1, discoveryLocations: [2],
      investigatorPositions: { yellow: 'BB', blue: 'BV', red: 'HP' } })).toBe(Infinity)
  })
})

describe('floating turn summary', () => {
  test.each<[JackMoveType, string]>([['normal', 'S'], ['alley', 'A'], ['boat', 'B'], ['coach', 'C']])(
    'investigators see the last confirmed %s move and counts in ABC order', (type, letter) => {
      const state: GameState = { ...jackState(), stage: 'investigatorAction', round: 2, moveSlot: 7,
        specialRemaining: { alley: 0, boat: 1, coach: 2 }, jackMoveSelection: { type: 'boat', path: [85] },
        publicRound: { start: 33, observations: [], moves: [{ type, startSlot: type === 'coach' ? 6 : 7, endSlot: 7,
          investigatorPositions: { yellow: 'BS', blue: 'HP', red: 'HZ' } }] } }
      expect(floatingTurnSummary(state, 'investigators').text).toBe(`R2 M7 ${letter} 012`)
      expect(floatingTurnSummary({ ...state, discoveryLocations: [], currentJack: null }, 'investigators'))
        .toEqual(floatingTurnSummary(state, 'investigators'))
    })

  test('Jack always sees Street distance from his committed location, independent of the draft move', () => {
    const state = jackState()
    const summary = floatingTurnSummary(state, 'jack')
    expect(summary.text).toBe('R1 M0 222 D2')
    expect(summary.description).toContain('Investigators block crossings for the next Street move only.')
    expect(floatingTurnSummary({ ...state, jackMoveSelection: { type: 'coach', path: [18, 19] } }, 'jack')).toEqual(summary)
  })

  test('setup omits unavailable move and distance fields, while a trapped Jack sees infinity', () => {
    expect(floatingTurnSummary(createInitialGame(), 'jack').text).toBe('R1 M0 222')
    expect(floatingTurnSummary(createInitialGame(), 'investigators').text).toBe('R1 M0 222')
    expect(floatingTurnSummary({ ...jackState(), currentJack: 1, discoveryLocations: [2],
      investigatorPositions: { yellow: 'BB', blue: 'BV', red: 'HP' } }, 'jack').text).toBe('R1 M0 222 D∞')
  })
})
