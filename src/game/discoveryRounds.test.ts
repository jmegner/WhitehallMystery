import { describe, expect, test } from 'vitest'
import { createInitialGame } from './gameEngine'
import { createGameHistory, currentHistoryState, gameHistoryReducer, type GameHistory } from './history'
import { loadStoredHistory, saveStoredHistory } from './persistence'
import { normalizeRemoteHistory, onlineBoardState } from './remoteHistory'
import type { GameAction } from './types'

const positions = ['FP', 'HP', 'HZ']
const apply = (history: GameHistory, action: GameAction) =>
  normalizeRemoteHistory(gameHistoryReducer(history, { type: 'apply', action }))

function setup(start: number): GameHistory {
  let history = createGameHistory(createInitialGame())
  for (const circleId of [54, 5, 130, 139]) history = apply(history, { type: 'toggleDiscovery', circleId })
  history = apply(history, { type: 'confirmDiscoveries' })
  for (const crossingId of positions) history = apply(history, { type: 'placeInvestigator', crossingId })
  return apply(history, { type: 'chooseJackStart', circleId: start })
}

function move(history: GameHistory, circleId: number): GameHistory {
  history = apply(history, { type: 'selectJackDestination', circleId })
  history = apply(history, { type: 'confirmJackMove' })
  expect(currentHistoryState(history).currentJack).toBe(circleId)
  if (currentHistoryState(history).stage === 'gameOver') return history
  for (const crossingId of positions) history = apply(history, { type: 'moveInvestigator', crossingId })
  for (let index = 0; index < 3; index++) history = apply(history, { type: 'passInspectorAction' })
  return history
}

describe('revealed discoveries cannot restart rounds', () => {
  test.each([54, 5])('keeps the deadline when repeatedly revisiting 54 after starting at %s', start => {
    let history = setup(start)
    if (start === 5) {
      for (const id of [4, 21, 36, 54]) history = move(history, id)
    }
    const round = start === 54 ? 1 : 2
    const reached = start === 54 ? [54] : [5, 54]
    expect(currentHistoryState(history)).toMatchObject({ round, moveSlot: 0, reachedDiscoveries: reached })
    const revealLog = currentHistoryState(history).publicLog.filter(line => /Discovery Location|begins from/.test(line))

    // Five legal three-move loops return to 54 exactly on the deadline.
    for (let slot = 1; slot <= 15; slot++) {
      history = move(history, [33, 34, 54][(slot - 1) % 3]!)
      expect(currentHistoryState(history)).toMatchObject({ round, moveSlot: slot, reachedDiscoveries: reached })
      expect(onlineBoardState(history, 'investigators')).toMatchObject({ round, moveSlot: slot, reachedDiscoveries: reached })
      expect(currentHistoryState(history).publicLog.filter(line => /Discovery Location|begins from/.test(line))).toEqual(revealLog)
      if (slot === 3) {
        const stored = new Map<string, string>()
        const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value) } }
        saveStoredHistory(storage, history)
        history = loadStoredHistory(storage)!
        expect(currentHistoryState(history)).toMatchObject({ round, moveSlot: 3, reachedDiscoveries: reached })
      }
    }
    expect(currentHistoryState(history)).toMatchObject({
      stage: 'gameOver', currentJack: 54, result: { winner: 'investigators' },
    })
  })

  test('revisiting a discovery from an earlier round does not reset the current round either', () => {
    let history = setup(5)
    for (const id of [4, 21, 36, 54, 36, 21, 4, 5]) history = move(history, id)
    expect(currentHistoryState(history)).toMatchObject({
      round: 2, moveSlot: 4, currentJack: 5, reachedDiscoveries: [5, 54],
      roundTrail: [54, 36, 21, 4, 5], publicRound: { start: 54 }, stage: 'jackMove',
    })
  })
})
