import { describe, expect, test } from 'vitest'
import { acceptMail, decodeMail, encodeMail, isMailBoundary, mailBytes, mailTimestamp, mailUrl, normalizeMailHistory, otherPlayer, mailHistoryReducer, mailBoardState, mailTurns, mailTurnTimestamp, reviewMailCorrection } from './byMail'
import { createInitialGame, randomProgressActions, legalNormalDestinations, deploymentChoices } from './gameEngine'
import { createGameHistory, currentHistoryState, gameHistoryReducer, playerViewForState, type GameHistory } from './history'
import type { GameAction } from './types'

const id = 1789142400
const apply = (h: GameHistory, action: GameAction) => normalizeMailHistory(gameHistoryReducer(h, { type: 'apply', action }))
function setup() {
  let h = createGameHistory(createInitialGame())
  for (const circleId of [33, 46, 147, 159]) h = apply(h, { type: 'toggleDiscovery', circleId })
  return apply(h, { type: 'confirmDiscoveries' })
}
function randomSide(history: GameHistory, random: () => number) {
  const owner = playerViewForState(currentHistoryState(history))
  for (let i = 0; i < 100; i++) {
    for (const action of randomProgressActions(currentHistoryState(history), random)) history = apply(history, action)
    if (playerViewForState(currentHistoryState(history)) !== owner) return history
  }
  throw new Error('Turn failed to finish')
}
describe('By Mail v1', () => {
  test('four discovery bytes, timestamp, recipient, checksum and URL-safe encoding', () => {
    const h = setup()
    const text = encodeMail(id, 'investigators', h)
    expect(text).toBe('01-aqQlgNCGpJzGW9-kyg')
    expect(() => decodeMail('aqQlgNCGpJzGW9-kyg')).toThrow('must start with')
    expect(mailBytes(h)).toEqual([33, 46, 147, 159])
    expect(decodeMail(text).role).toBe('investigators')
    expect(decodeMail(text).id).toBe(id)
    expect(mailTimestamp(id, 'UTC')).toMatch(/^2026-09-11 \d\d:\d\d:\d\d UTC$/)
    expect(encodeMail(id + 1, 'investigators', h).slice(6)).not.toBe(text.slice(6))
    for (const origin of ['https://whitehallmystery.pages.dev/', 'https://example.github.io/WhitehallMystery/']) {
      const url = mailUrl(text, origin + '?old=1#old')
      expect(url).toBe(origin + '#mail=' + text)
      expect(decodeMail(url).id).toBe(id)
    }
    expect(decodeMail(' \n' + text.slice(0, 8) + '\n' + text.slice(8)).id).toBe(id)
    for (let i = 0; i < text.length; i++) expect(() => decodeMail(text.slice(0, i) + (text[i] === 'A' ? 'B' : 'A') + text.slice(i + 1))).toThrow()
    expect(() => decodeMail(text.slice(0, -1))).toThrow()
    expect(() => decodeMail('junk')).toThrow()
  })
  test('prefixes completed turns with two digits and validates the prefix', () => {
    let history = setup()
    for (let turn = 1; turn <= 12; turn++) {
      expect(currentHistoryState(history).stage).not.toBe('gameOver')
      const text = encodeMail(id, 'jack', history, id + turn)
      expect(text.slice(0, 3)).toBe(`${String(turn).padStart(2, '0')}-`)
      expect(decodeMail(text).endedAt).toBe(id + turn)
      expect(() => decodeMail(text.slice(3))).toThrow('must start with')
      expect(() => decodeMail(mailUrl(text.slice(3), 'https://whitehallmystery.pages.dev/'))).toThrow('must start with')
      for (const prefix of ['1-', '001-', '01_', 'AA-']) expect(() => decodeMail(prefix + text.slice(3))).toThrow('must start with')
      expect(() => decodeMail(`99-${text.slice(3)}`)).toThrow('completed turn number does not match')
      history = randomSide(history, () => .95)
    }
  })
  test('replays complete deterministic games, including special moves, searches, arrests and game over', () => {
    const actions = new Set<string>()
    for (let seed = 1; seed <= 35; seed++) {
      let rng = seed
      const random = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 2 ** 32 }
      let history = setup()
      for (let turn = 0; turn < 100 && currentHistoryState(history).stage !== 'gameOver'; turn++) {
        const previous = history
        const recipient = otherPlayer(playerViewForState(currentHistoryState(previous))!)
        history = randomSide(history, random)
        expect(acceptMail(encodeMail(id, recipient, history), { id, role: recipient, history: previous }).updateNotice).toBeNull()
        expect(isMailBoundary(history)).toBe(true)
        const text = encodeMail(id, 'jack', history)
        const decoded = decodeMail(text)
        expect(mailBytes(decoded.history)).toEqual(mailBytes(history))
        expect(currentHistoryState(decoded.history)).toEqual(currentHistoryState(history))
        for (const entry of history.entries) if (entry.action) actions.add(entry.action.type === 'setJackMoveType' ? entry.action.moveType : entry.action.type)
        history = decoded.history
      }
      expect(currentHistoryState(history).stage).toBe('gameOver')
    }
    for (const action of ['coach', 'alley', 'boat', 'searchCircle', 'arrestCircle', 'passInspectorAction']) expect(actions.has(action)).toBe(true)
  })
  test('replays discovery arrivals and all three rounds through a Jack victory', () => {
    let h = setup()
    for (let i = 0; i < 3; i++) h = apply(h, { type: 'placeInvestigator', crossingId: deploymentChoices(currentHistoryState(h))[0]! })
    h = apply(h, { type: 'chooseJackStart', circleId: 33 })
    const rounds = new Set<number>()
    for (let turn = 0; turn < 45 && currentHistoryState(h).stage !== 'gameOver'; turn++) {
      const state = currentHistoryState(h)
      rounds.add(state.round)
      const targets = state.discoveryLocations.filter(id => !state.reachedDiscoveries.includes(id))
      const queue = [[state.currentJack!]]
      const visited = new Set([state.currentJack!])
      let route: number[] | undefined
      for (let i = 0; i < queue.length; i++) {
        const path = queue[i]!
        if (targets.includes(path.at(-1)!)) { route = path; break }
        for (const destination of legalNormalDestinations({ ...state, currentJack: path.at(-1)! })) {
          if (!visited.has(destination)) { visited.add(destination); queue.push([...path, destination]) }
        }
      }
      expect(route).toBeDefined()
      h = apply(h, { type: 'selectJackDestination', circleId: route![1]! })
      h = apply(h, { type: 'confirmJackMove' })
      for (const color of ['yellow', 'blue', 'red'] as const) h = apply(h, { type: 'moveInvestigator', crossingId: currentHistoryState(h).investigatorPositions[color]! })
      for (let i = 0; i < 3; i++) h = apply(h, { type: 'passInspectorAction' })
      const decoded = decodeMail(encodeMail(id, 'jack', h)).history
      expect(currentHistoryState(decoded)).toEqual(currentHistoryState(h))
      h = decoded
    }
    expect([...rounds]).toEqual([1, 2, 3])
    expect(currentHistoryState(h).result?.winner).toBe('jack')
  })
  test('rejects a checksummed message with illegal discoveries or an unfinished deployment', () => {
    const h = setup()
    const invalid = structuredClone(h)
    const locked = invalid.entries.find(entry => entry.action?.type === 'confirmDiscoveries')!
    locked.state.discoveryLocations = [1, 1, 1, 1]
    expect(() => decodeMail(encodeMail(id, 'jack', invalid))).toThrow()
    const partial = apply(h, { type: 'placeInvestigator', crossingId: deploymentChoices(currentHistoryState(h))[0]! })
    expect(() => decodeMail(encodeMail(id, 'jack', partial))).toThrow()
  })
  test('reports multiple added player turns only when loading a reply', () => {
    const previous = setup()
    const current = { id, role: 'jack' as const, history: previous }
    const deployment = randomSide(previous, () => .95)
    expect(acceptMail(encodeMail(id, 'jack', deployment), current).updateNotice).toBeNull()
    const jackMove = randomSide(deployment, () => .95)
    const twoTurns = encodeMail(id, 'jack', jackMove)
    expect(acceptMail(twoTurns, current).updateNotice).toContain('2 player turns')
    const investigatorTurn = randomSide(jackMove, () => .95)
    const threeTurns = encodeMail(id, 'jack', investigatorTurn)
    const accepted = acceptMail(threeTurns, current)
    expect(accepted.updateNotice).toContain('3 player turns')
    expect(accepted.updateNotice).toContain('including turns for your side')
    expect(mailBytes(accepted.history)).toEqual(mailBytes(investigatorTurn))
    expect(decodeMail(threeTurns)).not.toHaveProperty('updateNotice')
  })
  test('keeps undo and redo within the local turn and blocks opponent actions while waiting', () => {
    const baseline = setup()
    const start = baseline.cursor
    expect(mailHistoryReducer(baseline, { type: 'undo' }, 'investigators', start)).toBe(baseline)
    const completed = randomSide(baseline, () => .95)
    const undone = mailHistoryReducer(completed, { type: 'undo' }, 'investigators', start)
    expect(currentHistoryState(undone).stage).toBe('investigatorSetup')
    expect(currentHistoryState(undone).activeInvestigator).toBe(2)
    const redone = mailHistoryReducer(undone, { type: 'redo' }, 'investigators', start)
    expect(mailBytes(redone)).toEqual(mailBytes(completed))
    expect(currentHistoryState(redone)).toEqual(currentHistoryState(completed))
    expect(mailHistoryReducer(redone, { type: 'apply', action: { type: 'chooseJackStart', circleId: 33 } }, 'investigators', start)).toBe(redone)
    let cursor = undone
    for (let i = 0; i < 10; i++) cursor = mailHistoryReducer(cursor, { type: 'undo' }, 'investigators', start)
    expect(cursor.cursor).toBe(start)
    expect(mailBoardState(completed, 'investigators').stage).toBe('investigatorSetupResult')
    const jackMove = randomSide(completed, () => .95)
    expect(mailBoardState(jackMove, 'jack').stage).toBe('jackMove')
    expect(mailBoardState(jackMove, 'jack').currentJack).toBe(currentHistoryState(jackMove).currentJack)
  })
  test('redo side restores all local actions and stops at the opponent turn', () => {
    const baseline = setup()
    const completed = randomSide(baseline, () => .95)
    const opponentCompleted = randomSide(completed, () => .95)
    const rewound = mailHistoryReducer(completed, { type: 'bigUndo' }, 'investigators', baseline.cursor)
    expect(rewound.cursor).toBe(baseline.cursor)
    const restored = mailHistoryReducer(rewound, { type: 'redoAll' }, 'investigators', baseline.cursor)
    expect(currentHistoryState(restored)).toEqual(currentHistoryState(completed))
    expect(mailHistoryReducer(restored, { type: 'redoAll' }, 'investigators', baseline.cursor)).toBe(restored)
    const extended = { ...opponentCompleted, cursor: baseline.cursor }
    const ownTurnOnly = mailHistoryReducer(extended, { type: 'redoAll' }, 'investigators', baseline.cursor)
    expect(currentHistoryState(ownTurnOnly)).toEqual(currentHistoryState(completed))
  })
  test('formats game start time in the chosen zone, including daylight saving and date changes', () => {
    const summer = Date.UTC(2026, 8, 11, 13, 4, 5) / 1000
    expect(mailTimestamp(summer, 'America/Chicago')).toBe('2026-09-11 08:04:05 CDT')
    expect(mailTimestamp(Date.UTC(2026, 0, 11, 13, 4, 5) / 1000, 'America/Chicago')).toBe('2026-01-11 07:04:05 CST')
    expect(mailTimestamp(Date.UTC(2026, 8, 11, 2, 4, 5) / 1000, 'America/Chicago')).toBe('2026-09-10 21:04:05 CDT')
    expect(mailTimestamp(summer)).toBe(mailTimestamp(summer, Intl.DateTimeFormat().resolvedOptions().timeZone))
  })
  test('v2 shares the finish timestamp and numbers alternating setup and play turns', () => {
    let h = setup()
    for (let turn = 1; turn <= 5; turn++) {
      const text = encodeMail(id, 'jack', h, id + 60)
      expect(decodeMail(text).endedAt).toBe(id + 60)
      expect(mailTurns(decodeMail(text).history)).toHaveLength(turn)
      h = randomSide(h, () => .95)
    }
    expect(decodeMail(encodeMail(id, 'jack', setup())).endedAt).toBeNull()
    const finishedAt = Date.UTC(2026, 8, 11, 13, 4, 5) / 1000
    expect(mailTurnTimestamp(finishedAt, 'UTC')).toBe('Sep11 13:04:05 UTC')
    expect(mailTurnTimestamp(finishedAt, 'America/Chicago')).toBe('Sep11 08:04:05 CDT')
    expect(mailTurnTimestamp(Date.UTC(2026, 8, 12, 1, 25, 6) / 1000, 'America/Chicago')).toBe('Sep11 20:25:06 CDT')
    expect(mailTurnTimestamp(Date.UTC(2026, 0, 12, 1, 25, 6) / 1000, 'America/Chicago')).toBe('Jan11 19:25:06 CST')
    expect(mailTurnTimestamp(finishedAt)).toBe(mailTurnTimestamp(finishedAt, Intl.DateTimeFormat().resolvedOptions().timeZone))
    expect(mailTurnTimestamp(null)).toBe('time unavailable')
  })
  test('latest opponent corrections ignore and replace dependent local work', () => {
    const invitation = setup()
    const original = randomSide(invitation, () => .2)
    const revised = randomSide(invitation, () => .7)
    let local = apply(original, { type: 'chooseJackStart', circleId: 33 })
    local = apply(local, { type: 'selectJackDestination', circleId: legalNormalDestinations(currentHistoryState(local))[0]! })
    const current = { id, role: 'jack' as const, history: local, turnStart: original.cursor }
    const review = reviewMailCorrection(encodeMail(id, 'jack', revised, id + 100), current)
    expect(review.changedTurnNumbers).toEqual([2])
    expect(review.requiresConfirmation).toBe(false)
    expect(review.discardsLocalWork).toBe(true)
    expect(currentHistoryState(review.incoming.history).stage).toBe('jackChooseStart')
    expect(currentHistoryState(review.incoming.history).currentJack).toBeNull()
    expect(review.incoming.endedAt).toBe(id + 100)
    const earlier = structuredClone(original)
    earlier.entries.find(entry => entry.action?.type === 'confirmDiscoveries')!.state.discoveryLocations = [34, 46, 147, 159]
    const earlierReview = reviewMailCorrection(encodeMail(id, 'jack', earlier), current)
    expect(earlierReview.changedTurnNumbers).toEqual([1])
    expect(earlierReview.requiresConfirmation).toBe(true)
    expect(reviewMailCorrection(encodeMail(id, 'jack', original), current).requiresConfirmation).toBe(false)
    expect(currentHistoryState(local).currentJack).toBe(33)
  })
  test('broader, older and different-game corrections require explicit review', () => {
    const invitation = setup()
    const deployment = randomSide(invitation, () => .2)
    const jackMove = randomSide(deployment, () => .95)
    const local = randomSide(jackMove, () => .95)
    const current = { id, role: 'investigators' as const, history: local, turnStart: jackMove.cursor }
    const older = reviewMailCorrection(encodeMail(id, 'investigators', invitation), current)
    const latestRemoved = reviewMailCorrection(encodeMail(id, 'investigators', deployment), current)
    expect(latestRemoved.requiresConfirmation).toBe(false)
    expect(latestRemoved.changedTurnNumbers).toEqual([3])
    expect(older.requiresConfirmation).toBe(true)
    expect(older.changedTurnNumbers).toEqual([2, 3])
    expect(older.previousTurnCount).toBe(3)
    expect(older.incomingTurnCount).toBe(1)
    const different = reviewMailCorrection(encodeMail(id + 1, 'investigators', jackMove), current)
    expect(different.requiresConfirmation).toBe(true)
    expect(different.gameIdChanged).toBe(true)
    expect(different.changedTurnNumbers).toEqual([])
    expect(() => reviewMailCorrection(encodeMail(id, 'jack', jackMove), current)).toThrow('other player')
    expect(() => reviewMailCorrection('damaged', current)).toThrow()
    const ownUndo = mailHistoryReducer(local, { type: 'bigUndo' }, 'investigators', jackMove.cursor)
    expect(ownUndo.cursor).toBe(jackMove.cursor)
    expect(ownUndo.entries).toBe(local.entries)
  })
  test('accepts replies and rejects wrong games, wrong recipients, old and conflicting history', () => {
    const h = setup()
    const current = { id, role: 'jack' as const, history: h }
    const reply = randomSide(h, () => .2)
    expect(acceptMail(encodeMail(id, 'jack', reply), current).id).toBe(id)
    expect(() => acceptMail(encodeMail(id + 1, 'jack', reply), current)).toThrow('different game')
    expect(() => acceptMail(encodeMail(id, 'investigators', reply), current)).toThrow('other player')
    expect(() => acceptMail(encodeMail(id, 'jack', h), current)).toThrow('already loaded')
    const different = randomSide(h, () => .7)
    expect(() => acceptMail(encodeMail(id, 'jack', randomSide(different, () => .5)), { ...current, history: reply })).toThrow('conflicts')
  })
})
