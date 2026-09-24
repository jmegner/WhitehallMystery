import { describe, expect, it } from 'vitest'
import { createInitialGame, deploymentChoices, legalInspectorActionCircles, legalNormalDestinations, legalJackDestinations } from './gameEngine'
import { createGameHistory, currentHistoryState, gameHistoryReducer, playerViewForState, type GameHistory, type HistoryCommand } from './history'
import { normalizeRemoteHistory, onlineBoardState, onlineHistoryReducer, onlineInvestigatorActionCount } from './remoteHistory'
import { onlineHistoryFromWire, onlineHistoryToWire, onlineTurnStart } from './onlineProtocol'
import { automaticInvestigatorActions } from './investigatorAuto'
import { undoIncludesSecretInfo } from './undoWarning'
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
  it('exposes only public locations during setup and on the investigator turn, without changing the verified history', () => {
    let history = createGameHistory(createInitialGame())
    const empty = onlineBoardState(history, 'investigators')
    for (const circleId of [33, 46, 147, 159]) history = apply(history, { type: 'toggleDiscovery', circleId })
    expect(onlineBoardState(history, 'investigators')).toEqual(empty)
    expect(onlineInvestigatorActionCount(history)).toBe(0)
    history = apply(deployed(), { type: 'chooseJackStart', circleId: 33 })
    history = apply(history, { type: 'selectJackDestination', circleId: legalNormalDestinations(currentHistoryState(history))[0]! })
    history = apply(history, { type: 'confirmJackMove' })
    const before = structuredClone(history)
    const board = onlineBoardState(history, 'investigators')
    expect(board).toMatchObject({ currentJack: null, roundTrail: [], discoveryLocations: [33], reachedDiscoveries: [33], jackMoveSelection: { type: 'normal', path: [] } })
    expect(board.publicRound).toEqual(currentHistoryState(history).publicRound)
    expect(history).toEqual(before)
    expect(onlineHistoryFromWire(onlineHistoryToWire(history))).toEqual(history)
    expect(onlineInvestigatorActionCount(history)).toBe(5) // Lock discoveries, 3 deployments, 1 recorded move.
  })

  it.each(['normal', 'coach', 'alley', 'boat'] as const)('hides draft %s moves, their outline inputs and action counts after the first turn, including undo/redo', moveType => {
    let history = apply(deployed(), { type: 'chooseJackStart', circleId: moveType === 'alley' ? 33 : 159 })
    const start = currentHistoryState(history)
    const firstDestination = legalNormalDestinations(start).find(id => !start.discoveryLocations.includes(id) &&
      legalJackDestinations({ ...start, currentJack: id, moveSlot: 1, jackMoveSelection: { type: moveType, path: [] } }).length > 0)
    expect(firstDestination).toBeDefined()
    history = apply(history, { type: 'selectJackDestination', circleId: firstDestination! })
    history = apply(history, { type: 'confirmJackMove' })
    for (const color of ['yellow', 'blue', 'red'] as const) {
      history = apply(history, { type: 'moveInvestigator', crossingId: currentHistoryState(history).investigatorPositions[color]! })
    }
    for (let i = 0; i < 3; i++) history = apply(history, { type: 'passInspectorAction' })
    expect(currentHistoryState(history).stage).toBe('jackMove')
    const beforePlanning = history.cursor
    const publicBoard = onlineBoardState(history, 'investigators')
    const publicCount = onlineInvestigatorActionCount(history)
    history = apply(history, { type: 'setJackMoveType', moveType })
    const steps = moveType === 'coach' ? 2 : 1
    for (let i = 0; i < steps; i++) {
      const destination = legalJackDestinations(currentHistoryState(history))[0]
      expect(destination).toBeDefined()
      history = apply(history, { type: 'selectJackDestination', circleId: destination! })
      expect(currentHistoryState(history).jackMoveSelection.path).toHaveLength(i + 1)
      expect(onlineBoardState(history, 'investigators')).toEqual(publicBoard)
      expect(onlineInvestigatorActionCount(history)).toBe(publicCount)
    }
    const draft = structuredClone(history)
    expect(onlineBoardState(history, 'jack').jackMoveSelection).toEqual(currentHistoryState(history).jackMoveSelection)
    expect(onlineBoardState({ ...history, cursor: beforePlanning }, 'investigators')).toEqual(publicBoard)
    expect(onlineBoardState(history, 'investigators')).toEqual(publicBoard)
    expect(history).toEqual(draft)
    history = apply(history, { type: 'confirmJackMove' })
    const published = onlineBoardState(history, 'investigators')
    expect(published.currentJack).toBeNull()
    expect(published.roundTrail).toEqual([])
    expect(published.jackMoveSelection).toEqual({ type: 'normal', path: [] })
    expect(published.publicRound?.moves.at(-1)?.type).toBe(moveType)
    expect(onlineInvestigatorActionCount(history)).toBe(publicCount + 1)
  })

  it('retains the intended full reveal after the game ends', () => {
    const state = { ...currentHistoryState(deployed()), stage: 'gameOver' as const, result: { winner: 'jack' as const, reason: 'Jack escaped.' } }
    expect(onlineBoardState(createGameHistory(state), 'investigators')).toBe(state)
  })

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

const onlineCommand = (history: GameHistory, command: HistoryCommand) => {
  const role = playerViewForState(currentHistoryState(history))!
  return onlineHistoryReducer(history, command, role, onlineTurnStart(history, role))
}
const onlineApply = (history: GameHistory, action: GameAction) => onlineCommand(history, { type: 'apply', action })
const onlineDeployment = () => {
  let history = createGameHistory(createInitialGame())
  for (const circleId of [33, 46, 147, 159]) history = onlineApply(history, { type: 'toggleDiscovery', circleId })
  history = onlineApply(history, { type: 'confirmDiscoveries' })
  for (let i = 0; i < 3; i++) history = onlineApply(history, { type: 'placeInvestigator', crossingId: deploymentChoices(currentHistoryState(history))[0]!, review: false })
  return history
}

describe('online investigator review', () => {
  it('requires confirmation even when deployment omits review, survives replay, and stops redo at review', () => {
    const review = onlineDeployment()
    expect(currentHistoryState(review).stage).toBe('investigatorSetupResult')
    expect(playerViewForState(currentHistoryState(review))).toBe('investigators')
    expect(onlineHistoryFromWire(onlineHistoryToWire(review))).toEqual(review)
    const finished = onlineApply(review, { type: 'continueHandoff' })
    expect(currentHistoryState(finished).stage).toBe('jackChooseStart')
    const rewound = { ...finished, cursor: review.cursor - 1 }
    const redone = onlineCommand(rewound, { type: 'redoAll' })
    expect(currentHistoryState(redone).stage).toBe('investigatorSetupResult')
    expect(onlineCommand(redone, { type: 'redo' })).toEqual(redone)
    expect(onlineApply(redone, { type: 'continueHandoff' })).toEqual(finished)
    expect(currentHistoryState(normalizeRemoteHistory(review)).stage).toBe('jackChooseStart') // Mail behavior is unchanged.
  })

  it('retains automatic end-of-turn results until confirmation, including after undo/redo', () => {
    let history = onlineApply(onlineDeployment(), { type: 'continueHandoff' })
    history = onlineApply(history, { type: 'chooseJackStart', circleId: 33 })
    history = onlineApply(history, { type: 'selectJackDestination', circleId: legalNormalDestinations(currentHistoryState(history))[0]! })
    history = onlineApply(history, { type: 'confirmJackMove' })
    for (const color of ['yellow', 'blue', 'red'] as const) {
      history = onlineApply(history, { type: 'moveInvestigator', crossingId: currentHistoryState(history).investigatorPositions[color]! })
    }
    const automatic = automaticInvestigatorActions(history, () => new Map())
    expect(automatic.commands.length).toBe(3)
    for (const command of automatic.commands) history = onlineCommand(history, command)
    expect(currentHistoryState(history).stage).toBe('investigatorTurnResult')
    const finished = onlineApply(history, { type: 'continueHandoff' })
    expect(currentHistoryState(finished).stage).toBe('jackMove')
    const redone = onlineCommand({ ...finished, cursor: history.cursor - 1 }, { type: 'redoAll' })
    expect(currentHistoryState(redone).stage).toBe('investigatorTurnResult')
    expect(onlineHistoryFromWire(onlineHistoryToWire(redone))).toEqual(redone)
  })

  it('keeps older, already-completed deployment histories replayable', () => {
    const old = deployed()
    expect(currentHistoryState(old).stage).toBe('jackChooseStart')
    expect(onlineHistoryFromWire(onlineHistoryToWire(old))).toEqual(old)
    const finalPlacement = old.entries.findIndex(entry => entry.action?.type === 'placeInvestigator' && entry.state.stage === 'handoffJackStart')
    const redone = onlineCommand({ ...old, cursor: finalPlacement - 1 }, { type: 'redoAll' })
    expect(currentHistoryState(redone).stage).toBe('investigatorSetupResult')
    expect(onlineHistoryFromWire(onlineHistoryToWire(redone))).toEqual(redone)
  })
})

describe('secret-information undo warning', () => {
  it.each(['searchCircle', 'arrestCircle'] as const)('detects %s in an undo range, but not in the redo tail', type => {
    const state = { ...createInitialGame(), stage: 'investigatorAction' as const, inspectorActionMode: type === 'searchCircle' ? 'search' as const : 'arrest' as const,
      investigatorPositions: { yellow: 'BB' }, currentJack: 159, roundTrail: [159], publicRound: { start: 159, moves: [], observations: [] } }
    const before = createGameHistory(state)
    // Use a legal adjacent circle rather than relying on a particular map layout.
    const history = gameHistoryReducer(before, { type: 'apply', action: { type, circleId: legalInspectorActionCircles(state)[0]! } })
    expect(history.cursor).toBe(1)
    expect(undoIncludesSecretInfo(history, 0)).toBe(true)
    expect(undoIncludesSecretInfo(history, history.cursor)).toBe(false)
    expect(undoIncludesSecretInfo({ ...history, cursor: 0 }, 0)).toBe(false)
    expect(undoIncludesSecretInfo(onlineDeployment(), 0)).toBe(false)
  })
})
