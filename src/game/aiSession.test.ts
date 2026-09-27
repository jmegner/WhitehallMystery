import { describe, expect, test } from 'vitest'
import { aiHistoryReducer, needsAiTurn, resumeAiHistory } from './aiSession'
import { createInitialGame, legalNormalDestinations } from './gameEngine'
import { createGameHistory, currentHistoryState, gameHistoryReducer, type GameHistory } from './history'
import { normalizeRemoteHistory } from './remoteHistory'
import { INVESTIGATOR_ORDER, type GameAction } from './types'

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
