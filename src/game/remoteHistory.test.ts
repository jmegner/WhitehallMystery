import { describe, expect, it } from 'vitest'
import { createInitialGame, deploymentChoices, legalNormalDestinations } from './gameEngine'
import { createGameHistory, currentHistoryState, gameHistoryReducer, type GameHistory } from './history'
import { normalizeRemoteHistory, onlineBoardState } from './remoteHistory'
import type { GameAction } from './types'

const apply = (history: GameHistory, action: GameAction) => normalizeRemoteHistory(gameHistoryReducer(history, { type: 'apply', action }))
const deployed = () => {
  let history = createGameHistory(createInitialGame())
  for (const circleId of [33, 46, 147, 159]) history = apply(history, { type: 'toggleDiscovery', circleId })
  history = apply(history, { type: 'confirmDiscoveries' })
  for (let i = 0; i < 3; i++) history = apply(history, { type: 'placeInvestigator', crossingId: deploymentChoices(currentHistoryState(history))[0]! })
  return history
}

describe('online board privacy', () => {
  it('hides tentative starts, logs and paths until the first move is committed, including undo/redo', () => {
    const setup = deployed()
    let history = apply(setup, { type: 'chooseJackStart', circleId: 33 })
    const privateHistory = structuredClone(history)
    expect(onlineBoardState(history, 'investigators')).toEqual(onlineBoardState(setup, 'investigators'))
    expect(onlineBoardState(history, 'jack').currentJack).toBe(33)
    expect(history).toEqual(privateHistory)
    history = { ...history, cursor: setup.cursor }
    history = apply(history, { type: 'chooseJackStart', circleId: 46 })
    history = apply(history, { type: 'selectJackDestination', circleId: legalNormalDestinations(currentHistoryState(history))[0]! })
    const beforeMove = history.cursor
    expect(onlineBoardState(history, 'investigators')).toEqual(onlineBoardState(setup, 'investigators'))
    history = apply(history, { type: 'confirmJackMove' })
    expect(onlineBoardState(history, 'investigators').publicRound?.start).toBe(46)
    expect(onlineBoardState(history, 'investigators').publicLog.join(' ')).not.toContain('Discovery Location 33')
    expect(onlineBoardState({ ...history, cursor: beforeMove }, 'investigators')).toEqual(onlineBoardState(setup, 'investigators'))
    expect(onlineBoardState(history, 'investigators').publicRound?.start).toBe(46)
  })

  it('keeps investigator moves and actions live for Jack', () => {
    let history = apply(deployed(), { type: 'chooseJackStart', circleId: 33 })
    history = apply(history, { type: 'selectJackDestination', circleId: legalNormalDestinations(currentHistoryState(history))[0]! })
    history = apply(history, { type: 'confirmJackMove' })
    for (const color of ['yellow', 'blue', 'red'] as const) {
      history = apply(history, { type: 'moveInvestigator', crossingId: currentHistoryState(history).investigatorPositions[color]! })
      expect(onlineBoardState(history, 'jack').publicLog).toEqual(currentHistoryState(history).publicLog)
      expect(onlineBoardState(history, 'jack').investigatorPositions).toEqual(currentHistoryState(history).investigatorPositions)
    }
    history = apply(history, { type: 'passInspectorAction' })
    expect(onlineBoardState(history, 'jack').publicLog).toEqual(currentHistoryState(history).publicLog)
  })
})
