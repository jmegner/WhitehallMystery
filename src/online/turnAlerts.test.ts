import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../game/gameEngine'
import { createOnlineSnapshot } from '../game/onlineProtocol'
import { createGameHistory } from '../game/history'
import { becameLocalTurn } from './turnAlertEffects'
import type { GameStage } from '../game/types'

const snapshot = (stage: GameStage, revision: number, roomId = 'a'.repeat(64)) =>
  createOnlineSnapshot(roomId, revision, createGameHistory({ ...createInitialGame(), stage }))

describe('turn alert detection', () => {
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
})
