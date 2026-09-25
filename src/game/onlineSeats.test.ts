import { describe, expect, it } from 'vitest'
import { createInitialGame, deploymentChoices } from './gameEngine'
import { createGameHistory, currentHistoryState, gameHistoryReducer, type GameHistory } from './history'
import { normalizeRemoteHistory } from './remoteHistory'
import { initialOnlineSeats, isOnlineSeats, parseOnlineSessionRequest, seatsAfterTurn } from './onlineSeats'
import type { GameAction } from './types'

const apply = (history: GameHistory, action: GameAction) => normalizeRemoteHistory(gameHistoryReducer(history, { type: 'apply', action }))

describe('online departures', () => {
  it('only clears abandonment after that side completes a turn', () => {
    const seats = { ...initialOnlineSeats(), investigators: { leftAt: 8, generation: 9 } }
    let history = createGameHistory(createInitialGame())
    for (const circleId of [33, 46, 147, 159]) history = apply(history, { type: 'toggleDiscovery', circleId })
    const jackDone = apply(history, { type: 'confirmDiscoveries' })
    expect(seatsAfterTurn(seats, 'jack', history, jackDone)).toEqual(seats)
    history = jackDone
    for (let i = 0; i < 3; i++) {
      const next = apply(history, { type: 'placeInvestigator', crossingId: deploymentChoices(currentHistoryState(history))[0]! })
      expect(seatsAfterTurn(seats, 'investigators', history, next).investigators.leftAt).toBe(i < 2 ? 8 : null)
      history = next
    }
    expect(seats.investigators.leftAt).toBe(8)
  })

  it('validates bounded membership metadata and narrowly typed operations', () => {
    expect(isOnlineSeats(initialOnlineSeats(), 0)).toBe(true)
    expect(isOnlineSeats({ ...initialOnlineSeats(), jack: { leftAt: 4, generation: 5 } }, 4)).toBe(false)
    expect(isOnlineSeats({ ...initialOnlineSeats(), jack: { leftAt: 6, generation: 5 } }, 10)).toBe(false)
    expect(isOnlineSeats({ ...initialOnlineSeats(), arbitrary: 'data' })).toBe(false)
    const token = 'a'.repeat(43)
    const requestId = crypto.randomUUID()
    expect(parseOnlineSessionRequest({ type: 'status', token })).toEqual({ type: 'status', token })
    for (const type of ['leave', 'invite'] as const) {
      expect(parseOnlineSessionRequest({ type, token, requestId })).toEqual({ type, token, requestId })
      expect(parseOnlineSessionRequest({ type, token, requestId, role: 'jack' })).toBeNull()
      expect(parseOnlineSessionRequest({ type, token, requestId, arbitrary: 'storage' })).toBeNull()
      expect(parseOnlineSessionRequest({ type, token, requestId: 'not-a-uuid' })).toBeNull()
    }
  })

  it('restricts recovery to a UUID and expected opponent generation, never caller-supplied role or state', () => {
    const request = { type: 'reinvite', token: 'a'.repeat(43), requestId: crypto.randomUUID(), expectedGeneration: 0 }
    expect(parseOnlineSessionRequest(request)).toEqual(request)
    for (const expectedGeneration of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '0', undefined]) {
      expect(parseOnlineSessionRequest({ ...request, expectedGeneration })).toBeNull()
    }
    for (const extra of [{ role: 'jack' }, { state: {} }, { arbitrary: 'storage' }]) {
      expect(parseOnlineSessionRequest({ ...request, ...extra })).toBeNull()
    }
    expect(parseOnlineSessionRequest({ ...request, token: 'invalid' })).toBeNull()
    expect(parseOnlineSessionRequest({ ...request, requestId: 'arbitrary' })).toBeNull()
  })
})
