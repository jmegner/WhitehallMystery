import { describe, expect, test } from 'vitest'
import { createInitialGame, legalInspectorActionCircles } from './gameEngine'
import { automaticInvestigatorActions } from './investigatorAuto'
import { createGameHistory, currentHistoryState } from './history'
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

    const result = automaticInvestigatorActions(createGameHistory(state), () => outcomes)
    const searched = result.commands.flatMap((command) =>
      command.type === 'apply' && command.action.type === 'searchCircle'
        ? [command.action.circleId]
        : [],
    )

    expect(searched).toEqual([firstNewPossible, secondNewPossible, finalPossible])
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
})
