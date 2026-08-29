import { describe, expect, test } from 'vitest'
import { createInitialGame, legalInspectorActionCircles } from './gameEngine'
import { automaticInvestigatorActions } from './investigatorAuto'
import { createGameHistory, currentHistoryState, gameHistoryReducer } from './history'
import { adjacentCirclesForCrossing, crossings } from './mapData'
import type { GameState } from './types'

describe('investigator auto actions', () => {
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
