import { gameReducer } from './gameEngine'
import type { GameAction, GameState } from './types'

export type PlayerView = 'jack' | 'investigators'

export interface GameHistoryEntry {
  state: GameState
  action: GameAction | null
  counted: boolean
}

export interface GameHistory {
  entries: GameHistoryEntry[]
  cursor: number
  pendingReveal: PlayerView | null
}

export type HistoryCommand =
  | { type: 'apply'; action: GameAction }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'revealUndo' }

export type UndoMode = 'disabled' | 'undo' | 'cross-view'

export const playerViewForState = (state: GameState): PlayerView | null => {
  if (state.stage === 'jackDiscoverySetup' || state.stage === 'jackChooseStart' || state.stage === 'jackMove') {
    return 'jack'
  }
  if (state.stage === 'investigatorSetup' || state.stage === 'investigatorMove' || state.stage === 'investigatorAction') {
    return 'investigators'
  }
  return null
}

export const createGameHistory = (state: GameState): GameHistory => ({
  entries: [{ state, action: null, counted: false }],
  cursor: 0,
  pendingReveal: null,
})

export const currentHistoryState = (history: GameHistory): GameState =>
  history.entries[history.cursor]?.state ?? history.entries[0]!.state

const sameAction = (left: GameAction | null, right: GameAction) =>
  left !== null && JSON.stringify(left) === JSON.stringify(right)

const viewStartIndex = (history: GameHistory, owner: PlayerView): number => {
  for (let index = history.cursor; index > 0; index -= 1) {
    const entry = history.entries[index]
    if (entry?.action?.type === 'continueHandoff' && playerViewForState(entry.state) === owner) return index
  }
  return 0
}

export const undoMode = (history: GameHistory): UndoMode => {
  if (history.pendingReveal || history.cursor === 0) return 'disabled'
  const state = currentHistoryState(history)
  const owner = playerViewForState(state)
  if (!owner) return state.stage === 'gameOver' ? 'undo' : 'cross-view'
  const start = viewStartIndex(history, owner)
  if (history.cursor > start) return 'undo'
  return start >= 2 ? 'cross-view' : 'disabled'
}

export const canRedo = (history: GameHistory) => {
  const next = history.entries[history.cursor + 1]
  return history.pendingReveal === null && next !== undefined && next.action?.type !== 'continueHandoff'
}

export const actionCount = (history: GameHistory) =>
  history.entries.slice(1, history.cursor + 1).filter((entry) => entry.counted).length

const applyAction = (history: GameHistory, action: GameAction): GameHistory => {
  const current = currentHistoryState(history)
  const nextState = gameReducer(current, action)
  if (nextState === current) return history
  if (action.type === 'newGame') return createGameHistory(nextState)

  const nextEntry = history.entries[history.cursor + 1]
  if (nextEntry && sameAction(nextEntry.action, action)) {
    return { ...history, cursor: history.cursor + 1, pendingReveal: null }
  }

  return {
    entries: [
      ...history.entries.slice(0, history.cursor + 1),
      { state: nextState, action, counted: action.type !== 'continueHandoff' },
    ],
    cursor: history.cursor + 1,
    pendingReveal: null,
  }
}

const undo = (history: GameHistory): GameHistory => {
  const mode = undoMode(history)
  if (mode === 'disabled') return history
  if (mode === 'undo') return { ...history, cursor: history.cursor - 1, pendingReveal: null }

  const current = currentHistoryState(history)
  const owner = playerViewForState(current)
  if (!owner) return { ...history, cursor: history.cursor - 1, pendingReveal: null }

  const target = viewStartIndex(history, owner) - 2
  if (target < 0) return history
  return {
    ...history,
    cursor: target,
    pendingReveal: playerViewForState(history.entries[target]!.state),
  }
}

export const gameHistoryReducer = (history: GameHistory, command: HistoryCommand): GameHistory => {
  if (command.type === 'apply') return applyAction(history, command.action)
  if (command.type === 'undo') return undo(history)
  if (command.type === 'redo') {
    return canRedo(history) ? { ...history, cursor: history.cursor + 1, pendingReveal: null } : history
  }
  return history.pendingReveal ? { ...history, pendingReveal: null } : history
}
