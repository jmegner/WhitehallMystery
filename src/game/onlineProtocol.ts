import { createInitialGame } from './gameEngine'
import {
  createGameHistory,
  currentHistoryState,
  gameHistoryReducer,
  playerViewForState,
  type GameHistory,
  type HistoryCommand,
  type PlayerView,
} from './history'
import { isStoredGameState } from './persistence'
import type { GameAction, GameState, InspectorActionMode, JackMoveType } from './types'
import type { OnlineUndoCommand, OnlineUndoState } from './onlineUndo'
import type { OnlineSeats } from './onlineSeats'

export const ONLINE_PROTOCOL_VERSION = 1
export const ONLINE_RULES_VERSION = 'whitehall-2026-09-18'
export const MAX_ONLINE_ACTIONS = 3000
export const MAX_COMMANDS_PER_MESSAGE = 32
export const MAX_SOCKET_MESSAGE_BYTES = 16 * 1024

export interface OnlineHistoryWire {
  rulesVersion: typeof ONLINE_RULES_VERSION
  actions: GameAction[]
  cursor: number
  pendingReveal: PlayerView | null
  state: GameState
}

export interface OnlineSnapshot {
  protocolVersion: typeof ONLINE_PROTOCOL_VERSION
  roomId: string
  revision: number
  historyHash: string
  history: OnlineHistoryWire
}

export type OnlineMutation = {
  protocolVersion: typeof ONLINE_PROTOCOL_VERSION
  requestId: string
  expectedRevision: number
  expectedHistoryHash: string
} & ({ type: 'command'; commands: HistoryCommand[] } | OnlineUndoCommand)

export type OnlineClientMessage =
  | {
      type: 'authenticate'
      protocolVersion: typeof ONLINE_PROTOCOL_VERSION
      token: string
    }
  | OnlineMutation

export type OnlineServerMessage =
  | { type: 'snapshot'; requestId?: string; snapshot: OnlineSnapshot; undo?: OnlineUndoState | null; createdAt?: number; seats?: OnlineSeats; name?: string }
  | { type: 'presence'; jack: boolean; investigators: boolean }
  | {
      type: 'error'
      requestId?: string
      code: 'authentication' | 'conflict' | 'invalid-command' | 'rate-limited' | 'room-expired' | 'server-error'
      message: string
    }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasOnlyKeys = (value: Record<string, unknown>, required: string[], optional: string[] = []) => {
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key))
}

const isCircleId = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 189

const isCrossingId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Z]{2}$/.test(value)

const isMoveType = (value: unknown): value is JackMoveType =>
  value === 'normal' || value === 'coach' || value === 'alley' || value === 'boat'

const isActionMode = (value: unknown): value is Exclude<InspectorActionMode, 'choose'> =>
  value === 'search' || value === 'arrest'

export const parseOnlineGameAction = (value: unknown): GameAction | null => {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  switch (value.type) {
    case 'toggleDiscovery':
    case 'chooseJackStart':
    case 'selectJackDestination':
    case 'searchCircle':
    case 'arrestCircle':
      return hasOnlyKeys(value, ['type', 'circleId']) && isCircleId(value.circleId)
        ? { type: value.type, circleId: value.circleId }
        : null
    case 'placeInvestigator':
      return hasOnlyKeys(value, ['type', 'crossingId'], ['review']) &&
        isCrossingId(value.crossingId) &&
        (value.review === undefined || typeof value.review === 'boolean')
        ? { type: value.type, crossingId: value.crossingId, ...(value.review === undefined ? {} : { review: value.review }) }
        : null
    case 'moveInvestigator':
      return hasOnlyKeys(value, ['type', 'crossingId']) && isCrossingId(value.crossingId)
        ? { type: value.type, crossingId: value.crossingId }
        : null
    case 'passInspectorAction':
      return hasOnlyKeys(value, ['type'], ['review']) &&
        (value.review === undefined || typeof value.review === 'boolean')
        ? { type: value.type, ...(value.review === undefined ? {} : { review: value.review }) }
        : null
    case 'setJackMoveType':
      return hasOnlyKeys(value, ['type', 'moveType']) && isMoveType(value.moveType)
        ? { type: value.type, moveType: value.moveType }
        : null
    case 'setInspectorActionMode':
      return hasOnlyKeys(value, ['type', 'mode']) && isActionMode(value.mode)
        ? { type: value.type, mode: value.mode }
        : null
    case 'confirmDiscoveries':
    case 'continueHandoff':
    case 'confirmJackMove':
    case 'newGame':
      return hasOnlyKeys(value, ['type']) ? { type: value.type } : null
    default:
      return null
  }
}

export const parseOnlineHistoryCommand = (value: unknown): HistoryCommand | null => {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  if (value.type === 'apply') {
    const action = parseOnlineGameAction(value.action)
    return hasOnlyKeys(value, ['type', 'action']) && action ? { type: 'apply', action } : null
  }
  if (value.type === 'undo' || value.type === 'bigUndo' || value.type === 'redo' || value.type === 'redoAll' || value.type === 'revealUndo') {
    return hasOnlyKeys(value, ['type']) ? { type: value.type } : null
  }
  return null
}

export const parseOnlineClientMessage = (text: string): OnlineClientMessage | null => {
  if (new TextEncoder().encode(text).byteLength > MAX_SOCKET_MESSAGE_BYTES) return null
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(value) || value.protocolVersion !== ONLINE_PROTOCOL_VERSION || typeof value.type !== 'string') return null
  if (value.type === 'authenticate') {
    return hasOnlyKeys(value, ['type', 'protocolVersion', 'token']) &&
      typeof value.token === 'string' && value.token.length >= 40 && value.token.length <= 128
      ? { type: 'authenticate', protocolVersion: ONLINE_PROTOCOL_VERSION, token: value.token }
      : null
  }
  if (
    typeof value.requestId !== 'string' || value.requestId.length < 8 || value.requestId.length > 80 ||
    !Number.isInteger(value.expectedRevision) || Number(value.expectedRevision) < 0 ||
    typeof value.expectedHistoryHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedHistoryHash)
  ) return null
  const common = {
    protocolVersion: ONLINE_PROTOCOL_VERSION, requestId: value.requestId,
    expectedRevision: Number(value.expectedRevision), expectedHistoryHash: value.expectedHistoryHash,
  } as const
  const commonKeys = ['type', ...Object.keys(common)]
  if (value.type !== 'command') {
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
    if (!uuid.test(value.requestId)) return null
    if (value.type === 'request-undo' && hasOnlyKeys(value, commonKeys)) return { ...common, type: 'request-undo' }
    if (typeof value.undoRequestId !== 'string' || !uuid.test(value.undoRequestId)) return null
    if (value.type === 'cancel-undo' && hasOnlyKeys(value, [...commonKeys, 'undoRequestId'])) return { ...common, type: 'cancel-undo', undoRequestId: value.undoRequestId }
    if (value.type === 'decide-undo' && hasOnlyKeys(value, [...commonKeys, 'undoRequestId', 'decision']) &&
      (value.decision === 'approve' || value.decision === 'deny')) return { ...common, type: 'decide-undo', undoRequestId: value.undoRequestId, decision: value.decision }
    return null
  }
  if (!hasOnlyKeys(value, [...commonKeys, 'commands']) || !Array.isArray(value.commands) ||
    value.commands.length < 1 || value.commands.length > MAX_COMMANDS_PER_MESSAGE) return null
  const commands = value.commands.map(parseOnlineHistoryCommand)
  if (commands.some((command) => command === null)) return null
  return {
    type: 'command',
    protocolVersion: ONLINE_PROTOCOL_VERSION,
    requestId: value.requestId,
    expectedRevision: Number(value.expectedRevision),
    expectedHistoryHash: value.expectedHistoryHash,
    commands: commands as HistoryCommand[],
  }
}

const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]))
}

export const canonicalJson = (value: unknown): string => JSON.stringify(canonicalValue(value))

export const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const onlineHistoryHash = (history: OnlineHistoryWire): Promise<string> =>
  sha256Hex(canonicalJson(history))

export const onlineHistoryToWire = (history: GameHistory): OnlineHistoryWire => {
  const actions = history.entries.slice(1).map((entry) => {
    if (!entry.action) throw new Error('Online history contains an entry without an action.')
    return entry.action
  })
  return {
    rulesVersion: ONLINE_RULES_VERSION,
    actions,
    cursor: history.cursor,
    pendingReveal: history.pendingReveal,
    state: currentHistoryState(history),
  }
}

export const onlineHistoryFromWire = (value: unknown): GameHistory | null => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['rulesVersion', 'actions', 'cursor', 'pendingReveal', 'state'])) return null
  if (value.rulesVersion !== ONLINE_RULES_VERSION || !Array.isArray(value.actions) || value.actions.length > MAX_ONLINE_ACTIONS) return null
  if (!Number.isInteger(value.cursor) || Number(value.cursor) < 0 || Number(value.cursor) > value.actions.length) return null
  if (value.pendingReveal !== null && value.pendingReveal !== 'jack' && value.pendingReveal !== 'investigators') return null
  if (!isStoredGameState(value.state)) return null
  const actions = value.actions.map(parseOnlineGameAction)
  if (actions.some((action) => action === null)) return null

  let history = createGameHistory(createInitialGame())
  for (const action of actions as GameAction[]) {
    const next = gameHistoryReducer(history, { type: 'apply', action })
    if (next === history || action.type === 'newGame') return null
    history = next
  }
  history = {
    ...history,
    cursor: Number(value.cursor),
    pendingReveal: value.pendingReveal as PlayerView | null,
  }
  if (canonicalJson(currentHistoryState(history)) !== canonicalJson(value.state)) return null
  return history
}

export const createOnlineSnapshot = async (
  roomId: string,
  revision: number,
  history: GameHistory,
): Promise<OnlineSnapshot> => {
  const wire = onlineHistoryToWire(history)
  return {
    protocolVersion: ONLINE_PROTOCOL_VERSION,
    roomId,
    revision,
    historyHash: await onlineHistoryHash(wire),
    history: wire,
  }
}

export const verifyOnlineSnapshot = async (value: unknown): Promise<{ snapshot: OnlineSnapshot; history: GameHistory } | null> => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['protocolVersion', 'roomId', 'revision', 'historyHash', 'history'])) return null
  if (
    value.protocolVersion !== ONLINE_PROTOCOL_VERSION || typeof value.roomId !== 'string' || value.roomId.length < 16 ||
    !Number.isInteger(value.revision) || Number(value.revision) < 0 ||
    typeof value.historyHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.historyHash)
  ) return null
  const history = onlineHistoryFromWire(value.history)
  if (!history || await onlineHistoryHash(value.history as OnlineHistoryWire) !== value.historyHash) return null
  return { snapshot: value as unknown as OnlineSnapshot, history }
}

export const onlineTurnStart = (history: GameHistory, role: PlayerView): number => {
  let cursor = history.cursor
  while (cursor > 0 && playerViewForState(history.entries[cursor]!.state) !== role) cursor -= 1
  while (cursor > 0 && playerViewForState(history.entries[cursor - 1]!.state) === role) cursor -= 1
  return cursor
}
