import { currentHistoryState, gameHistoryReducer, playerViewForState, type GameHistory, type HistoryCommand, type PlayerView } from './history'
import { isInvestigatorReview, normalizeRemoteHistory } from './remoteHistory'

function isAutomaticHandoff(history: GameHistory, cursor: number): boolean {
  const state = history.entries[cursor]!.state
  return state.stage.startsWith('handoff') || isInvestigatorReview(state)
}

export function aiHistoryReducer(history: GameHistory, command: HistoryCommand, role: PlayerView): GameHistory {
  if (command.type === 'apply') {
    if (playerViewForState(currentHistoryState(history)) !== role) return history
    // Playing from an earlier decision branches the game; only Redo replays the
    // old future. This also restarts the opponent after a repeated human move.
    const branch = resumeAiHistory(history)
    const next = gameHistoryReducer(branch, command)
    return next === branch ? history : normalizeRemoteHistory(next)
  }
  let cursor = history.cursor
  if (command.type === 'undo' || command.type === 'bigUndo') {
    if (cursor === 0) return history
    cursor -= 1
    while (cursor > 0 && isAutomaticHandoff(history, cursor)) cursor -= 1
    if (command.type === 'bigUndo') {
      const owner = playerViewForState(history.entries[cursor]!.state)
      while (cursor > 0 && playerViewForState(history.entries[cursor - 1]!.state) === owner &&
        !isAutomaticHandoff(history, cursor - 1)) cursor -= 1
    }
  } else if (command.type === 'redo') {
    if (cursor === history.entries.length - 1) return history
    cursor += 1
    while (cursor < history.entries.length - 1 && isAutomaticHandoff(history, cursor)) cursor += 1
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
  return state.stage !== 'gameOver' && playerViewForState(state) !== human
}
