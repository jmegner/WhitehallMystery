import { describe, expect, it } from 'vitest'
import { createInitialGame } from './gameEngine'
import { createGameHistory, gameHistoryReducer } from './history'
import { GAME_STORAGE_KEY, saveStoredHistory } from './persistence'
import { MAIL_STORAGE_KEY } from './byMail'
import { initialOnlineSeats } from './onlineSeats'
import { ONLINE_SESSION_STORAGE_KEY, type OnlineSession } from '../online/onlineSession'
import { ACTIVE_GAME_KEY, SAVED_GAME_PREFIX, SavedGameLibrary, savedGameStatus, savedGameTime, type GameStorage, type MailSession } from './savedGames'

class MemoryStorage implements GameStorage {
  values = new Map<string, string>()
  get length() { return this.values.size }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, text: string) { this.values.set(key, text) }
}
const initial = () => createGameHistory(createInitialGame())
const session: OnlineSession = { apiBase: 'https://example.invalid', roomId: 'a'.repeat(64), role: 'jack', token: 'A'.repeat(43), investigatorsToken: 'B'.repeat(43) }
const mail: MailSession = { id: 1700000000, role: 'jack', history: initial(), outgoing: '', turnStart: 0, baselineEndedAt: null }

describe('saved game library', () => {
  it('persists names without losing them on progress updates and ignores stale online names', () => {
    const storage = new MemoryStorage()
    const library = new SavedGameLibrary(storage)
    const local = library.getSnapshot().activeId
    expect(library.renameLocal(local, 'Sofa game')).toBe(true)
    library.saveLocal(local, initial())
    const mailGame = library.saveMail(mail)
    library.renameLocal(mailGame.id, 'Letter game')
    library.saveMail(mail)
    const online = library.saveOnline(session)
    expect(library.renameLocal(online.id, 'Unverified name')).toBe(false)
    library.updateOnline(online.id, initial(), null, initialOnlineSeats(), 2, 'Shared game')
    library.updateOnline(online.id, initial(), null, initialOnlineSeats(), 1, 'Stale name')
    library.saveOnline(session)
    const reloaded = new SavedGameLibrary(storage)
    expect(reloaded.get(local)?.name).toBe('Sofa game')
    expect(reloaded.get(mailGame.id)?.name).toBe('Letter game')
    expect(reloaded.get(online.id)?.name).toBe('Shared game')
    expect(library.renameLocal(local, 'bad\nname')).toBe(false)
    library.updateOnline(online.id, initial(), null, initialOnlineSeats(), 3, '')
    expect(new SavedGameLibrary(storage).get(online.id)?.name).toBe('')
  })

  it('leaves games without resurrecting legacy saves or creating a new empty game on reload', () => {
    const storage = new MemoryStorage()
    saveStoredHistory(storage, initial())
    const library = new SavedGameLibrary(storage)
    const local = library.getSnapshot().activeId
    const online = library.saveOnline(session)
    library.leave(online.id)
    expect(library.getSnapshot().activeId).toBe(local)
    library.leave(local)
    expect(library.getSnapshot().games).toEqual([])
    expect(library.getSnapshot().activeId).toBe('')
    expect(new SavedGameLibrary(storage).getSnapshot().games).toEqual([])
    expect(storage.getItem(SAVED_GAME_PREFIX + online.id)).not.toContain(session.token)
  })

  it('retains departure status and invitation credentials, ignoring late older status responses', () => {
    const storage = new MemoryStorage()
    const library = new SavedGameLibrary(storage)
    const game = library.saveOnline(session)
    const seats = { ...initialOnlineSeats(), investigators: { leftAt: 4, generation: 5 } }
    library.updateOnline(game.id, initial(), null, seats, 5)
    library.saveInvitation(game.id, { token: 'C'.repeat(43), generation: 5 })
    library.updateOnline(game.id, initial(), null, initialOnlineSeats(), 1)
    const reloaded = new SavedGameLibrary(storage)
    expect(savedGameStatus(reloaded.get(game.id)!)).toContain('Opponent left the game')
    expect(reloaded.get(game.id)).toMatchObject({ seats, revision: 5, session: { opponentInvitation: { token: 'C'.repeat(43), generation: 5 } } })
  })
  it('keeps separate local games, their full undo/redo histories, and the active slot across reloads', () => {
    const storage = new MemoryStorage()
    const library = new SavedGameLibrary(storage)
    const first = library.getSnapshot().activeId
    let history = gameHistoryReducer(initial(), { type: 'apply', action: { type: 'toggleDiscovery', circleId: 33 } })
    history = gameHistoryReducer(history, { type: 'undo' })
    library.saveLocal(first, history)
    const second = library.addSameDevice()
    expect(second.id).not.toBe(first)
    library.activate(first)
    const reloaded = new SavedGameLibrary(storage)
    expect(reloaded.getSnapshot().activeId).toBe(first)
    expect(reloaded.get(first)).toMatchObject({ mode: 'same-device', history })
    expect(reloaded.get(second.id)).toEqual(second)
    expect(savedGameStatus(second)).toBe('Round 1 · Move 0 · Jack’s turn')
    expect(savedGameTime(second)).toMatch(/^\d{4}-\d{2}-\d{2} /)
  })

  it('migrates all three legacy saves without deleting the originals', () => {
    const storage = new MemoryStorage()
    saveStoredHistory(storage, initial())
    storage.setItem(MAIL_STORAGE_KEY, JSON.stringify({ ...mail, history: undefined, actions: [], cursor: 0 }))
    storage.setItem('whitehall-mystery.mail-draft', 'a draft')
    storage.setItem(ONLINE_SESSION_STORAGE_KEY, JSON.stringify(session))
    const library = new SavedGameLibrary(storage)
    expect(library.getSnapshot().games.map(game => game.mode)).toEqual(['same-device', 'by-mail', 'online'])
    expect(library.get(library.getSnapshot().activeId)?.mode).toBe('online')
    expect(library.getSnapshot().games[1]).toMatchObject({ view: { draft: 'a draft' }, startedAt: mail.id * 1000 })
    expect(savedGameTime(library.getSnapshot().games[0])).toContain('unknown')
    expect(storage.getItem(GAME_STORAGE_KEY)).not.toBeNull()
    expect(new SavedGameLibrary(storage).getSnapshot().games).toEqual(library.getSnapshot().games)
  })

  it('keeps mail drafts, sharing view, and history separately for each game and role', () => {
    const storage = new MemoryStorage()
    const library = new SavedGameLibrary(storage)
    const first = library.saveMail(mail)
    const other = library.saveMail({ ...mail, id: mail.id + 1 })
    library.updateMailView(first.id, { draft: 'unfinished reply', activeSharing: true, showBoard: true })
    library.saveMail({ ...mail, history: gameHistoryReducer(mail.history, { type: 'apply', action: { type: 'toggleDiscovery', circleId: 33 } }) })
    const reloaded = new SavedGameLibrary(storage)
    expect(reloaded.get(first.id)).toMatchObject({ session: { history: { cursor: 1 } }, view: { draft: 'unfinished reply', activeSharing: true, showBoard: true } })
    expect(reloaded.get(other.id)).toEqual(other)
    expect(library.saveMail({ ...mail, role: 'investigators' }).id).not.toBe(first.id)
  })

  it('deduplicates online invitations without losing other rooms, credentials, timestamps, or last known state', () => {
    const storage = new MemoryStorage()
    const library = new SavedGameLibrary(storage)
    const one = library.saveOnline(session)
    const two = library.saveOnline({ ...session, roomId: 'b'.repeat(64) })
    library.updateOnline(one.id, initial(), 1700000000000)
    library.saveOnline(session)
    library.activate(two.id)
    const reloaded = new SavedGameLibrary(storage)
    expect(reloaded.getSnapshot().games.filter(game => game.mode === 'online')).toHaveLength(2)
    expect(reloaded.get(one.id)).toMatchObject({ session, startedAt: 1700000000000, summary: { round: 1, move: 0, turn: 'jack' } })
    expect(reloaded.get(two.id)).toEqual(two)
    expect(reloaded.getSnapshot().activeId).toBe(two.id)
  })

  it('preserves damaged slots and loads the other games', () => {
    const storage = new MemoryStorage()
    const library = new SavedGameLibrary(storage)
    const valid = library.getSnapshot().games[0]
    const brokenKey = SAVED_GAME_PREFIX + 'broken'
    storage.setItem(brokenKey, '{broken')
    storage.setItem(ACTIVE_GAME_KEY, 'broken')
    const reloaded = new SavedGameLibrary(storage)
    expect(reloaded.getSnapshot().error).toContain('damaged')
    expect(reloaded.getSnapshot().activeId).toBe(valid.id)
    expect(storage.getItem(brokenKey)).toBe('{broken')
  })

  it('reports storage failure and keeps the current game in memory', () => {
    const library = new SavedGameLibrary(null)
    expect(library.getSnapshot().error).toContain('Could not save')
    expect(library.getSnapshot().games).toHaveLength(1)
    expect(library.addSameDevice().mode).toBe('same-device')
    expect(library.getSnapshot().games).toHaveLength(2)
  })

  it('detects corruption anywhere in a saved mail history, including the redo tail', () => {
    const storage = new MemoryStorage()
    const library = new SavedGameLibrary(storage)
    let history = gameHistoryReducer(initial(), { type: 'apply', action: { type: 'toggleDiscovery', circleId: 46 } })
    history = gameHistoryReducer(history, { type: 'undo' })
    const saved = library.saveMail({ ...mail, history })
    const key = SAVED_GAME_PREFIX + saved.id
    const corrupted = JSON.parse(storage.getItem(key)!)
    corrupted.session.history.entries[1].state.discoveryLocations = [33]
    storage.setItem(key, JSON.stringify(corrupted))
    const reloaded = new SavedGameLibrary(storage)
    expect(reloaded.get(saved.id)).toBeUndefined()
    expect(reloaded.getSnapshot().error).toContain('damaged')
    expect(JSON.parse(storage.getItem(key)!)).toEqual(corrupted)
  })

  it('never reimports an old history over newer progress after a partially failed migration', () => {
    const storage = new MemoryStorage()
    saveStoredHistory(storage, initial())
    storage.setItem(SAVED_GAME_PREFIX + 'broken', '{broken')
    const library = new SavedGameLibrary(storage)
    const advanced = gameHistoryReducer(initial(), { type: 'apply', action: { type: 'toggleDiscovery', circleId: 46 } })
    library.saveLocal('same-device-legacy', advanced)
    const reloaded = new SavedGameLibrary(storage)
    expect(reloaded.get('same-device-legacy')).toMatchObject({ history: advanced })
  })
})
