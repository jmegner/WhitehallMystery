import { expect, test } from 'vitest'
import { finishedReplayHistory, occupiedStartReplayHistory } from '../../tests/fixtures/replayHistory'
import { currentHistoryState, createGameHistory, gameHistoryReducer } from './history'
import { gameReplayTurns, loadReplayPosition, replayRoundTarget, saveReplayPosition } from './replay'
import { decodeMail, encodeMail } from './byMail'
import { legalJackDestinations } from './gameEngine'
import { normalizeRemoteHistory } from './remoteHistory'
import { INVESTIGATOR_ORDER, type GameAction } from './types'

test('groups complete side turns, preserves Coach steps and discoveries, and leaves saved history intact', () => {
  const history = finishedReplayHistory()
  const before = JSON.stringify(history)
  const turns = gameReplayTurns(history)
  expect(currentHistoryState(history).result?.winner).toBe('jack')
  expect(turns.map(turn => turn.side)).toEqual(turns.map((_, index) => index % 2 ? 'investigators' : 'jack'))
  expect([...new Set(turns.map(turn => turn.state.round))]).toEqual([1, 2, 3])
  expect(turns[0]!.state.roundTrail).toHaveLength(3)
  expect(turns[0]!.state.publicRound!.moves[0]!.type).toBe('coach')
  expect(turns[0]!.state.jackMoveSelection.path).toEqual([])
  for (const round of [1, 2, 3]) {
    const final = turns.filter(turn => turn.state.round === round).at(-1)!
    expect(final.side).toBe('investigators')
    expect(final.state.roundTrail.at(-1)).toBe([46, 147, 159][round - 1])
    expect(final.state.reachedDiscoveries).toContain(final.state.currentJack)
  }
  expect(turns.at(-1)!.state.result?.winner).toBe('jack')
  expect(JSON.stringify(history)).toBe(before)
  expect(gameReplayTurns(history)).toBe(turns)
  const mail = decodeMail(encodeMail(1789142400, 'investigators', history))
  expect(gameReplayTurns(mail.history)).toEqual(turns)
  expect(gameReplayTurns({ ...history, cursor: history.cursor - 1 })).toEqual([])
})

test('records the start of the entire investigator turn, including occupied starts and an arrest ending the game', () => {
  const turns = gameReplayTurns(occupiedStartReplayHistory())
  expect(turns).toHaveLength(1)
  expect(turns[0]!.startPositions).toEqual({ yellow: 'DD', blue: 'DC', red: 'HZ' })
  expect(turns[0]!.state.investigatorPositions.blue).toBe('DD')
  expect(turns[0]!.state.investigatorPositions.yellow).not.toBe('DD')
  expect(turns[0]!.state.result?.winner).toBe('investigators')
})

test('includes Jack’s final Street move when the fifteen-move deadline ends the game', () => {
  const complete = finishedReplayHistory()
  const start = complete.entries.findIndex(entry => entry.state.stage === 'jackMove' && entry.state.moveSlot === 0)
  let history = { ...complete, entries: complete.entries.slice(0, start + 1), cursor: start }
  const apply = (action: GameAction) => {
    history = normalizeRemoteHistory(gameHistoryReducer(history, { type: 'apply', action }))
  }
  for (let move = 1; move <= 15; move++) {
    const state = currentHistoryState(history)
    const destination = legalJackDestinations(state).find(id => !state.discoveryLocations.includes(id))!
    apply({ type: 'selectJackDestination', circleId: destination })
    apply({ type: 'confirmJackMove' })
    if (move === 15) break
    for (const color of INVESTIGATOR_ORDER) apply({ type: 'moveInvestigator', crossingId: state.investigatorPositions[color]! })
    for (let index = 0; index < 3; index++) apply({ type: 'passInspectorAction' })
  }
  expect(currentHistoryState(history).stage).toBe('gameOver')
  const final = gameReplayTurns(history).at(-1)!
  expect(final.side).toBe('jack')
  expect(final.state.moveSlot).toBe(15)
  expect(final.state.roundTrail).toHaveLength(16)
  expect(final.state.result?.winner).toBe('investigators')
  expect(final.state.currentJack).toBe(currentHistoryState(history).currentJack)
})

test('round jumps go to the first turn of each round and stop at the ends; old snapshots remain viewable', () => {
  const turns = gameReplayTurns(finishedReplayHistory())
  const second = turns.findIndex(turn => turn.state.round === 2)
  const third = turns.findIndex(turn => turn.state.round === 3)
  expect(replayRoundTarget(turns, 1, -1)).toBeNull()
  expect(replayRoundTarget(turns, 1, 1)).toBe(second)
  expect(replayRoundTarget(turns, second + 1, -1)).toBe(0)
  expect(replayRoundTarget(turns, second, 1)).toBe(third)
  expect(replayRoundTarget(turns, turns.length - 1, 1)).toBeNull()
  const state = currentHistoryState(finishedReplayHistory())
  expect(gameReplayTurns(createGameHistory(state))).toMatchObject([{ state: { currentJack: 159 }, startPositions: {} }])
})

test('replay positions stay separate per game and tolerate unavailable or damaged storage', () => {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  saveReplayPosition(storage, 'one', 3)
  expect(loadReplayPosition(storage, 'one')).toBe(3)
  expect(loadReplayPosition(storage, 'two')).toBeNull()
  saveReplayPosition(storage, 'one', null)
  expect(loadReplayPosition(storage, 'one')).toBeNull()
  for (const value of ['-1', '1.5', '"3"', '{', 'null']) {
    storage.setItem('whitehall-mystery.replay-position.one', value)
    expect(loadReplayPosition(storage, 'one')).toBeNull()
  }
  expect(loadReplayPosition(null, 'one')).toBeNull()
  const unavailable = { getItem: () => { throw new Error() }, setItem: () => { throw new Error() } }
  expect(loadReplayPosition(unavailable, 'one')).toBeNull()
  expect(() => saveReplayPosition(unavailable, 'one', 2)).not.toThrow()
})
