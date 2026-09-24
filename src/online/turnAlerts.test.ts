import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../game/gameEngine'
import { createOnlineSnapshot } from '../game/onlineProtocol'
import { createGameHistory } from '../game/history'
import { becameLocalTurn, onlineUpdateAlert } from './turnAlertEffects'
import type { OnlineUndoState } from '../game/onlineUndo'
import type { GameStage } from '../game/types'
import { initialOnlineSeats } from '../game/onlineSeats'

const snapshot = (stage: GameStage, revision: number, roomId = 'a'.repeat(64)) =>
  createOnlineSnapshot(roomId, revision, createGameHistory({ ...createInitialGame(), stage }))

describe('turn alert detection', () => {
  it('alerts once on an opponent departure, not on own departure, refresh, or invitation replacement', async () => {
    const before = await snapshot('investigatorMove', 5)
    const after = await snapshot('investigatorMove', 6)
    const initial = initialOnlineSeats()
    const left = { ...initial, investigators: { leftAt: 6, generation: 6 } }
    expect(onlineUpdateAlert(before, after, 'jack', null, null, initial, left)?.title).toBe('Opponent left')
    expect(onlineUpdateAlert(before, after, 'investigators', null, null, initial, left)).toBeNull()
    expect(onlineUpdateAlert(null, after, 'jack', null, null, null, left)).toBeNull()
    expect(onlineUpdateAlert(after, await snapshot('investigatorMove', 7), 'jack', null, null, left, { ...left, investigators: { leftAt: 6, generation: 7 } })).toBeNull()
  })
  it('alerts each role when a newer verified snapshot passes play to them', async () => {
    const jack = await snapshot('jackMove', 5)
    const investigators = await snapshot('investigatorMove', 6)
    const jackAgain = await snapshot('jackMove', 12)
    expect(becameLocalTurn(jack, investigators, 'investigators')).toBe(true)
    expect(becameLocalTurn(jack, investigators, 'jack')).toBe(false)
    expect(becameLocalTurn(investigators, jackAgain, 'jack')).toBe(true)
  })

  it('ignores initial loads, own actions, replays, stale states, and other rooms', async () => {
    const before = await snapshot('investigatorMove', 6)
    const nextAction = await snapshot('investigatorAction', 7)
    expect(becameLocalTurn(null, before, 'investigators')).toBe(false)
    expect(becameLocalTurn(before, nextAction, 'investigators')).toBe(false)
    expect(becameLocalTurn(before, before, 'investigators')).toBe(false)
    expect(becameLocalTurn(before, await snapshot('jackMove', 5), 'jack')).toBe(false)
    expect(becameLocalTurn(before, await snapshot('jackMove', 7, 'b'.repeat(64)), 'jack')).toBe(false)
    expect(becameLocalTurn(before, await snapshot('gameOver', 7), 'jack')).toBe(false)
  })

  it('alerts once when reconnecting catches up to a turn received while disconnected', async () => {
    const beforeDisconnect = await snapshot('jackMove', 5)
    const afterReconnect = await snapshot('investigatorAction', 8)
    expect(becameLocalTurn(beforeDisconnect, afterReconnect, 'investigators')).toBe(true)
    expect(becameLocalTurn(afterReconnect, afterReconnect, 'investigators')).toBe(false)
  })

  it('alerts the other player about requests and the requester about decisions, without duplicate turn alerts', async () => {
    const before = await snapshot('investigatorMove', 5)
    const during = await snapshot('investigatorMove', 6)
    const pending: OnlineUndoState = { id: crypto.randomUUID(), requestedBy: 'jack', targetCursor: 10, fromCursor: 14, requestedRevision: 6, status: 'pending', resolvedRevision: null }
    expect(onlineUpdateAlert(before, during, 'investigators', null, pending)?.title).toBe('Undo requested')
    expect(onlineUpdateAlert(before, during, 'jack', null, pending)).toBeNull()
    expect(onlineUpdateAlert(null, during, 'investigators', null, pending)).toBeNull()
    expect(onlineUpdateAlert(during, during, 'investigators', pending, pending)).toBeNull()
    for (const status of ['approved', 'denied', 'cancelled'] as const) {
      const after = await snapshot(status === 'approved' ? 'jackMove' : 'investigatorMove', 7)
      const undo = { ...pending, status, resolvedRevision: 7 }
      expect(onlineUpdateAlert(during, after, 'jack', pending, undo)?.title ?? null).toBe(status === 'approved' ? 'Undo approved' : status === 'denied' ? 'Undo denied' : null)
      expect(onlineUpdateAlert(during, after, 'investigators', pending, undo)?.title ?? null).toBe(status === 'cancelled' ? 'Undo cancelled' : null)
    }
  })
})
