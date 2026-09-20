import { currentHistoryState, playerViewForState, type GameHistory, type PlayerView } from './history'
import { canonicalJson, MAX_ONLINE_ACTIONS, type OnlineSnapshot } from './onlineProtocol'

export type OnlineUndoCommand =
  | { type: 'request-undo' }
  | { type: 'decide-undo'; undoRequestId: string; decision: 'approve' | 'deny' }
  | { type: 'cancel-undo'; undoRequestId: string }

export interface OnlineUndoState {
  id: string
  requestedBy: PlayerView
  targetCursor: number
  fromCursor: number
  requestedRevision: number
  status: 'pending' | 'approved' | 'denied' | 'cancelled'
  resolvedRevision: number | null
}

// Return to the last actionable position BEFORE this side ended its turn.
// Result/handoff screens are skipped, but all subsequent entries remain for redo.
export function onlineUndoTarget(history: GameHistory, role: PlayerView): number | null {
  if (playerViewForState(currentHistoryState(history)) === role) return null
  for (let cursor = history.cursor - 1; cursor >= 0; cursor -= 1) {
    const state = history.entries[cursor]!.state
    if (playerViewForState(state) === role && state.stage !== 'investigatorSetupResult' && state.stage !== 'investigatorTurnResult') return cursor
  }
  return null
}

export function applyOnlineUndo(
  history: GameHistory, undo: OnlineUndoState | null, role: PlayerView,
  command: OnlineUndoCommand, requestId: string, revision: number,
): { history: GameHistory; undo: OnlineUndoState } {
  if (command.type === 'request-undo') {
    if (undo?.status === 'pending') throw new Error('An undo request is already pending.')
    const targetCursor = onlineUndoTarget(history, role)
    if (targetCursor === null) throw new Error('You can request an undo only after completing a turn.')
    return { history, undo: {
      id: requestId, requestedBy: role, targetCursor, fromCursor: history.cursor,
      requestedRevision: revision, status: 'pending', resolvedRevision: null,
    } }
  }
  if (!undo || undo.status !== 'pending' || undo.id !== command.undoRequestId) throw new Error('That undo request is no longer pending.')
  if (command.type === 'cancel-undo') {
    if (role !== undo.requestedBy) throw new Error('Only the requester can cancel this undo request.')
    return { history, undo: { ...undo, status: 'cancelled', resolvedRevision: revision } }
  }
  if (role === undo.requestedBy) throw new Error('Only your partner can approve or deny your undo request.')
  if (undo.fromCursor !== history.cursor || onlineUndoTarget(history, undo.requestedBy) !== undo.targetCursor) {
    throw new Error('The undo request no longer matches the game history.')
  }
  return {
    history: command.decision === 'approve' ? { ...history, cursor: undo.targetCursor, pendingReveal: null } : history,
    undo: { ...undo, status: command.decision === 'approve' ? 'approved' : 'denied', resolvedRevision: revision },
  }
}

export function isOnlineUndoState(value: unknown, history: GameHistory, revision: number): value is OnlineUndoState | null {
  if (value === null) return true
  if (typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const keys = ['id', 'requestedBy', 'targetCursor', 'fromCursor', 'requestedRevision', 'status', 'resolvedRevision']
  if (Object.keys(item).length !== keys.length || !keys.every(key => Object.hasOwn(item, key))) return false
  if (typeof item.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(item.id) ||
    (item.requestedBy !== 'jack' && item.requestedBy !== 'investigators') ||
    !Number.isInteger(item.targetCursor) || Number(item.targetCursor) < 0 ||
    !Number.isInteger(item.fromCursor) || Number(item.fromCursor) <= Number(item.targetCursor) || Number(item.fromCursor) > MAX_ONLINE_ACTIONS ||
    !Number.isInteger(item.requestedRevision) || Number(item.requestedRevision) < 1 || Number(item.requestedRevision) > revision) return false
  if (item.status === 'pending') return item.resolvedRevision === null && item.requestedRevision === revision && item.fromCursor === history.cursor &&
    item.targetCursor === onlineUndoTarget(history, item.requestedBy)
  if (!['approved', 'denied', 'cancelled'].includes(String(item.status)) ||
    !Number.isInteger(item.resolvedRevision) || Number(item.resolvedRevision) <= Number(item.requestedRevision) || Number(item.resolvedRevision) > revision) return false
  if (item.resolvedRevision === revision) return item.status === 'approved'
    ? history.cursor === item.targetCursor && playerViewForState(currentHistoryState(history)) === item.requestedBy
    : history.cursor === item.fromCursor && item.targetCursor === onlineUndoTarget(history, item.requestedBy)
  return true
}

// Check adjacent revisions as well as each snapshot's full replay/hash verification.
// Reconnects may skip revisions, so those use the standalone validation above.
export function consistentUndoTransition(
  before: OnlineSnapshot, after: OnlineSnapshot, previous: OnlineUndoState | null, next: OnlineUndoState | null,
): boolean {
  if (after.revision === before.revision) return before.historyHash === after.historyHash && canonicalJson(previous) === canonicalJson(next)
  if (after.revision !== before.revision + 1) return true
  if (next?.status === 'pending' && next.id !== previous?.id) return previous?.status !== 'pending' && before.historyHash === after.historyHash && next.requestedRevision === after.revision
  if (previous?.status === 'pending') {
    if (!next || next.id !== previous.id || next.status === 'pending' || next.resolvedRevision !== after.revision) return false
    if (canonicalJson({ ...next, status: 'pending', resolvedRevision: null }) !== canonicalJson(previous)) return false
    return next.status === 'approved'
      ? after.history.cursor === previous.targetCursor && after.history.pendingReveal === null &&
        canonicalJson(before.history.actions) === canonicalJson(after.history.actions)
      : before.historyHash === after.historyHash
  }
  return canonicalJson(previous) === canonicalJson(next)
}
