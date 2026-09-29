import { describe, expect, test } from 'vitest'
import { createInitialGame, legalInspectorActionCircles } from './gameEngine'
import { automaticInvestigatorActions } from './investigatorAuto'
import { createGameHistory, currentHistoryState, gameHistoryReducer } from './history'
import { adjacentCirclesForCrossing, crossings } from './mapData'
import { possibleJackSearchOutcomes } from './inference'
import type { GameState } from './types'

function knownClueState(moveSlot = 3): GameState {
  const positions = { yellow: 'CF', blue: 'DC', red: 'HZ' }
  const trail = [54, 36, 54, 36].slice(0, moveSlot + 1)
  return {
    ...createInitialGame(), stage: 'investigatorAction', activeInvestigator: 1,
    moveSlot, currentJack: trail.at(-1)!, roundTrail: trail,
    discoveryLocations: [54, 46, 147, 159], reachedDiscoveries: [54], clueLocations: [36],
    inspectorActionMode: 'search', investigatorPositions: { ...positions, blue: 'DD' },
    publicRound: {
      start: 54,
      moves: Array.from({ length: moveSlot }, (_, index) => ({
        type: 'normal', startSlot: index + 1, endSlot: index + 1, investigatorPositions: positions,
      })),
      observations: [{ kind: 'clue', circleId: 36, found: true, afterMove: 1, investigator: 'yellow' }],
    },
  }
}

describe('investigator auto actions', () => {
  test.each([1, 2])('ends only the active search with InvAuto off when investigator %i has one known clue left', activeInvestigator => {
    const state = { ...knownClueState(), activeInvestigator,
      investigatorPositions: { yellow: 'DB', blue: 'CF', red: activeInvestigator === 2 ? 'CF' : 'HZ' } }
    if (activeInvestigator === 2) state.investigatorPositions.blue = 'DD'
    let history = createGameHistory(state)
    const noInference = () => { throw new Error('InvAuto off should not run tactical inference') }
    for (const circleId of [37, 56]) {
      history = gameHistoryReducer(history, { type: 'apply', action: { type: 'searchCircle', circleId } })
      if (circleId === 37) expect(automaticInvestigatorActions(history, noInference, false).commands).toEqual([])
    }
    const result = automaticInvestigatorActions(history, noInference, false)
    expect(result.commands).toEqual([{ type: 'apply', action: { type: 'passInspectorAction' } }])
    const next = currentHistoryState(result.next)
    expect(next.stage).toBe(activeInvestigator === 2 ? 'investigatorTurnResult' : 'investigatorAction')
    expect(next.activeInvestigator).toBe(2)
    expect(next.checkedThisAction).toEqual([])
    expect(next.publicLog.at(-1)).toBe(`M3: ${activeInvestigator === 2 ? 'red' : 'blue'} ended the clue search.`)
    expect(next.publicRound?.observations).toEqual(currentHistoryState(history).publicRound?.observations)
    const undone = gameHistoryReducer(result.next, { type: 'undo' })
    expect(currentHistoryState(undone)).toEqual(currentHistoryState(history))
    expect(currentHistoryState(gameHistoryReducer(undone, { type: 'redo' }))).toEqual(next)
  })

  test('InvAuto off preserves the arrest choice before searching and a final unknown search afterward', () => {
    const initial = createGameHistory(knownClueState())
    expect(automaticInvestigatorActions(initial, undefined, false).commands).toEqual([])
    const state = { ...knownClueState(), clueLocations: [], checkedThisAction: [37, 56],
      investigatorPositions: { yellow: 'DB', blue: 'CF', red: 'HZ' } }
    expect(automaticInvestigatorActions(createGameHistory(state), undefined, false).commands).toEqual([])
  })

  test.each([1, 3])('arrests on a known clue when it is the only useful target after move %i', moveSlot => {
    const state = knownClueState(moveSlot)
    const outcome = possibleJackSearchOutcomes(state.publicRound).get(36)!
    expect(legalInspectorActionCircles(state)).toEqual([36])
    expect(outcome.ifNo.size).toBe(0)
    expect(outcome.ifYes.has(36)).toBe(true)
    if (moveSlot === 3) {
      expect(outcome.ifYes.size).toBeGreaterThan(3)
      expect(outcome.positiveMeansJackIsThereNow).toBe(false)
    }

    const result = automaticInvestigatorActions(createGameHistory(state))
    expect(result.commands).toEqual([
      { type: 'apply', action: { type: 'setInspectorActionMode', mode: 'arrest' } },
      { type: 'apply', action: { type: 'arrestCircle', circleId: 36 } },
    ])
    expect(currentHistoryState(result.next).result?.winner).toBe('investigators')
  })

  test.each([33, null])('uses public evidence for the arrest when the private position is %s', currentJack => {
    const state = { ...knownClueState(), currentJack, roundTrail: currentJack === null ? [] : [54, 36, 54, currentJack] }
    const result = automaticInvestigatorActions(createGameHistory(state))
    expect(result.commands.slice(0, 2)).toEqual([
      { type: 'apply', action: { type: 'setInspectorActionMode', mode: 'arrest' } },
      { type: 'apply', action: { type: 'arrestCircle', circleId: 36 } },
    ])
    expect(currentHistoryState(result.next).publicRound?.observations).toContainEqual({
      kind: 'arrest', circleId: 36, hit: false, afterMove: 3, investigator: 'blue',
    })
  })

  test('passes when a known clue cannot contain Jack now, including after another investigator misses', () => {
    for (const state of [knownClueState(2), knownClueState()]) {
      if (state.moveSlot === 3) {
        state.currentJack = 33
        state.roundTrail = [54, 36, 54, 33]
        state.publicRound!.observations.push({ kind: 'arrest', circleId: 36, hit: false, afterMove: 3, investigator: 'yellow' })
      }
      const outcome = possibleJackSearchOutcomes(state.publicRound).get(36)!
      expect(outcome.ifYes.size).toBeGreaterThan(0)
      expect(outcome.ifYes.has(36)).toBe(false)
      const result = automaticInvestigatorActions(createGameHistory(state))
      expect(result.commands[0]).toEqual({ type: 'apply', action: { type: 'passInspectorAction' } })
      expect(result.commands.some(command => command.type === 'apply' && command.action.type === 'arrestCircle')).toBe(false)
    }
  })

  test('leaves the choice to the player when a known-clue arrest competes with another fruitful location', () => {
    const state = knownClueState()
    state.investigatorPositions = { yellow: 'DB', blue: 'CF', red: 'HZ' }
    const outcomes = possibleJackSearchOutcomes(state.publicRound)
    expect(legalInspectorActionCircles(state)).toEqual([36, 37, 56])
    expect(outcomes.get(56)?.positiveMeansJackIsThereNow).toBe(true)
    expect(automaticInvestigatorActions(createGameHistory(state)).commands).toEqual([])
  })

  test('does not switch to arrest after the investigator has started searching', () => {
    const state = knownClueState()
    state.investigatorPositions = { yellow: 'DB', blue: 'CF', red: 'HZ' }
    let history = createGameHistory(state)
    for (const circleId of [37, 56]) {
      history = gameHistoryReducer(history, { type: 'apply', action: { type: 'searchCircle', circleId } })
    }
    expect(currentHistoryState(history).checkedThisAction).toEqual([37, 56])
    const result = automaticInvestigatorActions(history)
    expect(result.commands[0]).toEqual({ type: 'apply', action: { type: 'passInspectorAction' } })
    expect(result.commands.some(command => command.type === 'apply' && command.action.type === 'arrestCircle')).toBe(false)
  })

  test('still arrests a sole current-or-never location without an existing clue', () => {
    const state = knownClueState(1)
    state.clueLocations = []
    state.publicRound!.observations = []
    const result = automaticInvestigatorActions(createGameHistory(state))
    expect(result.commands[1]).toEqual({ type: 'apply', action: { type: 'arrestCircle', circleId: 36 } })
  })

  test('can arrest on the revealed starting discovery after Jack returns there', () => {
    const positions = { yellow: 'FP', blue: 'FW', red: 'HZ' }
    const state: GameState = {
      ...createInitialGame(), stage: 'investigatorAction', activeInvestigator: 1, moveSlot: 2,
      currentJack: 120, roundTrail: [120, 119, 120],
      discoveryLocations: [54, 46, 120, 159], reachedDiscoveries: [120],
      investigatorPositions: { ...positions, blue: 'FX' }, inspectorActionMode: 'search',
      publicRound: { start: 120, observations: [], moves: [1, 2].map(slot => ({
        type: 'normal', startSlot: slot, endSlot: slot, investigatorPositions: positions,
      })) },
    }
    expect(possibleJackSearchOutcomes(state.publicRound).get(120)?.ifYes.has(120)).toBe(true)
    const result = automaticInvestigatorActions(createGameHistory(state))
    expect(result.commands[1]).toEqual({ type: 'apply', action: { type: 'arrestCircle', circleId: 120 } })
    expect(currentHistoryState(result.next).result?.winner).toBe('investigators')
  })

  test('chains new-possible searches before the previously automatic final search', () => {
    const crossing = crossings.find(
      ({ id }) => adjacentCirclesForCrossing(id).length >= 4 && !adjacentCirclesForCrossing(id).includes(33),
    )
    expect(crossing).toBeDefined()

    const state: GameState = {
      ...createInitialGame(),
      stage: 'investigatorAction',
      activeInvestigator: 2,
      currentJack: 33,
      roundTrail: [33],
      publicRound: { start: 33, moves: [], observations: [] },
      investigatorPositions: { red: crossing!.id },
      inspectorActionMode: 'search',
    }
    const adjacent = legalInspectorActionCircles(state)
    const [alreadySearched, firstNewPossible, secondNewPossible, finalPossible] = adjacent
    state.checkedThisAction = [alreadySearched!]

    const outcomes = new Map(
      [firstNewPossible, secondNewPossible, finalPossible].map((circleId, index) => [
        circleId!,
        {
          ifNo: new Set([33]),
          ifYes: new Set([circleId!]),
          positiveMeansJackIsThereNow: index < 2,
        },
      ]),
    )

    const observationCounts: number[] = []
    const result = automaticInvestigatorActions(createGameHistory(state), (evidence) => {
      observationCounts.push(evidence?.observations.length ?? 0)
      return outcomes
    })
    const searched = result.commands.flatMap((command) =>
      command.type === 'apply' && command.action.type === 'searchCircle'
        ? [command.action.circleId]
        : [],
    )

    expect(searched).toEqual([firstNewPossible, secondNewPossible, finalPossible])
    expect(observationCounts).toEqual(observationCounts.map((_, index) => index))
    expect(observationCounts.length).toBeGreaterThanOrEqual(3)
    expect(currentHistoryState(result.next).stage).toBe('investigatorTurnResult')
  })

  test('does not auto-search new-possible locations before the first search', () => {
    const crossing = crossings.find(({ id }) => adjacentCirclesForCrossing(id).length >= 2)!
    const state: GameState = {
      ...createInitialGame(),
      stage: 'investigatorAction',
      activeInvestigator: 0,
      investigatorPositions: { yellow: crossing.id },
      inspectorActionMode: 'search',
    }
    const adjacent = legalInspectorActionCircles(state)
    const outcomes = new Map(
      adjacent.slice(0, 2).map((circleId) => [
        circleId,
        {
          ifNo: new Set<number>(),
          ifYes: new Set([circleId]),
          positiveMeansJackIsThereNow: true,
        },
      ]),
    )

    const result = automaticInvestigatorActions(createGameHistory(state), () => outcomes)

    expect(result.commands).toEqual([])
  })

  test('skips clues and the latest revealed discovery, then ends an existing search', () => {
    const crossing = crossings.find(
      ({ id }) => adjacentCirclesForCrossing(id).length >= 4 && !adjacentCirclesForCrossing(id).includes(33),
    )!
    const state: GameState = {
      ...createInitialGame(),
      stage: 'investigatorAction',
      activeInvestigator: 2,
      currentJack: 33,
      roundTrail: [33],
      publicRound: { start: 33, moves: [], observations: [] },
      investigatorPositions: { red: crossing.id },
      inspectorActionMode: 'search',
    }
    const [alreadySearched, knownClue, latestDiscovery, remainingPossible] =
      legalInspectorActionCircles(state)
    state.checkedThisAction = [alreadySearched!]
    state.clueLocations = [knownClue!]
    state.reachedDiscoveries = [99, latestDiscovery!]
    const outcomes = new Map(
      [knownClue, latestDiscovery, remainingPossible].map((circleId) => [
        circleId!,
        {
          ifNo: new Set([33]),
          ifYes: new Set([circleId!]),
          positiveMeansJackIsThereNow: false,
        },
      ]),
    )

    const result = automaticInvestigatorActions(createGameHistory(state), () => outcomes)
    const actions = result.commands.flatMap((command) => command.type === 'apply' ? [command.action] : [])

    expect(actions).toEqual([
      { type: 'searchCircle', circleId: remainingPossible },
      { type: 'passInspectorAction' },
    ])
    expect(currentHistoryState(result.next).stage).toBe('investigatorTurnResult')
  })

  test('passes the next investigator after a clue proves Jack is elsewhere', () => {
    const blueCrossing = crossings.find(
      ({ id }) => adjacentCirclesForCrossing(id).some((circleId) => circleId !== 33),
    )!
    const target = adjacentCirclesForCrossing(blueCrossing.id).find((circleId) => circleId !== 33)!
    const redCrossing = crossings.find(
      ({ id }) =>
        id !== blueCrossing.id &&
        adjacentCirclesForCrossing(id).length >= 2 &&
        !adjacentCirclesForCrossing(id).includes(target),
    )!
    const state: GameState = {
      ...createInitialGame(),
      stage: 'investigatorAction',
      activeInvestigator: 1,
      currentJack: target,
      roundTrail: [33, target],
      publicRound: { start: 33, moves: [], observations: [] },
      investigatorPositions: { blue: blueCrossing.id, red: redCrossing.id },
      inspectorActionMode: 'search',
    }
    const afterBlueClue = gameHistoryReducer(createGameHistory(state), {
      type: 'apply',
      action: { type: 'searchCircle', circleId: target },
    })
    expect(currentHistoryState(afterBlueClue).activeInvestigator).toBe(2)

    const noLongerSearchableAroundRed = legalInspectorActionCircles(currentHistoryState(afterBlueClue))
    const outcomes = new Map([
      [
        target,
        {
          ifNo: new Set<number>(),
          ifYes: new Set([target]),
          positiveMeansJackIsThereNow: true,
        },
      ],
    ])
    const result = automaticInvestigatorActions(afterBlueClue, () => outcomes)
    const actions = result.commands.flatMap((command) => command.type === 'apply' ? [command.action] : [])

    expect(noLongerSearchableAroundRed.length).toBeGreaterThan(1)
    expect(noLongerSearchableAroundRed.every((circleId) => !outcomes.has(circleId))).toBe(true)
    expect(actions).toEqual([{ type: 'passInspectorAction' }])
    expect(currentHistoryState(result.next).stage).toBe('investigatorTurnResult')
  })
})
