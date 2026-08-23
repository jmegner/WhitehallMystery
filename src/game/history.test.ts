import { describe, expect, test } from 'vitest'
import { createInitialGame } from './gameEngine'
import {
  actionCount,
  canBigUndo,
  canRedo,
  canRedoAll,
  createGameHistory,
  currentHistoryState,
  gameHistoryReducer,
  undoMode,
  type GameHistory,
  type HistoryCommand,
} from './history'
import { loadStoredHistory, saveStoredHistory } from './persistence'
import type { GameAction } from './types'

const run = (history: GameHistory, ...commands: HistoryCommand[]) =>
  commands.reduce((current, command) => gameHistoryReducer(current, command), history)

const action = (gameAction: GameAction): HistoryCommand => ({ type: 'apply', action: gameAction })

const readyForInvestigatorView = () =>
  run(
    createGameHistory(createInitialGame()),
    action({ type: 'toggleDiscovery', circleId: 33 }),
    action({ type: 'toggleDiscovery', circleId: 46 }),
    action({ type: 'toggleDiscovery', circleId: 147 }),
    action({ type: 'toggleDiscovery', circleId: 159 }),
    action({ type: 'confirmDiscoveries' }),
    action({ type: 'continueHandoff' }),
  )

describe('game action history', () => {
  test('undoes within a view, then uses Undo! to restore the prior private view', () => {
    let history = readyForInvestigatorView()
    expect(currentHistoryState(history).stage).toBe('investigatorSetup')
    expect(actionCount(history)).toBe(5)
    expect(undoMode(history)).toBe('cross-view')

    history = gameHistoryReducer(history, { type: 'undo' })
    expect(history.pendingReveal).toBe('jack')
    expect(currentHistoryState(history).stage).toBe('jackDiscoverySetup')
    expect(actionCount(history)).toBe(4)

    history = gameHistoryReducer(history, { type: 'revealUndo' })
    history = gameHistoryReducer(history, { type: 'redo' })
    expect(currentHistoryState(history).stage).toBe('handoffInspectorsSetup')
    expect(actionCount(history)).toBe(5)
    expect(canRedo(history)).toBe(false)
    history = gameHistoryReducer(history, action({ type: 'continueHandoff' }))
    expect(currentHistoryState(history).stage).toBe('investigatorSetup')
    expect(actionCount(history)).toBe(5)
  })

  test('preserves later redo entries when an undone action is manually repeated', () => {
    let history = createGameHistory(createInitialGame())
    history = run(
      history,
      action({ type: 'toggleDiscovery', circleId: 33 }),
      action({ type: 'toggleDiscovery', circleId: 46 }),
      action({ type: 'toggleDiscovery', circleId: 147 }),
      { type: 'undo' },
      { type: 'undo' },
    )
    expect(actionCount(history)).toBe(1)

    history = gameHistoryReducer(
      history,
      action({ type: 'toggleDiscovery', circleId: 46 }),
    )
    expect(actionCount(history)).toBe(2)
    expect(canRedo(history)).toBe(true)

    history = gameHistoryReducer(history, { type: 'redo' })
    expect(currentHistoryState(history).discoveryLocations).toEqual([33, 46, 147])
    expect(actionCount(history)).toBe(3)
  })

  test('Big Undo removes the current side and Redo All restores the entire stack behind a privacy gate', () => {
    let history = gameHistoryReducer(
      readyForInvestigatorView(),
      action({ type: 'placeInvestigator', crossingId: 'FP' }),
    )
    expect(actionCount(history)).toBe(6)
    expect(canBigUndo(history)).toBe(true)

    history = gameHistoryReducer(history, { type: 'bigUndo' })
    expect(history.pendingReveal).toBe('jack')
    expect(currentHistoryState(history).stage).toBe('jackDiscoverySetup')
    expect(actionCount(history)).toBe(4)
    expect(canRedoAll(history)).toBe(false)

    history = gameHistoryReducer(history, { type: 'revealUndo' })
    expect(canRedoAll(history)).toBe(true)
    history = gameHistoryReducer(history, { type: 'redoAll' })
    expect(history.pendingReveal).toBe('investigators')
    expect(currentHistoryState(history).stage).toBe('investigatorSetup')
    expect(currentHistoryState(history).investigatorPositions.yellow).toBe('FP')
    expect(actionCount(history)).toBe(6)

    history = gameHistoryReducer(history, { type: 'revealUndo' })
    expect(history.pendingReveal).toBeNull()
    expect(canRedoAll(history)).toBe(false)
  })

  test('Redo All stays in place when the restored actions belong to the same side', () => {
    let history = createGameHistory(createInitialGame())
    history = run(
      history,
      action({ type: 'toggleDiscovery', circleId: 33 }),
      action({ type: 'toggleDiscovery', circleId: 46 }),
      { type: 'undo' },
      { type: 'redoAll' },
    )
    expect(currentHistoryState(history).discoveryLocations).toEqual([33, 46])
    expect(history.pendingReveal).toBeNull()
    expect(actionCount(history)).toBe(2)
  })

  test('persists the cursor, redo stack, counter, and privacy gate', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    const history = gameHistoryReducer(readyForInvestigatorView(), { type: 'undo' })
    saveStoredHistory(storage, history)
    expect(loadStoredHistory(storage)).toEqual(history)
  })
})
