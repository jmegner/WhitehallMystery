import { describe, expect, test } from 'vitest'
import { aiHistoryReducer, needsAiEndConfirmation, needsAiTurn, resumeAiHistory } from './aiSession'
import { createInitialGame, legalNormalDestinations } from './gameEngine'
import { createGameHistory, currentHistoryState, gameHistoryReducer, type GameHistory, type PlayerView } from './history'
import { normalizeRemoteHistory } from './remoteHistory'
import { INVESTIGATOR_ORDER, type GameAction, type GameState } from './types'

function roundHistory(): GameHistory {
  let history = createGameHistory({ ...createInitialGame(), stage: 'jackMove', currentJack: 33,
    discoveryLocations: [33, 46, 147, 159], reachedDiscoveries: [33], roundTrail: [33],
    investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' },
    publicRound: { start: 33, moves: [], observations: [] },
  })
  const apply = (action: GameAction) => { history = normalizeRemoteHistory(gameHistoryReducer(history, { type: 'apply', action })) }
  apply({ type: 'selectJackDestination', circleId: legalNormalDestinations(currentHistoryState(history))[0]! })
  apply({ type: 'confirmJackMove' })
  for (const color of INVESTIGATOR_ORDER) apply({ type: 'moveInvestigator', crossingId: currentHistoryState(history).investigatorPositions[color]! })
  for (let index = 0; index < INVESTIGATOR_ORDER.length; index += 1) apply({ type: 'passInspectorAction' })
  expect(currentHistoryState(history).stage).toBe('jackMove')
  return history
}

describe('Versus AI history', () => {
  test.each<{
    name: string; role: PlayerView; state: GameState; action: GameAction; reviewStage: GameState['stage']; aiStage: GameState['stage']
  }>([
    {
      name: 'Jack discovery choices', role: 'jack',
      state: { ...createInitialGame(), discoveryLocations: [33, 46, 147, 159] },
      action: { type: 'confirmDiscoveries' }, reviewStage: 'handoffInspectorsSetup', aiStage: 'investigatorSetup',
    },
    {
      name: 'Jack movement', role: 'jack', state: roundHistory().entries[1]!.state,
      action: { type: 'confirmJackMove' }, reviewStage: 'handoffInspectorsTurn', aiStage: 'investigatorMove',
    },
    {
      name: 'investigator deployment', role: 'investigators',
      state: { ...createInitialGame(), stage: 'investigatorSetup', activeInvestigator: 2, investigatorPositions: { yellow: 'FP', blue: 'HP' } },
      action: { type: 'placeInvestigator', crossingId: 'HZ' }, reviewStage: 'investigatorSetupResult', aiStage: 'jackChooseStart',
    },
    {
      name: 'investigator actions', role: 'investigators',
      state: { ...roundHistory().entries[0]!.state, stage: 'investigatorAction', activeInvestigator: 2 },
      action: { type: 'passInspectorAction' }, reviewStage: 'investigatorTurnResult', aiStage: 'jackMove',
    },
  ])('WaitEnd holds $name until confirmation and preserves the review through undo/redo', ({ role, state, action, reviewStage, aiStage }) => {
    const initial = createGameHistory(state)
    const review = aiHistoryReducer(initial, { type: 'apply', action }, role, true)
    expect(currentHistoryState(review).stage).toBe(reviewStage)
    expect(needsAiEndConfirmation(review, role)).toBe(true)
    expect(needsAiTurn(review, role)).toBe(false)
    const undone = aiHistoryReducer(review, { type: 'undo' }, role, true)
    expect(undone.cursor).toBe(0)
    expect(aiHistoryReducer(undone, { type: 'redo' }, role, true)).toEqual(review)
    const confirmed = aiHistoryReducer(review, { type: 'apply', action: { type: 'continueHandoff' } }, role, true)
    expect(currentHistoryState(confirmed).stage).toBe(aiStage)
    expect(needsAiTurn(confirmed, role)).toBe(true)
    expect(needsAiEndConfirmation(confirmed, role)).toBe(false)
    expect(currentHistoryState(aiHistoryReducer(confirmed, { type: 'undo' }, role, true)).stage).toBe(reviewStage)
    expect(aiHistoryReducer(confirmed, { type: 'bigUndo' }, role, true).cursor).toBe(0)
    const automatic = aiHistoryReducer(initial, { type: 'apply', action }, role)
    expect(currentHistoryState(automatic).stage).toBe(aiStage)
  })

  test('WaitEnd keeps discovery reveals and the next round behind investigator confirmation', () => {
    const initial = createGameHistory({ ...roundHistory().entries[0]!.state,
      stage: 'investigatorAction', activeInvestigator: 2, currentJack: 46, roundTrail: [33, 46], moveSlot: 7,
    })
    const review = aiHistoryReducer(initial, { type: 'apply', action: { type: 'passInspectorAction' } }, 'investigators', true)
    expect(currentHistoryState(review).round).toBe(1)
    expect(currentHistoryState(review).reachedDiscoveries).toEqual([33])
    const confirmed = aiHistoryReducer(review, { type: 'apply', action: { type: 'continueHandoff' } }, 'investigators', true)
    expect(currentHistoryState(confirmed).round).toBe(2)
    expect(currentHistoryState(confirmed).reachedDiscoveries).toEqual([33, 46])
    expect(currentHistoryState(confirmed).moveSlot).toBe(0)
  })

  test('WaitEnd shows a finished game immediately without asking to hand off', () => {
    const initial = createGameHistory({ ...roundHistory().entries[1]!.state, moveSlot: 14 })
    const finished = aiHistoryReducer(initial, { type: 'apply', action: { type: 'confirmJackMove' } }, 'jack', true)
    expect(currentHistoryState(finished).stage).toBe('gameOver')
    expect(needsAiEndConfirmation(finished, 'jack')).toBe(false)
    expect(needsAiTurn(finished, 'jack')).toBe(false)
  })

  test.each(['jack', 'investigators'] as const)('lets %s traverse both sides all the way back and forward without changing recorded actions', role => {
    const original = roundHistory()
    let history = original
    const visited = [history.cursor]
    while (history.cursor > 0) {
      const next = aiHistoryReducer(history, { type: 'undo' }, role)
      expect(next.cursor).toBeLessThan(history.cursor)
      expect(next.entries).toBe(original.entries)
      expect(next.pendingReveal).toBeNull()
      expect(currentHistoryState(next).stage).not.toMatch(/handoff|Result/)
      history = next
      visited.push(history.cursor)
    }
    expect(aiHistoryReducer(history, { type: 'undo' }, role)).toBe(history)
    expect(aiHistoryReducer(history, { type: 'redoAll' }, role)).toEqual(original)
    for (const cursor of visited.reverse().slice(1)) {
      history = aiHistoryReducer(history, { type: 'redo' }, role)
      expect(history.cursor).toBe(cursor)
    }
    expect(history).toEqual(original)
    expect(aiHistoryReducer(history, { type: 'redo' }, role)).toBe(history)
  })

  test('Undo Side rewinds each side in turn, then Redo Side restores the whole recorded future', () => {
    const original = roundHistory()
    const investigators = aiHistoryReducer(original, { type: 'bigUndo' }, 'jack')
    expect(currentHistoryState(investigators).stage).toBe('investigatorMove')
    expect(currentHistoryState(investigators).activeInvestigator).toBe(0)
    const jack = aiHistoryReducer(investigators, { type: 'bigUndo' }, 'jack')
    expect(jack.cursor).toBe(0)
    expect(aiHistoryReducer(jack, { type: 'redoAll' }, 'jack')).toEqual(original)
  })

  test('new human actions replace the undone future even when repeating the same move', () => {
    const original = roundHistory()
    let undone = original
    while (undone.cursor > 1) undone = aiHistoryReducer(undone, { type: 'undo' }, 'jack')
    const next = aiHistoryReducer(undone, { type: 'apply', action: { type: 'confirmJackMove' } }, 'jack')
    expect(next.entries).toHaveLength(next.cursor + 1)
    expect(next.entries.length).toBeLessThan(original.entries.length)
    expect(needsAiTurn(next, 'jack')).toBe(true)
    expect(currentHistoryState(next).publicRound?.moves).toHaveLength(1)
  })

  test('resuming from an AI action drops only its undone future and keeps the evidence at that point', () => {
    const original = roundHistory()
    const undone = aiHistoryReducer(original, { type: 'undo' }, 'jack')
    expect(needsAiTurn(undone, 'jack')).toBe(true)
    const resumed = resumeAiHistory(undone)
    expect(resumed.entries).toEqual(original.entries.slice(0, undone.cursor + 1))
    expect(currentHistoryState(resumed)).toBe(currentHistoryState(undone))
    expect(resumeAiHistory(resumed)).toBe(resumed)
    expect(aiHistoryReducer(undone, { type: 'apply', action: { type: 'passInspectorAction' } }, 'jack')).toBe(undone)
  })
})
