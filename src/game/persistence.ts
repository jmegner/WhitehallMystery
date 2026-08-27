import type { GameState } from './types'
import { createGameHistory, currentHistoryState, type GameHistory } from './history'

export const GAME_STORAGE_KEY = 'whitehall-mystery.game.v1'
export const CROSSING_IDS_STORAGE_KEY = 'whitehall-mystery.show-crossing-ids'
export const PAST_PATH_STORAGE_KEY = 'whitehall-mystery.show-past-path'
export const POSSIBLE_LOCATIONS_STORAGE_KEY = 'whitehall-mystery.show-possible-locations'
export const JACK_PEEK_STORAGE_KEY = 'whitehall-mystery.show-jack-peek'
export const INVESTIGATOR_AUTO_STORAGE_KEY = 'whitehall-mystery.investigator-auto'

const GAME_STORAGE_VERSION = 2

interface StorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

const stages = new Set<GameState['stage']>([
  'jackDiscoverySetup',
  'handoffInspectorsSetup',
  'investigatorSetup',
  'investigatorSetupResult',
  'handoffJackStart',
  'jackChooseStart',
  'jackMove',
  'handoffInspectorsTurn',
  'investigatorMove',
  'investigatorAction',
  'investigatorTurnResult',
  'handoffJackTurn',
  'gameOver',
])

const moveTypes = new Set(['normal', 'coach', 'alley', 'boat'])
const actionModes = new Set(['choose', 'search', 'arrest'])
const isNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item))
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isPublicRound = (value: unknown) => {
  if (value === null) return true
  if (!isRecord(value) || typeof value.start !== 'number' || !Array.isArray(value.moves) || !Array.isArray(value.observations)) {
    return false
  }
  return value.moves.every(
    (move) =>
      isRecord(move) &&
      moveTypes.has(String(move.type)) &&
      typeof move.startSlot === 'number' &&
      typeof move.endSlot === 'number' &&
      isRecord(move.investigatorPositions),
  )
}

export const isStoredGameState = (value: unknown): value is GameState => {
  if (!isRecord(value)) return false
  if (!stages.has(value.stage as GameState['stage'])) return false
  if (typeof value.round !== 'number' || value.round < 1 || value.round > 3) return false
  if (typeof value.moveSlot !== 'number' || value.moveSlot < 0 || value.moveSlot > 15) return false
  if (!isNumberArray(value.discoveryLocations) || !isNumberArray(value.reachedDiscoveries)) return false
  if (value.currentJack !== null && typeof value.currentJack !== 'number') return false
  if (!isNumberArray(value.roundTrail) || !isRecord(value.investigatorPositions)) return false
  if (typeof value.activeInvestigator !== 'number' || value.activeInvestigator < 0 || value.activeInvestigator > 2) return false
  if (!isRecord(value.jackMoveSelection) || !moveTypes.has(String(value.jackMoveSelection.type))) return false
  if (!isNumberArray(value.jackMoveSelection.path) || !isRecord(value.specialRemaining)) return false
  if (!isPublicRound(value.publicRound) || !isNumberArray(value.clueLocations)) return false
  if (!actionModes.has(String(value.inspectorActionMode)) || !isNumberArray(value.checkedThisAction)) return false
  if (!isStringArray(value.publicLog) || typeof value.notice !== 'string') return false
  if (value.result !== null && (!isRecord(value.result) || !['jack', 'investigators'].includes(String(value.result.winner)))) {
    return false
  }
  return true
}

const actionTypes = new Set([
  'toggleDiscovery',
  'confirmDiscoveries',
  'continueHandoff',
  'placeInvestigator',
  'chooseJackStart',
  'setJackMoveType',
  'selectJackDestination',
  'clearJackSelection',
  'confirmJackMove',
  'moveInvestigator',
  'setInspectorActionMode',
  'searchCircle',
  'arrestCircle',
  'passInspectorAction',
  'newGame',
])

const isStoredGameHistory = (value: unknown): value is GameHistory => {
  if (!isRecord(value) || !Array.isArray(value.entries) || value.entries.length === 0) return false
  if (!Number.isInteger(value.cursor) || Number(value.cursor) < 0 || Number(value.cursor) >= value.entries.length) return false
  if (value.pendingReveal !== null && value.pendingReveal !== 'jack' && value.pendingReveal !== 'investigators') return false
  return value.entries.every(
    (entry, index) =>
      isRecord(entry) &&
      isStoredGameState(entry.state) &&
      typeof entry.counted === 'boolean' &&
      (index === 0
        ? entry.action === null
        : isRecord(entry.action) && actionTypes.has(String(entry.action.type))),
  )
}

export const loadStoredHistory = (storage: StorageLike): GameHistory | null => {
  try {
    const raw = storage.getItem(GAME_STORAGE_KEY)
    if (!raw) return null
    const envelope = JSON.parse(raw) as unknown
    if (!isRecord(envelope)) return null
    if (envelope.version === GAME_STORAGE_VERSION && isStoredGameHistory(envelope.history)) return envelope.history
    if (envelope.version === 1 && isStoredGameState(envelope.state)) return createGameHistory(envelope.state)
    return null
  } catch {
    return null
  }
}

export const loadStoredGame = (storage: StorageLike): GameState | null => {
  const history = loadStoredHistory(storage)
  return history ? currentHistoryState(history) : null
}

export const saveStoredGame = (storage: StorageLike, state: GameState): void => {
  saveStoredHistory(storage, createGameHistory(state))
}

export const saveStoredHistory = (storage: StorageLike, history: GameHistory): void => {
  try {
    storage.setItem(GAME_STORAGE_KEY, JSON.stringify({ version: GAME_STORAGE_VERSION, history }))
  } catch {
    // Storage can be unavailable in private or quota-restricted browser contexts.
  }
}

export const loadBooleanPreference = (storage: StorageLike, key: string, fallback = false): boolean => {
  try {
    const value = storage.getItem(key)
    return value === null ? fallback : value === 'true'
  } catch {
    return fallback
  }
}

export const saveBooleanPreference = (storage: StorageLike, key: string, value: boolean): void => {
  try {
    storage.setItem(key, String(value))
  } catch {
    // A display preference is non-critical when browser storage is unavailable.
  }
}
