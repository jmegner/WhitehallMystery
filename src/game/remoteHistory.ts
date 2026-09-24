import {
  currentHistoryState,
  gameHistoryReducer,
  playerViewForState,
  type GameHistory,
  type HistoryCommand,
  type PlayerView,
} from './history'

export function normalizeRemoteHistory(history: GameHistory): GameHistory {
  for (let index = 0; index < 4; index += 1) {
    const stage = currentHistoryState(history).stage
    if (!stage.startsWith('handoff') && stage !== 'investigatorSetupResult' && stage !== 'investigatorTurnResult') break
    history = gameHistoryReducer(history, { type: 'apply', action: { type: 'continueHandoff' } })
  }
  return history
}

export function remoteHistoryReducer(
  history: GameHistory,
  command: HistoryCommand,
  role: PlayerView,
  turnStart: number,
): GameHistory {
  if (command.type === 'redoAll') {
    let next = history
    while (next.cursor < next.entries.length - 1 && playerViewForState(currentHistoryState(next)) === role) {
      next = remoteHistoryReducer(next, { type: 'redo' }, role, turnStart)
    }
    return next
  }
  if (command.type === 'bigUndo') return { ...history, cursor: turnStart, pendingReveal: null }
  if (command.type === 'undo') {
    let cursor = history.cursor
    while (cursor > turnStart && history.entries[cursor]!.action?.type === 'continueHandoff') cursor -= 1
    return cursor > turnStart ? { ...history, cursor: cursor - 1, pendingReveal: null } : history
  }
  if (command.type === 'redo') {
    if (history.cursor >= history.entries.length - 1) return history
    return normalizeRemoteHistory({ ...history, cursor: history.cursor + 1, pendingReveal: null })
  }
  if (command.type !== 'apply' || playerViewForState(currentHistoryState(history)) !== role) return history
  return gameHistoryReducer(history, command)
}

export function remoteBoardState(history: GameHistory, role: PlayerView) {
  const state = currentHistoryState(history)
  if (state.stage === 'gameOver' || playerViewForState(state) === role) return state
  return {
    ...state,
    stage: role === 'jack'
      ? state.currentJack === null ? 'jackDiscoverySetup' as const : 'jackMove' as const
      : state.publicRound ? 'investigatorTurnResult' as const : 'investigatorSetupResult' as const,
    notice: 'Your turn is complete. Waiting for your partner.',
  }
}

// Keep the verified wire history intact; only project the investigator's UI.
// A tentative start (including one restored by undo) is not public until the
// first move is committed. Jack still sees investigator actions immediately.
export function onlineBoardState(history: GameHistory, role: PlayerView) {
  const state = currentHistoryState(history)
  if (role === 'jack' && state.notice === 'The starting location is public. Make Jack’s first secret move.') {
    return { ...state, notice: 'Your starting location stays private until you record your first move.' }
  }
  if (role === 'investigators' && state.stage !== 'gameOver' && state.round === 1) {
    const played = history.entries.slice(0, history.cursor + 1)
    if (!played.some(entry => entry.action?.type === 'confirmJackMove')) {
      const start = played.findIndex(entry => entry.action?.type === 'chooseJackStart')
      if (start > 0) return remoteBoardState({ ...history, cursor: start - 1 }, role)
    }
  }
  return remoteBoardState(history, role)
}
