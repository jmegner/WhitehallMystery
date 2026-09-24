import { createInitialGame } from './gameEngine'
import { createGameHistory, currentHistoryState, gameHistoryReducer, playerViewForState, type GameHistory, type PlayerView } from './history'
import { decodeMail, MAIL_STORAGE_KEY, mailTimestamp, mailTurnStart } from './byMail'
import { loadStoredHistory } from './persistence'
import { canonicalJson, onlineHistoryFromWire, onlineHistoryToWire } from './onlineProtocol'
import { ONLINE_SESSION_STORAGE_KEY, parseOnlineSession, type OnlineSession } from '../online/onlineSession'
import type { GameAction, GameState } from './types'
import { isOnlineSeats, opponentRole, type OnlineSeats } from './onlineSeats'
import { isGameName } from './gameName'

export const SAVED_GAME_PREFIX = 'whitehall-mystery.saved-game.v1.'
export const ACTIVE_GAME_KEY = 'whitehall-mystery.active-game.v1'
const MIGRATED_KEY = 'whitehall-mystery.saved-games-migrated.v1'

export interface MailSession {
  id: number
  role: PlayerView
  history: GameHistory
  outgoing: string
  turnStart: number
  baselineEndedAt: number | null
  completedText?: string
}
export interface MailView { draft: string; showBoard: boolean; activeSharing: boolean }
export interface GameSummary { round: number; move: number; turn: PlayerView | null; stage: GameState['stage']; winner: PlayerView | null }
interface SavedGameBase { id: string; startedAt: number | null; savedAt: number; name?: string }
export type SavedGame = SavedGameBase & (
  | { mode: 'same-device'; history: GameHistory }
  | { mode: 'by-mail'; session: MailSession; view: MailView }
  | { mode: 'online'; session: OnlineSession; summary: GameSummary | null; seats?: OnlineSeats | null; revision?: number }
)
export interface GameLibraryState { games: SavedGame[]; activeId: string; error: string }
export type GameStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem'>
const defaultMailView = (): MailView => ({ draft: '', showBoard: false, activeSharing: false })
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const nullableRole = (value: unknown): value is PlayerView | null => value === null || value === 'jack' || value === 'investigators'
const validTimestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 8.64e15
const readHistory = (value: unknown) => loadStoredHistory({ getItem: () => JSON.stringify({ version: 2, history: value }), setItem: () => {} })
const LEFT_GAME = JSON.stringify({ left: true })

export function normalizeLocalResume(history: GameHistory): GameHistory {
  if (history.pendingReveal === 'investigators') history = gameHistoryReducer(history, { type: 'revealUndo' })
  if (['handoffInspectorsSetup', 'handoffInspectorsTurn'].includes(currentHistoryState(history).stage)) {
    history = gameHistoryReducer(history, { type: 'apply', action: { type: 'continueHandoff' } })
  }
  return history
}

function readMail(value: unknown): MailSession | null {
  if (!record(value) || !Number.isInteger(value.id) || Number(value.id) <= 0 || (value.role !== 'jack' && value.role !== 'investigators')) return null
  const history = readHistory(value.history)
  if (!history || typeof value.outgoing !== 'string' || (value.completedText !== undefined && typeof value.completedText !== 'string')) return null
  const replayed = onlineHistoryFromWire(onlineHistoryToWire(history))
  if (!replayed || canonicalJson(replayed) !== canonicalJson(history)) return null
  if (!Number.isInteger(value.turnStart) || Number(value.turnStart) < 0 || Number(value.turnStart) > history.cursor) return null
  if (value.baselineEndedAt !== null && (!Number.isInteger(value.baselineEndedAt) || Number(value.baselineEndedAt) < 0)) return null
  for (const text of [value.outgoing, value.completedText]) if (text && decodeMail(String(text)).id !== value.id) return null
  return { id: Number(value.id), role: value.role, history, outgoing: value.outgoing, turnStart: Number(value.turnStart), baselineEndedAt: value.baselineEndedAt as number | null, ...(value.completedText ? { completedText: String(value.completedText) } : {}) }
}

export function loadLegacyMail(storage: GameStorage): MailSession | null {
  try {
    const saved: unknown = JSON.parse(storage.getItem(MAIL_STORAGE_KEY) ?? 'null')
    if (!record(saved) || !Array.isArray(saved.actions) || saved.actions.length > 3000) return null
    const history = saved.actions.reduce((h: GameHistory, action: GameAction) => gameHistoryReducer(h, { type: 'apply', action }), createGameHistory(createInitialGame()))
    if (saved.cursor !== undefined) history.cursor = Number(saved.cursor)
    return readMail({ ...saved, history, turnStart: saved.turnStart ?? mailTurnStart(history, saved.role as PlayerView), baselineEndedAt: saved.baselineEndedAt ?? null })
  } catch { return null }
}

function parseSavedGame(text: string | null): SavedGame | null {
  try {
    const value: unknown = JSON.parse(text ?? 'null')
    if (!record(value) || typeof value.id !== 'string' || !validTimestamp(value.savedAt) ||
      (value.startedAt !== null && !validTimestamp(value.startedAt))) return null
    if (value.name !== undefined && !isGameName(value.name)) return null
    const base = { id: value.id, startedAt: value.startedAt as number | null, savedAt: value.savedAt, ...(value.name !== undefined ? { name: value.name } : {}) }
    if (value.mode === 'same-device') {
      const history = readHistory(value.history)
      return history ? { ...base, mode: 'same-device', history } : null
    }
    if (value.mode === 'by-mail') {
      const session = readMail(value.session)
      if (!session || !record(value.view) || typeof value.view.draft !== 'string' || typeof value.view.showBoard !== 'boolean' || typeof value.view.activeSharing !== 'boolean') return null
      return { ...base, mode: 'by-mail', session, view: { draft: value.view.draft, showBoard: value.view.showBoard, activeSharing: value.view.activeSharing } }
    }
    if (value.mode === 'online') {
      const session = parseOnlineSession(value.session)
      if (!session) return null
      const summary = value.summary
      if (summary !== null && (!record(summary) || !Number.isInteger(summary.round) || Number(summary.round) < 1 || Number(summary.round) > 3 ||
        !Number.isInteger(summary.move) || Number(summary.move) < 0 || Number(summary.move) > 15 || typeof summary.stage !== 'string' ||
        !nullableRole(summary.turn) || !nullableRole(summary.winner))) return null
      if (value.revision !== undefined && (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0)) return null
      if (value.seats !== undefined && value.seats !== null && !isOnlineSeats(value.seats, value.revision as number | undefined)) return null
      return { ...base, mode: 'online', session, summary: summary as GameSummary | null,
        ...(value.seats !== undefined ? { seats: value.seats as OnlineSeats | null } : {}), ...(value.revision !== undefined ? { revision: Number(value.revision) } : {}) }
    }
    return null
  } catch { return null }
}

export const summarizeGame = (history: GameHistory): GameSummary => {
  const state = currentHistoryState(history)
  const turn = history.pendingReveal ?? playerViewForState(state) ?? (state.stage.startsWith('handoffJack') ? 'jack' : state.stage.startsWith('handoffInspectors') ? 'investigators' : null)
  return { round: state.round, move: state.moveSlot, stage: state.stage, turn, winner: state.result?.winner ?? null }
}
export const savedGameSummary = (game: SavedGame): GameSummary | null => game.mode === 'online' ? game.summary : summarizeGame(game.mode === 'same-device' ? game.history : game.session.history)
export const savedGameTime = (game: SavedGame): string => game.startedAt === null ? 'Start time unknown (older saved game)' : mailTimestamp(game.startedAt / 1000)
export const savedGameMode = (game: SavedGame): string => game.mode === 'same-device' ? 'Same device' : game.mode === 'by-mail' ? 'By Mail' : 'Online'
export const savedGameStatus = (game: SavedGame): string => {
  const summary = savedGameSummary(game)
  if (!summary) return 'Not connected yet'
  const turn = summary.stage === 'gameOver' ? `Game over · ${summary.winner === 'jack' ? 'Jack' : 'Investigators'} won` : `${summary.turn === 'jack' ? 'Jack’s' : 'Investigators’'} turn`
  const left = game.mode === 'online' && game.seats && game.seats[opponentRole(game.session.role)].leftAt !== null
  return `Round ${summary.round} · Move ${summary.move} · ${turn}${left ? ' · Opponent left the game' : ''}`
}

// Each game has its own key: saving one game's moves cannot overwrite another
// tab's game. Credentials stay local; nothing in this library is sent to a server.
export class SavedGameLibrary {
  private state: GameLibraryState = { games: [], activeId: '', error: '' }
  private listeners = new Set<() => void>()
  private storage: GameStorage | null

  constructor(storage: GameStorage | null) {
    this.storage = storage
    let hadSelection = false
    try {
      for (let i = 0; storage && i < storage.length; i++) {
        const key = storage.key(i)
        if (!key?.startsWith(SAVED_GAME_PREFIX)) continue
        const raw = storage.getItem(key)
        if (raw === LEFT_GAME) continue
        const game = parseSavedGame(raw)
        if (game && key === SAVED_GAME_PREFIX + game.id) this.state.games.push(game)
        else this.state.error = 'A damaged saved game could not be loaded. Its stored data has been kept.'
      }
      this.state.activeId = storage?.getItem(ACTIVE_GAME_KEY) ?? ''
      hadSelection = storage?.getItem(ACTIVE_GAME_KEY) != null
      if (storage && storage.getItem(MIGRATED_KEY) !== 'true') {
        let legacyActive = ''
        const history = loadStoredHistory(storage)
        if (history) {
          legacyActive = 'same-device-legacy'
          if (!storage.getItem(SAVED_GAME_PREFIX + legacyActive)) this.put({ id: legacyActive, mode: 'same-device', startedAt: null, savedAt: Date.now(), history })
        }
        const session = loadLegacyMail(storage)
        if (session) {
          legacyActive = `by-mail-${session.id}-${session.role}`
          if (!storage.getItem(SAVED_GAME_PREFIX + legacyActive)) this.saveMail(session, {
            draft: storage.getItem('whitehall-mystery.mail-draft') ?? '',
            showBoard: storage.getItem('whitehall-mystery.mail-show-board') === 'true',
            activeSharing: storage.getItem('whitehall-mystery.mail-active-sharing') === 'true',
          })
        }
        const online = parseOnlineSession(JSON.parse(storage.getItem(ONLINE_SESSION_STORAGE_KEY) ?? 'null'))
        if (online) {
          legacyActive = this.onlineId(online)
          if (!storage.getItem(SAVED_GAME_PREFIX + legacyActive)) this.saveOnline(online)
        }
        if (!this.state.activeId && legacyActive) this.activate(legacyActive)
        if (!this.state.error) storage.setItem(MIGRATED_KEY, 'true')
      }
    } catch { this.state.error = 'Some saved games could not be read. Existing storage has been kept.' }
    if (!this.state.games.some(game => game.id === this.state.activeId)) {
      if (this.state.games[0] && (this.state.activeId || !hadSelection)) this.activate(this.state.games[0].id)
      else if (!hadSelection) this.addSameDevice()
      else this.state.activeId = ''
    }
  }

  readonly getSnapshot = () => this.state
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish() { this.state = { ...this.state }; for (const listener of this.listeners) listener() }
  private write(key: string, text: string) {
    try { if (!this.storage) throw new Error('Storage unavailable'); this.storage.setItem(key, text); return true }
    catch { this.state.error = 'Could not save to browser storage. Keep this page open: recent changes may be lost on refresh.'; return false }
  }
  get(id: string) { return this.state.games.find(game => game.id === id) }
  put(game: SavedGame) {
    this.write(SAVED_GAME_PREFIX + game.id, JSON.stringify(game))
    this.state.games = [...this.state.games.filter(other => other.id !== game.id), game]
    this.publish()
    return game
  }
  activate(id: string) {
    if (!this.get(id)) return
    this.state.activeId = id
    this.write(ACTIVE_GAME_KEY, id)
    this.publish()
  }
  leave(id: string) {
    // A tiny tombstone prevents legacy migration from resurrecting a departed
    // game. It contains no history or credentials.
    if (!this.get(id)) return true
    if (!this.write(SAVED_GAME_PREFIX + id, LEFT_GAME)) { this.publish(); return false }
    this.state.games = this.state.games.filter(game => game.id !== id)
    if (this.state.activeId === id) {
      this.state.activeId = ''
      this.write(ACTIVE_GAME_KEY, '')
    }
    this.publish()
    return true
  }
  addSameDevice() {
    const game: SavedGame = { id: `same-device-${crypto.randomUUID()}`, mode: 'same-device', startedAt: Date.now(), savedAt: Date.now(), history: createGameHistory(createInitialGame()) }
    this.put(game); this.activate(game.id)
    return game
  }
  saveLocal(id: string, history: GameHistory) {
    const game = this.get(id)
    if (game?.mode === 'same-device') this.put({ ...game, history, savedAt: Date.now() })
  }
  saveMail(session: MailSession, view?: MailView) {
    const id = `by-mail-${session.id}-${session.role}`
    const previous = this.get(id)
    return this.put({ id, mode: 'by-mail', startedAt: session.id * 1000, savedAt: Date.now(), session,
      name: previous?.name,
      view: view ?? (previous?.mode === 'by-mail' ? previous.view : defaultMailView()) })
  }
  saveOnline(session: OnlineSession) {
    const id = this.onlineId(session)
    const previous = this.get(id)
    return this.put({ id, mode: 'online', session, startedAt: session.startedAt ?? previous?.startedAt ?? null, savedAt: Date.now(), summary: previous?.mode === 'online' ? previous.summary : null,
      name: previous?.name,
      ...(previous?.mode === 'online' ? { seats: previous.seats, revision: previous.revision } : {}) })
  }
  private onlineId(session: OnlineSession) { return `online-${encodeURIComponent(session.apiBase)}-${session.roomId}-${session.role}` }
  updateOnline(id: string, history: GameHistory, createdAt: number | null, seats?: OnlineSeats | null, revision?: number, name?: string) {
    const game = this.get(id)
    if (game?.mode !== 'online' || (revision !== undefined && game.revision !== undefined && revision < game.revision)) return
    if (name !== undefined && !isGameName(name)) return
    this.put({ ...game, summary: summarizeGame(history), startedAt: createdAt ?? game.startedAt, savedAt: Date.now(), ...(seats !== undefined ? { seats } : {}), ...(revision !== undefined ? { revision } : {}), ...(name !== undefined ? { name } : {}) })
  }
  renameLocal(id: string, name: string) {
    const game = this.get(id)
    if (!game || game.mode === 'online' || !isGameName(name)) return false
    const next = { ...game, name, savedAt: Date.now() }
    if (!this.write(SAVED_GAME_PREFIX + id, JSON.stringify(next))) { this.publish(); return false }
    this.state.games = this.state.games.map(game => game.id === id ? next : game)
    this.publish()
    return true
  }
  saveInvitation(id: string, opponentInvitation: NonNullable<OnlineSession['opponentInvitation']>) {
    const game = this.get(id)
    if (game?.mode === 'online') this.put({ ...game, session: { ...game.session, opponentInvitation } })
  }
  updateMailView(id: string, patch: Partial<MailView>) {
    const game = this.get(id)
    if (game?.mode === 'by-mail') this.put({ ...game, view: { ...game.view, ...patch }, savedAt: Date.now() })
  }
}
