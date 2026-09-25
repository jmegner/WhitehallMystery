import { describe, expect, it } from 'vitest'
import { createInitialGame } from './gameEngine'
import { createGameHistory, gameHistoryReducer, type GameHistory } from './history'
import {
  ONLINE_PROTOCOL_VERSION,
  createOnlineSnapshot,
  onlineHistoryFromWire,
  onlineHistoryToWire,
  parseOnlineClientMessage,
  parseOnlineGameAction,
  verifyOnlineSnapshot,
} from './onlineProtocol'
import type { GameAction } from './types'

const apply = (history: GameHistory, action: GameAction) =>
  gameHistoryReducer(history, { type: 'apply', action })

const setupHistory = () => {
  let history = createGameHistory(createInitialGame())
  for (const circleId of [33, 46, 147, 159]) history = apply(history, { type: 'toggleDiscovery', circleId })
  history = apply(history, { type: 'confirmDiscoveries' })
  return history
}

describe('online history snapshots', () => {
  it('round-trips the full current state and redo tail', async () => {
    let history = setupHistory()
    history = gameHistoryReducer(history, { type: 'undo' })
    const snapshot = await createOnlineSnapshot('a'.repeat(64), 7, history)
    const verified = await verifyOnlineSnapshot(snapshot)

    expect(verified?.history).toEqual(history)
    expect(verified?.snapshot.revision).toBe(7)
    expect(snapshot.history.actions).toHaveLength(history.entries.length - 1)
    expect(snapshot.history.cursor).toBe(history.cursor)
    expect(snapshot.history.state).toEqual(history.entries[history.cursor]?.state)
  })

  it('rejects state that does not agree with replayed actions', () => {
    const wire = onlineHistoryToWire(setupHistory())
    const damaged = { ...wire, state: { ...wire.state, round: 3 } }
    expect(onlineHistoryFromWire(damaged)).toBeNull()
  })

  it('rejects a snapshot whose checksum does not cover its history', async () => {
    const snapshot = await createOnlineSnapshot('b'.repeat(64), 1, setupHistory())
    snapshot.history.state.notice = 'corrupted'
    expect(await verifyOnlineSnapshot(snapshot)).toBeNull()
  })
})

describe('online command parsing', () => {
  it('accepts only a boolean review marker on investigator passes', () => {
    for (const action of [{ type: 'passInspectorAction' }, { type: 'passInspectorAction', review: true }, { type: 'passInspectorAction', review: false }]) {
      expect(parseOnlineGameAction(action)).toEqual(action)
    }
    for (const review of ['true', 1, null, {}, []]) {
      expect(parseOnlineGameAction({ type: 'passInspectorAction', review })).toBeNull()
    }
    expect(parseOnlineGameAction({ type: 'passInspectorAction', review: true, arbitrary: 'storage' })).toBeNull()
  })

  it('accepts strict typed commands', () => {
    const message = JSON.stringify({
      type: 'command',
      protocolVersion: ONLINE_PROTOCOL_VERSION,
      requestId: '12345678',
      expectedRevision: 0,
      expectedHistoryHash: 'a'.repeat(64),
      commands: [{ type: 'apply', action: { type: 'toggleDiscovery', circleId: 33 } }],
    })
    expect(parseOnlineClientMessage(message)).not.toBeNull()
  })

  it('rejects extra fields and invalid targets', () => {
    const base = {
      type: 'command',
      protocolVersion: ONLINE_PROTOCOL_VERSION,
      requestId: '12345678',
      expectedRevision: 0,
      expectedHistoryHash: 'a'.repeat(64),
    }
    expect(parseOnlineClientMessage(JSON.stringify({ ...base, arbitrary: 'storage', commands: [{ type: 'undo' }] }))).toBeNull()
    expect(parseOnlineClientMessage(JSON.stringify({ ...base, commands: [{ type: 'apply', action: { type: 'toggleDiscovery', circleId: 999 } }] }))).toBeNull()
  })
})
