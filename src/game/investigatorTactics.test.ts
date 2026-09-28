import { describe, expect, test } from 'vitest'
import { createInitialGame, legalNormalDestinations } from './gameEngine'
import { createGameHistory, currentHistoryState, gameHistoryReducer } from './history'
import { possibleJackLocations, possibleJackSearchOutcomes, type SearchOutcome } from './inference'
import { automaticInvestigatorActions } from './investigatorAuto'
import { expectedNextPossibilities, investigatorAction } from './aiInvestigators'
import { coveringArrests, possibleLocationsFromOutcomes, preferredArrest, weightedNextPossibilities } from './investigatorTactics'
import { INVESTIGATOR_ORDER, type GameState } from './types'

const beforeMove = { yellow: 'JW', blue: 'CV', red: 'JP' }
function captureState(currentJack = 61): GameState {
  return {
    ...createInitialGame(), stage: 'investigatorAction', inspectorActionMode: 'search',
    currentJack, roundTrail: [63, currentJack], round: 2, moveSlot: 1,
    discoveryLocations: [54, 63, 147, 159], reachedDiscoveries: [54, 63],
    investigatorPositions: { yellow: 'JX', blue: 'CR', red: 'JZ' },
    publicRound: { start: 63, observations: [], moves: [{
      type: 'normal', startSlot: 1, endSlot: 1, investigatorPositions: beforeMove,
    }] },
  }
}

function clueState(): GameState {
  const positions = { yellow: 'CF', blue: 'DC', red: 'HZ' }
  return {
    ...createInitialGame(), stage: 'investigatorAction', inspectorActionMode: 'search', activeInvestigator: 1,
    currentJack: 36, roundTrail: [54, 36, 54, 36], moveSlot: 3,
    discoveryLocations: [54, 46, 147, 159], reachedDiscoveries: [54], clueLocations: [36],
    investigatorPositions: { ...positions, blue: 'DD' },
    publicRound: { start: 54, moves: [1, 2, 3].map(slot => ({
      type: 'normal', startSlot: slot, endSlot: slot, investigatorPositions: positions,
    })), observations: [{ kind: 'clue', circleId: 36, found: true, afterMove: 1, investigator: 'yellow' }] },
  }
}

function searchState(): GameState {
  const positions = { yellow: 'FP', blue: 'HP', red: 'HZ' }
  return {
    ...createInitialGame(), stage: 'investigatorAction', inspectorActionMode: 'search', activeInvestigator: 2,
    currentJack: 75, roundTrail: [33, 34, 54, 72, 73, 74, 75], moveSlot: 6,
    discoveryLocations: [33, 46, 147, 159], reachedDiscoveries: [33],
    investigatorPositions: { ...positions, red: 'CQ' },
    publicRound: { start: 33, observations: [], moves: [1, 2, 3, 4, 5, 6].map(slot => ({
      type: 'normal', startSlot: slot, endSlot: slot, investigatorPositions: positions,
    })) },
  }
}

describe('shared investigator tactics', () => {
  test('derives the complete exact current possibilities from search outcomes', () => {
    for (const state of [captureState(), clueState(), searchState()]) {
      expect(possibleLocationsFromOutcomes(possibleJackSearchOutcomes(state.publicRound)))
        .toEqual(possibleJackLocations(state.publicRound))
    }
  })

  test('full AI arrests the sole known-clue target without depending on Jack secrets', () => {
    const state = clueState()
    expect(possibleJackLocations(state.publicRound).size).toBe(20)
    const expected = [{ type: 'setInspectorActionMode', mode: 'arrest' }, { type: 'arrestCircle', circleId: 36 }]
    expect(investigatorAction(state)).toEqual(expected)
    expect(investigatorAction({ ...state, currentJack: null, roundTrail: [], discoveryLocations: [] } as GameState)).toEqual(expected)
    expect(investigatorAction({ ...state, checkedThisAction: [37] })).toEqual([{ type: 'passInspectorAction' }])
    state.publicRound!.observations.push({ kind: 'arrest', circleId: 36, hit: false, afterMove: 3, investigator: 'yellow' })
    expect(investigatorAction(state)).toEqual([{ type: 'passInspectorAction' }])
  })

  test('movement scoring values a known-clue arrest without mistaking its guaranteed yes for a guaranteed capture', () => {
    const possible = new Set([36, 72, 73, 54])
    const outcomes = new Map<number, SearchOutcome>([[36, { ifNo: new Set(), ifYes: possible, positiveMeansJackIsThereNow: false }]])
    const expected = 3 / 4 * weightedNextPossibilities(new Set([72, 73, 54]), {})
    const score = expectedNextPossibilities(possible, {}, [[36]], outcomes)
    expect(score).toBeCloseTo(expected)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(expectedNextPossibilities(possible, {}, [], outcomes))
    // A second piece must not get credit for repeating the first piece's miss.
    expect(expectedNextPossibilities(possible, {}, [[36], [36]], outcomes)).toBeCloseTo(expected)
  })

  test('chooses a useful arrest when all adjacent searches are already resolved', () => {
    const possible = new Set([36, 72, 73])
    const outcomes = new Map<number, SearchOutcome>([36, 72].map(id => [id,
      { ifNo: new Set(), ifYes: possible, positiveMeansJackIsThereNow: false },
    ]))
    expect(preferredArrest({ searches: [], arrests: [72, 36] }, outcomes, possible, {})).toBe(36)
  })

  test.each([46, 62, 61])('InvAuto guarantees capture of %i by assigning distinct investigators', currentJack => {
    const state = captureState(currentJack)
    const possible = possibleJackLocations(state.publicRound)
    expect(possible).toEqual(new Set([46, 62, 61]))
    // Yellow can reach 46/62, Blue only 46, and Red 61/62: a greedy first
    // assignment of Yellow to 46 would strand a target. Matching avoids that.
    expect(coveringArrests(possible, state.investigatorPositions)).toEqual({ yellow: 62, blue: 46, red: 61 })
    const result = automaticInvestigatorActions(createGameHistory(state))
    expect(currentHistoryState(result.next).result?.winner).toBe('investigators')
    const arrests = result.next.entries.flatMap((entry, index) => entry.action?.type === 'arrestCircle'
      ? [{ color: INVESTIGATOR_ORDER[result.next.entries[index - 1]!.state.activeInvestigator], id: entry.action.circleId }] : [])
    const expected = [{ color: 'yellow', id: 62 }, { color: 'blue', id: 46 }, { color: 'red', id: 61 }]
    expect(arrests).toEqual(expected.slice(0, expected.findIndex(attempt => attempt.id === currentJack) + 1))
    expect(result.commands.some(command => command.type === 'apply' && command.action.type === 'searchCircle')).toBe(false)
  })

  test('ends an already-started search when the other two investigators can guarantee capture', () => {
    const state = captureState()
    state.investigatorPositions = { yellow: 'JZ', blue: 'JX', red: 'KD' }
    const searching = gameHistoryReducer(createGameHistory(state), { type: 'apply', action: { type: 'searchCircle', circleId: 62 } })
    expect(currentHistoryState(searching).checkedThisAction).toEqual([62])
    const result = automaticInvestigatorActions(searching)
    expect(result.commands[0]).toEqual({ type: 'apply', action: { type: 'passInspectorAction' } })
    expect(currentHistoryState(result.next).publicLog).toContain('M1: blue attempted an arrest at 46: missed.')
    expect(currentHistoryState(result.next).publicLog).toContain('M1: red arrested Jack at 61.')
    expect(currentHistoryState(result.next).result?.winner).toBe('investigators')
  })

  test('does not count investigators whose actions are already spent toward a guaranteed capture', () => {
    const state = captureState()
    state.activeInvestigator = 2
    state.investigatorPositions = { yellow: 'CR', blue: 'KD', red: 'JZ' }
    state.publicRound!.observations.push({ kind: 'arrest', circleId: 46, hit: false, afterMove: 1, investigator: 'yellow' })
    expect(possibleJackLocations(state.publicRound)).toEqual(new Set([62, 61]))
    expect(automaticInvestigatorActions(createGameHistory(state)).commands).toEqual([])
  })

  test('re-ranks nontrivial yes counts after each automatic negative search', () => {
    const state = searchState()
    // Keep this public-evidence fixture tied to a real legal Street trail.
    for (let index = 1; index < state.roundTrail.length; index += 1) {
      expect(legalNormalDestinations({ ...state, currentJack: state.roundTrail[index - 1]!,
        investigatorPositions: state.publicRound!.moves[index - 1]!.investigatorPositions })).toContain(state.roundTrail[index])
    }
    const searching = gameHistoryReducer(createGameHistory(state), { type: 'apply', action: { type: 'searchCircle', circleId: 44 } })
    const initial = possibleJackSearchOutcomes(currentHistoryState(searching).publicRound)
    expect([43, 42, 59].map(id => initial.get(id)!.ifYes.size)).toEqual([35, 60, 65])
    const result = automaticInvestigatorActions(searching)
    const searches = result.next.entries.filter(entry => entry.action?.type === 'searchCircle')
    expect(searches.map(entry => entry.action)).toEqual([44, 43, 59, 42].map(circleId => ({ type: 'searchCircle', circleId })))
    const after43 = possibleJackSearchOutcomes(searches[1]!.state.publicRound)
    expect([42, 59].map(id => after43.get(id)!.ifYes.size)).toEqual([59, 58])
    expect(currentHistoryState(result.next).stage).toBe('investigatorTurnResult')
  })

  test('stops the automatic search sequence immediately when a clue is found', () => {
    const state = { ...searchState(), currentJack: 43, roundTrail: [33, 37, 41, 24, 46, 62, 43] }
    const searching = gameHistoryReducer(createGameHistory(state), { type: 'apply', action: { type: 'searchCircle', circleId: 44 } })
    const result = automaticInvestigatorActions(searching)
    expect(result.commands).toEqual([{ type: 'apply', action: { type: 'searchCircle', circleId: 43 } }])
    expect(currentHistoryState(result.next).clueLocations).toContain(43)
    expect(currentHistoryState(result.next).stage).toBe('investigatorTurnResult')
  })
})
