import { describe, expect, test } from 'vitest'
import { createInitialGame, gameReducer, legalJackDestinations } from './gameEngine'
import {
  actionCount,
  canBigUndo,
  canRedo,
  canRedoAll,
  createGameHistory,
  currentHistoryState,
  gameRecap,
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
  test('does not record reselecting an active movement or investigator action mode', () => {
    const initial = createInitialGame()
    const jackState = {
      ...initial,
      stage: 'jackMove' as const,
      currentJack: 33,
    }
    for (const moveType of ['normal', 'coach', 'alley', 'boat'] as const) {
      const selected =
        moveType === 'normal'
          ? jackState
          : gameReducer(jackState, { type: 'setJackMoveType', moveType })
      const history = createGameHistory(selected)
      const afterReselect = gameHistoryReducer(history, action({ type: 'setJackMoveType', moveType }))
      expect(afterReselect).toBe(history)
      expect(actionCount(afterReselect)).toBe(0)
    }

    for (const mode of ['search', 'arrest'] as const) {
      const state = {
        ...initial,
        stage: 'investigatorAction' as const,
        inspectorActionMode: mode,
      }
      const history = createGameHistory(state)
      const afterReselect = gameHistoryReducer(history, action({ type: 'setInspectorActionMode', mode }))
      expect(afterReselect).toBe(history)
      expect(actionCount(afterReselect)).toBe(0)
    }
  })

  test('does not record reselecting a destination already in Jack’s route', () => {
    const jackState = {
      ...createInitialGame(),
      stage: 'jackMove' as const,
      currentJack: 33,
    }

    const destination = legalJackDestinations(jackState)[0] as number
    const selected = gameReducer(jackState, { type: 'selectJackDestination', circleId: destination })
    const history = createGameHistory(selected)
    const afterReselect = gameHistoryReducer(
      history,
      action({ type: 'selectJackDestination', circleId: destination }),
    )
    expect(afterReselect).toBe(history)
    expect(actionCount(afterReselect)).toBe(0)

    const coach = gameReducer(jackState, { type: 'setJackMoveType', moveType: 'coach' })
    const intermediate = legalJackDestinations(coach)[0] as number
    const intermediateSelected = gameReducer(coach, {
      type: 'selectJackDestination',
      circleId: intermediate,
    })
    const coachHistory = createGameHistory(intermediateSelected)
    const afterIntermediateReselect = gameHistoryReducer(
      coachHistory,
      action({ type: 'selectJackDestination', circleId: intermediate }),
    )
    expect(afterIntermediateReselect).toBe(coachHistory)
    expect(actionCount(afterIntermediateReselect)).toBe(0)
  })

  test('compacts Jack changing his move type and destination into the current turn plan', () => {
    const initial = createInitialGame()
    const investigatorState = {
      ...initial,
      stage: 'investigatorAction' as const,
    }
    const handoffState = {
      ...initial,
      stage: 'handoffJackTurn' as const,
    }
    const jackState = {
      ...initial,
      stage: 'jackMove' as const,
      currentJack: 33,
      roundTrail: [33],
    }
    let history: GameHistory = {
      entries: [
        { state: investigatorState, action: null, counted: false },
        { state: handoffState, action: { type: 'continueHandoff' }, counted: false },
        { state: jackState, action: { type: 'continueHandoff' }, counted: false },
      ],
      cursor: 2,
      pendingReveal: null,
    }

    history = run(
      history,
      action({ type: 'setJackMoveType', moveType: 'alley' }),
      action({ type: 'setJackMoveType', moveType: 'normal' }),
      action({ type: 'setJackMoveType', moveType: 'alley' }),
      action({ type: 'setJackMoveType', moveType: 'coach' }),
    )
    const coachFirst = legalJackDestinations(currentHistoryState(history))[0] as number
    history = run(
      history,
      action({ type: 'selectJackDestination', circleId: coachFirst }),
      action({ type: 'setJackMoveType', moveType: 'alley' }),
    )
    const [firstAlleyDestination, secondAlleyDestination] = legalJackDestinations(currentHistoryState(history))
    expect(firstAlleyDestination).toBeDefined()
    expect(secondAlleyDestination).toBeDefined()
    history = run(
      history,
      action({ type: 'selectJackDestination', circleId: firstAlleyDestination as number }),
      action({ type: 'selectJackDestination', circleId: secondAlleyDestination as number }),
    )

    expect(history.entries.slice(3).map((entry) => entry.action)).toEqual([
      { type: 'setJackMoveType', moveType: 'alley' },
      { type: 'selectJackDestination', circleId: secondAlleyDestination },
    ])
    expect(currentHistoryState(history).jackMoveSelection).toEqual({
      type: 'alley',
      path: [secondAlleyDestination],
    })

    history = gameHistoryReducer(history, { type: 'undo' })
    expect(currentHistoryState(history).jackMoveSelection).toEqual({ type: 'alley', path: [] })
    history = gameHistoryReducer(history, { type: 'undo' })
    expect(currentHistoryState(history).jackMoveSelection).toEqual({ type: 'normal', path: [] })
    history = gameHistoryReducer(history, { type: 'undo' })
    expect(currentHistoryState(history).stage).toBe('investigatorAction')
  })

  test('keeps at most two destination entries for a Coach plan', () => {
    const jackState = {
      ...createInitialGame(),
      stage: 'jackMove' as const,
      currentJack: 33,
    }
    let history = gameHistoryReducer(
      createGameHistory(jackState),
      action({ type: 'setJackMoveType', moveType: 'coach' }),
    )
    const first = legalJackDestinations(currentHistoryState(history))[0] as number
    history = gameHistoryReducer(history, action({ type: 'selectJackDestination', circleId: first }))
    const second = legalJackDestinations(currentHistoryState(history))[0] as number
    history = gameHistoryReducer(history, action({ type: 'selectJackDestination', circleId: second }))

    expect(history.entries.slice(1).map((entry) => entry.action?.type)).toEqual([
      'setJackMoveType',
      'selectJackDestination',
      'selectJackDestination',
    ])
  })

  test('undoes within a view, then uses Undo! to restore the prior private view', () => {
    let history = readyForInvestigatorView()
    expect(currentHistoryState(history).stage).toBe('investigatorSetup')
    expect(actionCount(history)).toBe(5)
    expect(undoMode(history)).toBe('cross-view')

    history = gameHistoryReducer(history, { type: 'undo' })
    expect(history.pendingReveal).toBe('jack')
    expect(currentHistoryState(history).stage).toBe('jackDiscoverySetup')
    expect(actionCount(history)).toBe(4)
    expect(undoMode(history)).toBe('undo')
    expect(canRedo(history)).toBe(true)

    history = gameHistoryReducer(history, { type: 'redo' })
    expect(currentHistoryState(history).stage).toBe('handoffInspectorsSetup')
    expect(history.pendingReveal).toBeNull()
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

  test('Undo Side removes the current side and Redo All can restore it directly from the handoff', () => {
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
    expect(canRedoAll(history)).toBe(true)

    history = gameHistoryReducer(history, { type: 'redoAll' })
    expect(history.pendingReveal).toBeNull()
    expect(currentHistoryState(history).stage).toBe('investigatorSetup')
    expect(currentHistoryState(history).investigatorPositions.yellow).toBe('FP')
    expect(actionCount(history)).toBe(6)

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

  test('builds a complete game-over recap from the active action history', () => {
    const initial = createInitialGame()
    const started = { ...initial, stage: 'jackMove' as const, currentJack: 33, roundTrail: [33] }
    const selected = {
      ...started,
      jackMoveSelection: { type: 'coach' as const, path: [44, 55] },
    }
    const moved = { ...selected, currentJack: 55, roundTrail: [33, 44, 55] }
    const yellowMoved = {
      ...moved,
      stage: 'investigatorMove' as const,
      activeInvestigator: 1,
      investigatorPositions: { yellow: 'BB', blue: 'HP', red: 'HZ' },
    }
    const blueMoved = {
      ...yellowMoved,
      activeInvestigator: 2,
      investigatorPositions: { yellow: 'BB', blue: 'BC', red: 'HZ' },
    }
    const investigatorsMoved = {
      ...blueMoved,
      stage: 'investigatorAction' as const,
      activeInvestigator: 0,
      investigatorPositions: { yellow: 'BB', blue: 'BC', red: 'BD' },
    }
    const clueFound = { ...investigatorsMoved, activeInvestigator: 1 }
    const gameOver = { ...clueFound, stage: 'gameOver' as const }
    const history: GameHistory = {
      cursor: 8,
      pendingReveal: null,
      entries: [
        { state: initial, action: null, counted: false },
        { state: started, action: { type: 'chooseJackStart', circleId: 33 }, counted: true },
        { state: selected, action: { type: 'selectJackDestination', circleId: 44 }, counted: true },
        { state: moved, action: { type: 'confirmJackMove' }, counted: true },
        { state: yellowMoved, action: { type: 'moveInvestigator', crossingId: 'BB' }, counted: true },
        { state: blueMoved, action: { type: 'moveInvestigator', crossingId: 'BC' }, counted: true },
        { state: investigatorsMoved, action: { type: 'moveInvestigator', crossingId: 'BD' }, counted: true },
        { state: clueFound, action: { type: 'searchCircle', circleId: 55 }, counted: true },
        { state: gameOver, action: { type: 'arrestCircle', circleId: 55 }, counted: true },
      ],
    }

    expect(gameRecap(history)).toEqual([
      'Jack started at location 33.',
      'Jack moved via Coach to {44, 55}.',
      'Investigators moved {BB, BC, BD}.',
      'Yellow found a clue at 55.',
      'Blue executed an arrest at 55: caught Jack.',
    ])
  })
})
