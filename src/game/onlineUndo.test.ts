import { describe, expect, it } from 'vitest'
import { createInitialGame, deploymentChoices, legalNormalDestinations } from './gameEngine'
import { createGameHistory, currentHistoryState, gameHistoryReducer, playerViewForState, type GameHistory, type PlayerView } from './history'
import { normalizeRemoteHistory, remoteHistoryReducer } from './remoteHistory'
import { createOnlineSnapshot, onlineTurnStart, parseOnlineClientMessage, verifyOnlineSnapshot } from './onlineProtocol'
import { applyOnlineUndo, consistentUndoTransition, isOnlineUndoState, onlineUndoTarget } from './onlineUndo'
import type { GameAction } from './types'

const id = '01234567-89ab-4cde-8fab-0123456789ab'
const apply = (history: GameHistory, action: GameAction) => normalizeRemoteHistory(gameHistoryReducer(history, { type: 'apply', action }))
function setup() {
  let history = createGameHistory(createInitialGame())
  for (const circleId of [33, 46, 147, 159]) history = apply(history, { type: 'toggleDiscovery', circleId })
  return apply(history, { type: 'confirmDiscoveries' })
}
function deployed() {
  let history = setup()
  for (let i = 0; i < 3; i++) history = apply(history, { type: 'placeInvestigator', crossingId: deploymentChoices(currentHistoryState(history))[0]! })
  return history
}
function jackMoved() {
  let history = apply(deployed(), { type: 'chooseJackStart', circleId: 33 })
  history = apply(history, { type: 'selectJackDestination', circleId: legalNormalDestinations(currentHistoryState(history))[0]! })
  return apply(history, { type: 'confirmJackMove' })
}
function investigatorsMoved() {
  let history = jackMoved()
  for (const color of ['yellow', 'blue', 'red'] as const) history = apply(history, { type: 'moveInvestigator', crossingId: currentHistoryState(history).investigatorPositions[color]! })
  for (let i = 0; i < 3; i++) history = apply(history, { type: 'passInspectorAction' })
  return history
}
const request = (history: GameHistory, role: PlayerView) => applyOnlineUndo(history, null, role, { type: 'request-undo' }, id, 20)

describe('consensual online undo', () => {
  it.each([
    ['jack', setup, 'jackDiscoverySetup'],
    ['investigators', deployed, 'investigatorSetup'],
    ['jack', jackMoved, 'jackMove'],
    ['investigators', investigatorsMoved, 'investigatorAction'],
  ] as const)('reopens the final actionable state for %s, including setup/result handoffs (%s)', async (role, fixture, stage) => {
    const history = fixture()
    const pending = request(history, role)
    expect(pending.history).toBe(history)
    expect(isOnlineUndoState(pending.undo, history, 20)).toBe(true)
    const partner = role === 'jack' ? 'investigators' : 'jack'
    const approved = applyOnlineUndo(history, pending.undo, partner, { type: 'decide-undo', undoRequestId: id, decision: 'approve' }, crypto.randomUUID(), 21)
    expect(currentHistoryState(approved.history).stage).toBe(stage)
    expect(playerViewForState(currentHistoryState(approved.history))).toBe(role)
    expect(approved.history.entries).toBe(history.entries)
    expect(approved.history.cursor).toBeLessThan(history.cursor)
    expect(isOnlineUndoState(approved.undo, approved.history, 21)).toBe(true)
    expect((await verifyOnlineSnapshot(await createOnlineSnapshot('a'.repeat(64), 21, approved.history)))?.history).toEqual(approved.history)
    const redone = remoteHistoryReducer(approved.history, { type: 'redoAll' }, role, onlineTurnStart(approved.history, role))
    expect(redone).toEqual(history)
  })

  it('can undo after the opponent has already taken actions, retaining every redo entry', () => {
    const history = apply(setup(), { type: 'placeInvestigator', crossingId: deploymentChoices(currentHistoryState(setup()))[0]! })
    const pending = request(history, 'jack')
    const approved = applyOnlineUndo(history, pending.undo, 'investigators', { type: 'decide-undo', undoRequestId: id, decision: 'approve' }, crypto.randomUUID(), 21)
    expect(approved.history.cursor).toBe(4)
    expect(approved.history.entries).toBe(history.entries)
  })

  it('requires consent from the partner; rejects duplicate, stale, own-turn, and foreign cancellations', () => {
    const history = setup()
    const pending = request(history, 'jack')
    expect(onlineUndoTarget(history, 'investigators')).toBeNull()
    expect(() => request(history, 'investigators')).toThrow('only after')
    expect(() => applyOnlineUndo(history, pending.undo, 'jack', { type: 'request-undo' }, id, 21)).toThrow('already pending')
    expect(() => applyOnlineUndo(history, pending.undo, 'jack', { type: 'decide-undo', undoRequestId: id, decision: 'approve' }, id, 21)).toThrow('Only your partner')
    expect(() => applyOnlineUndo(history, pending.undo, 'investigators', { type: 'cancel-undo', undoRequestId: id }, id, 21)).toThrow('Only the requester')
    expect(() => applyOnlineUndo(history, pending.undo, 'investigators', { type: 'decide-undo', undoRequestId: crypto.randomUUID(), decision: 'approve' }, id, 21)).toThrow('no longer pending')
    expect(() => applyOnlineUndo(history, { ...pending.undo, targetCursor: 0 }, 'investigators', { type: 'decide-undo', undoRequestId: id, decision: 'approve' }, id, 21)).toThrow('no longer matches')
  })

  it('denial and cancellation leave game state and history unchanged', () => {
    const history = setup()
    const pending = request(history, 'jack')
    for (const outcome of [
      applyOnlineUndo(history, pending.undo, 'investigators', { type: 'decide-undo', undoRequestId: id, decision: 'deny' }, id, 21),
      applyOnlineUndo(history, pending.undo, 'jack', { type: 'cancel-undo', undoRequestId: id }, id, 21),
    ]) {
      expect(outcome.history).toBe(history)
      expect(isOnlineUndoState(outcome.undo, history, 21)).toBe(true)
      expect(() => applyOnlineUndo(history, outcome.undo, 'investigators', { type: 'decide-undo', undoRequestId: id, decision: 'approve' }, id, 22)).toThrow('no longer pending')
    }
  })

  it('validates undo metadata and consecutive revision transitions', async () => {
    const history = setup()
    const before = await createOnlineSnapshot('a'.repeat(64), 19, history)
    const pending = request(history, 'jack')
    const during = await createOnlineSnapshot(before.roomId, 20, history)
    const approved = applyOnlineUndo(history, pending.undo, 'investigators', { type: 'decide-undo', undoRequestId: id, decision: 'approve' }, id, 21)
    const after = await createOnlineSnapshot(before.roomId, 21, approved.history)
    expect(consistentUndoTransition(before, during, null, pending.undo)).toBe(true)
    expect(consistentUndoTransition(during, after, pending.undo, approved.undo)).toBe(true)
    expect(isOnlineUndoState({ ...pending.undo, targetCursor: 0 }, history, 20)).toBe(false)
    expect(isOnlineUndoState({ ...pending.undo, arbitrary: 'data' }, history, 20)).toBe(false)
    expect(consistentUndoTransition(during, after, pending.undo, null)).toBe(false)
    expect(consistentUndoTransition(during, { ...after, history: during.history }, pending.undo, approved.undo)).toBe(false)
    expect(consistentUndoTransition(during, during, pending.undo, null)).toBe(false)
    const recovered = await createOnlineSnapshot(before.roomId, 21, history)
    expect(isOnlineUndoState(pending.undo, history, 21)).toBe(true)
    expect(isOnlineUndoState({ ...pending.undo, requestedRevision: 22 }, history, 21)).toBe(false)
    expect(consistentUndoTransition(during, recovered, pending.undo, pending.undo)).toBe(true)
    expect(consistentUndoTransition(during, after, pending.undo, pending.undo)).toBe(false)
    expect(consistentUndoTransition(during, recovered, pending.undo, { ...pending.undo, targetCursor: 0 })).toBe(false)
  })

  it('accepts only bounded typed undo commands, never a caller-selected rollback or arbitrary payload', () => {
    const base = { protocolVersion: 1, requestId: id, expectedRevision: 2, expectedHistoryHash: 'a'.repeat(64) }
    const parse = (command: object) => parseOnlineClientMessage(JSON.stringify({ ...base, ...command }))
    expect(parse({ type: 'request-undo' })).not.toBeNull()
    expect(parse({ type: 'decide-undo', undoRequestId: id, decision: 'approve' })).not.toBeNull()
    expect(parse({ type: 'cancel-undo', undoRequestId: id })).not.toBeNull()
    for (const extra of [{ targetCursor: 0 }, { history: {} }, { text: 'hello' }]) expect(parse({ type: 'request-undo', ...extra })).toBeNull()
    expect(parse({ type: 'request-undo', requestId: 'arbitrary text' })).toBeNull()
    expect(parse({ type: 'decide-undo', undoRequestId: id, decision: 'maybe' })).toBeNull()
  })
})
