import { currentHistoryState, gameHistoryReducer, playerViewForState, type GameHistory, type HistoryCommand, type PlayerView } from './history'
import { isInvestigatorReview, normalizeRemoteHistory } from './remoteHistory'
import type { GameState } from './types'

function isHumanTurnEnd(state: GameState, role: PlayerView): boolean {
  return role === 'jack'
    ? state.stage === 'handoffInspectorsSetup' || state.stage === 'handoffInspectorsTurn'
    : isInvestigatorReview(state)
}

export const needsAiEndConfirmation = (history: GameHistory, role: PlayerView): boolean =>
  isHumanTurnEnd(currentHistoryState(history), role)

function isAutomaticHandoff(history: GameHistory, cursor: number, role: PlayerView, waitEnd: boolean): boolean {
  const state = history.entries[cursor]!.state
  if (waitEnd && isHumanTurnEnd(state, role)) return false
  return state.stage.startsWith('handoff') || isInvestigatorReview(state)
}

export function aiHistoryReducer(history: GameHistory, command: HistoryCommand, role: PlayerView, waitEnd = false): GameHistory {
  if (command.type === 'apply') {
    const atEnd = needsAiEndConfirmation(history, role)
    const confirming = atEnd && command.action.type === 'continueHandoff'
    if (atEnd ? !confirming : playerViewForState(currentHistoryState(history)) !== role) return history
    if (waitEnd && command.action.type === 'placeInvestigator') {
      command = { ...command, action: { ...command.action, review: true } }
    }
    // Playing from an earlier decision branches the game; only Redo replays the
    // old future. This also restarts the opponent after a repeated human move.
    const branch = resumeAiHistory(history)
    const next = gameHistoryReducer(branch, command)
    if (next === branch) return history
    // Keep the existing handoff/result in history until the human confirms it.
    // Confirmation then normalizes every handoff before starting the AI.
    return waitEnd && !confirming && needsAiEndConfirmation(next, role) ? next : normalizeRemoteHistory(next)
  }
  let cursor = history.cursor
  if (command.type === 'undo' || command.type === 'bigUndo') {
    if (cursor === 0) return history
    cursor -= 1
    while (cursor > 0 && isAutomaticHandoff(history, cursor, role, waitEnd)) cursor -= 1
    if (command.type === 'bigUndo') {
      const owner = playerViewForState(history.entries[cursor]!.state)
      while (cursor > 0 && playerViewForState(history.entries[cursor - 1]!.state) === owner &&
        !isAutomaticHandoff(history, cursor - 1, role, waitEnd)) cursor -= 1
    }
  } else if (command.type === 'redo') {
    if (cursor === history.entries.length - 1) return history
    cursor += 1
    while (cursor < history.entries.length - 1 && isAutomaticHandoff(history, cursor, role, waitEnd)) cursor += 1
  } else if (command.type === 'redoAll') {
    cursor = history.entries.length - 1
  }
  return cursor === history.cursor && !history.pendingReveal ? history : { ...history, cursor, pendingReveal: null }
}

export function resumeAiHistory(history: GameHistory): GameHistory {
  return history.cursor === history.entries.length - 1 ? history
    : { ...history, entries: history.entries.slice(0, history.cursor + 1), pendingReveal: null }
}

export function needsAiTurn(history: GameHistory, human: PlayerView): boolean {
  const state = currentHistoryState(history)
  return state.stage !== 'gameOver' && !needsAiEndConfirmation(history, human) && playerViewForState(state) !== human
}
