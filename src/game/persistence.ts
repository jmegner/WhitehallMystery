import type { GameState } from './types'

export const GAME_STORAGE_KEY = 'whitehall-mystery.game.v1'
export const CROSSING_IDS_STORAGE_KEY = 'whitehall-mystery.show-crossing-ids'

const GAME_STORAGE_VERSION = 1

interface StorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

const stages = new Set<GameState['stage']>([
  'jackDiscoverySetup',
  'handoffInspectorsSetup',
  'investigatorSetup',
  'handoffJackStart',
  'jackChooseStart',
  'jackMove',
  'handoffInspectorsTurn',
  'investigatorMove',
  'investigatorAction',
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

export const loadStoredGame = (storage: StorageLike): GameState | null => {
  try {
    const raw = storage.getItem(GAME_STORAGE_KEY)
    if (!raw) return null
    const envelope = JSON.parse(raw) as unknown
    if (!isRecord(envelope) || envelope.version !== GAME_STORAGE_VERSION || !isStoredGameState(envelope.state)) {
      return null
    }
    return envelope.state
  } catch {
    return null
  }
}

export const saveStoredGame = (storage: StorageLike, state: GameState): void => {
  try {
    storage.setItem(GAME_STORAGE_KEY, JSON.stringify({ version: GAME_STORAGE_VERSION, state }))
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
