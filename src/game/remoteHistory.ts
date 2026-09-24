import {
  currentHistoryState,
  gameHistoryReducer,
  playerViewForState,
  type GameHistory,
  type HistoryCommand,
  type PlayerView,
} from './history'
import type { GameState } from './types'

export const isInvestigatorReview = (state: GameState) =>
  state.stage === 'investigatorSetupResult' || state.stage === 'investigatorTurnResult'

export function normalizeRemoteHistory(history: GameHistory, reviewResults = false): GameHistory {
  for (let index = 0; index < 4; index += 1) {
    const state = currentHistoryState(history)
    if (reviewResults && isInvestigatorReview(state)) break
    const stage = state.stage
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
  reviewResults = false,
): GameHistory {
  if (command.type === 'redoAll') {
    let next = history
    while (next.cursor < next.entries.length - 1 && playerViewForState(currentHistoryState(next)) === role) {
      if (reviewResults && isInvestigatorReview(currentHistoryState(next))) break
      next = remoteHistoryReducer(next, { type: 'redo' }, role, turnStart, reviewResults)
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
    if (reviewResults && isInvestigatorReview(currentHistoryState(history))) return history
    const nextAction = history.entries[history.cursor + 1]!.action
    if (reviewResults && nextAction?.type === 'placeInvestigator' && !nextAction.review && currentHistoryState(history).activeInvestigator === 2) {
      // Reopening a deployment saved by an older client must gain the review
      // step too. This branches the redo history; it never rewrites old entries.
      return gameHistoryReducer(history, { type: 'apply', action: { ...nextAction, review: true } })
    }
    return normalizeRemoteHistory({ ...history, cursor: history.cursor + 1, pendingReveal: null }, reviewResults)
  }
  if (command.type !== 'apply' || playerViewForState(currentHistoryState(history)) !== role) return history
  return gameHistoryReducer(history, command)
}

// Shared by the client and Worker. Keep result screens within the investigator
// turn, including automatic actions and redo; only an explicit confirmation ends it.
// Existing histories still replay with their original engine semantics.
export function onlineHistoryReducer(history: GameHistory, command: HistoryCommand, role: PlayerView, turnStart: number): GameHistory {
  if (command.type === 'apply' && command.action.type === 'placeInvestigator') {
    command = { ...command, action: { ...command.action, review: true } }
  }
  return normalizeRemoteHistory(remoteHistoryReducer(history, command, role, turnStart, true), true)
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

// A display-only allowlist: never pass hidden locations or draft moves to the
// investigator's board/controls. Reducers and consistency checks still use the
// full verified history, and the finished-game recap can reveal that history.
function investigatorPublicState(state: GameState): GameState {
  return {
    stage: state.stage,
    round: state.round,
    moveSlot: state.moveSlot,
    discoveryLocations: state.reachedDiscoveries,
    reachedDiscoveries: state.reachedDiscoveries,
    currentJack: null,
    roundTrail: [],
    investigatorPositions: state.investigatorPositions,
    activeInvestigator: state.activeInvestigator,
    jackMoveSelection: { type: 'normal', path: [] },
    specialRemaining: state.specialRemaining,
    publicRound: state.publicRound,
    clueLocations: state.clueLocations,
    inspectorActionMode: state.inspectorActionMode,
    checkedThisAction: state.checkedThisAction,
    publicLog: state.publicLog,
    notice: state.notice,
    result: state.result,
  }
}

// Private planning must not leak via the displayed action count either (for
// example, a second Coach destination). Count only public, committed actions.
export function onlineInvestigatorActionCount(history: GameHistory): number {
  return history.entries.slice(1, history.cursor + 1).filter((entry, index) => entry.counted &&
    (playerViewForState(history.entries[index]!.state) === 'investigators' ||
      entry.action?.type === 'confirmDiscoveries' || entry.action?.type === 'confirmJackMove')).length
}

// Keep the verified wire history intact; only project the investigator's UI.
// A tentative start (including one restored by undo) is not public until the
// first move is committed. Jack still sees investigator actions immediately.
export function onlineBoardState(history: GameHistory, role: PlayerView) {
  const state = currentHistoryState(history)
  if (state.stage === 'gameOver') return state
  if (role === 'jack' && state.notice === 'The starting location is public. Make Jack’s first secret move.') {
    return { ...state, notice: 'Your starting location stays private until you record your first move.' }
  }
  if (role === 'investigators' && state.round === 1) {
    const played = history.entries.slice(0, history.cursor + 1)
    if (!played.some(entry => entry.action?.type === 'confirmJackMove')) {
      const start = played.findIndex(entry => entry.action?.type === 'chooseJackStart')
      if (start > 0) return investigatorPublicState(remoteBoardState({ ...history, cursor: start - 1 }, role))
    }
  }
  const board = remoteBoardState(history, role)
  if (role === 'jack') return board
  const publicState = investigatorPublicState(board)
  return state.stage === 'investigatorSetupResult'
    ? { ...publicState, notice: 'Deployment complete. Review the starting positions, then confirm deployment.' }
    : publicState
}
