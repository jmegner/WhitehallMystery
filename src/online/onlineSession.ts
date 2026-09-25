import type { GameHistory, HistoryCommand, PlayerView } from '../game/history'
import { consistentUndoTransition, isOnlineUndoState, type OnlineUndoCommand, type OnlineUndoState } from '../game/onlineUndo'
import { isOnlineSeats, opponentRole, type OnlineSeats, type OnlineSessionRequest } from '../game/onlineSeats'
import { isGameName } from '../game/gameName'
import {
  MAX_COMMANDS_PER_MESSAGE,
  ONLINE_PROTOCOL_VERSION,
  verifyOnlineSnapshot,
  type OnlineServerMessage,
  type OnlineSnapshot,
} from '../game/onlineProtocol'

export const ONLINE_SESSION_STORAGE_KEY = 'whitehall-mystery.online.v1'

export interface OnlineSession {
  apiBase: string
  roomId: string
  role: PlayerView
  token: string
  investigatorsToken?: string
  startedAt?: number
  opponentInvitation?: { token: string; generation: number }
}

export interface OnlineStoreState {
  status: 'connecting' | 'connected' | 'reconnecting' | 'error'
  history: GameHistory | null
  snapshot: OnlineSnapshot | null
  undo: OnlineUndoState | null
  undoSupported: boolean
  createdAt: number | null
  seats: OnlineSeats | null
  name: string | undefined
  pendingRequestId: string | null
  error: string
  presence: { jack: boolean; investigators: boolean }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const validRoomId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

const validToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)

const normalizeApiBase = (value: string) => value.trim().replace(/\/+$/, '')

export const configuredOnlineApi = (): string => {
  const configured = normalizeApiBase(import.meta.env.VITE_MULTIPLAYER_API ?? '')
  return configured || (import.meta.env.DEV ? 'http://127.0.0.1:8787' : '')
}

export const parseOnlineSession = (value: unknown): OnlineSession | null => {
  if (!isRecord(value) || typeof value.apiBase !== 'string' || !validRoomId(value.roomId) || !validToken(value.token)) return null
  if (value.role !== 'jack' && value.role !== 'investigators') return null
  if (value.investigatorsToken !== undefined && !validToken(value.investigatorsToken)) return null
  if (value.opponentInvitation !== undefined && (!isRecord(value.opponentInvitation) || !validToken(value.opponentInvitation.token) || !Number.isSafeInteger(value.opponentInvitation.generation) || Number(value.opponentInvitation.generation) < 0)) return null
  return {
    apiBase: normalizeApiBase(value.apiBase),
    roomId: value.roomId,
    role: value.role,
    token: value.token,
    ...(value.investigatorsToken ? { investigatorsToken: value.investigatorsToken } : {}),
    ...(value.opponentInvitation ? { opponentInvitation: value.opponentInvitation as OnlineSession['opponentInvitation'] } : {}),
    ...(typeof value.startedAt === 'number' && Number.isSafeInteger(value.startedAt) && value.startedAt > 0 && value.startedAt <= 8.64e15 ? { startedAt: value.startedAt } : {}),
  }
}

export const onlineInviteUrl = (session: OnlineSession, location = window.location.href): string => {
  const token = session.opponentInvitation?.token ?? (session.role === 'jack' ? session.investigatorsToken : undefined)
  if (!token) throw new Error('This session does not have an opponent invitation.')
  const url = new URL(location)
  url.search = ''
  url.hash = new URLSearchParams({ online: `${session.roomId}.${token}`, ...(session.role === 'investigators' ? { role: 'jack' } : {}) }).toString()
  return url.href
}

export const onlineSessionFromInvite = (input: string, apiBase = configuredOnlineApi()): OnlineSession | null => {
  if (!apiBase) return null
  let invitation = input.trim()
  let role: PlayerView = 'investigators'
  if (/^https?:\/\//i.test(invitation)) {
    try {
      const params = new URLSearchParams(new URL(invitation).hash.slice(1))
      invitation = params.get('online') ?? ''
      const invitedRole = params.get('role')
      if (invitedRole !== null && invitedRole !== 'jack' && invitedRole !== 'investigators') return null
      role = invitedRole ?? 'investigators'
    } catch {
      return null
    }
  }
  const separator = invitation.indexOf('.')
  if (separator < 0) return null
  const roomId = invitation.slice(0, separator)
  const token = invitation.slice(separator + 1)
  if (!validRoomId(roomId) || !validToken(token)) return null
  return { apiBase: normalizeApiBase(apiBase), roomId, role, token }
}

export const onlineSessionFromLocation = (): OnlineSession | null => {
  const invitation = new URLSearchParams(window.location.hash.slice(1)).get('online')
  return invitation ? onlineSessionFromInvite(window.location.href) : null
}

export class OnlineSessionHttpError extends Error {
  readonly status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

type SessionCommand = OnlineSessionRequest extends infer Request ? Request extends OnlineSessionRequest ? Omit<Request, 'token'> : never : never
async function sessionRequest(session: OnlineSession, message: SessionCommand, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = window.setTimeout(abort, 15000)
  try {
    const response = await fetch(`${session.apiBase}/v1/games/${session.roomId}/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...message, token: session.token }), signal: controller.signal,
    })
    const value: unknown = await response.json().catch(() => null)
    if (!response.ok) throw new OnlineSessionHttpError(response.status === 404 ? 'This feature needs the updated multiplayer Worker.' :
      isRecord(value) && typeof value.error === 'string' ? value.error : 'Could not contact the multiplayer service.', response.status)
    if (!isRecord(value)) throw new Error('Received a damaged multiplayer response.')
    return value
  } finally {
    window.clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

async function verifiedGameStatus(session: OnlineSession, message: Record<string, unknown>) {
  const verified = await verifyOnlineSnapshot(message.snapshot)
  if (message.type !== 'snapshot' || message.role !== session.role || !verified || verified.snapshot.roomId !== session.roomId ||
    !isOnlineSeats(message.seats, verified.snapshot.revision) || !isOnlineUndoState(message.undo, verified.history, verified.snapshot.revision) ||
    (message.name !== undefined && !isGameName(message.name)) ||
    typeof message.createdAt !== 'number' || !Number.isSafeInteger(message.createdAt) || message.createdAt <= 0 || message.createdAt > 8.64e15) throw new Error('Received a damaged or inconsistent game status.')
  return { ...verified, seats: message.seats, createdAt: message.createdAt, name: message.name as string | undefined }
}

export async function readOnlineGame(session: OnlineSession, signal?: AbortSignal) {
  return verifiedGameStatus(session, await sessionRequest(session, { type: 'status' }, signal))
}

export async function renameOnlineGame(session: OnlineSession, name: string, expectedName: string, requestId: string) {
  if (!isGameName(name) || !isGameName(expectedName)) throw new Error('Use a single-line game name of up to 80 characters.')
  const result = await verifiedGameStatus(session, await sessionRequest(session, { type: 'rename', name, expectedName, requestId }))
  if (result.name === undefined) throw new Error('Game names need the updated multiplayer Worker.')
  return result
}

export async function leaveOnlineGame(session: OnlineSession, requestId: string) {
  const result = await sessionRequest(session, { type: 'leave', requestId })
  if (result.ok !== true) throw new Error('The server did not acknowledge leaving the game.')
}

export async function inviteOnlineReplacement(session: OnlineSession, requestId: string) {
  const result = await sessionRequest(session, { type: 'invite', requestId })
  if (!validToken(result.token) || result.role !== opponentRole(session.role) || !Number.isSafeInteger(result.generation) || Number(result.generation) < 1) throw new Error('Received an invalid replacement invitation.')
  return { token: result.token, generation: Number(result.generation) }
}

export async function inviteOnlineRejoin(session: OnlineSession, requestId: string, expectedGeneration: number) {
  let result: Record<string, unknown>
  try {
    result = await sessionRequest(session, { type: 'reinvite', requestId, expectedGeneration })
  } catch (error) {
    if (error instanceof OnlineSessionHttpError && error.status === 400) throw new Error('Rejoin invitations need the updated multiplayer Worker.')
    throw error
  }
  if (!validToken(result.token) || result.role !== opponentRole(session.role) || !Number.isSafeInteger(result.generation) || Number(result.generation) <= expectedGeneration) {
    throw new Error('Received an invalid rejoin invitation.')
  }
  return { token: result.token, generation: Number(result.generation) }
}

export const createOnlineGame = async ({ role = 'jack', name = '' }: { role?: PlayerView; name?: string } = {}, apiBase = configuredOnlineApi()): Promise<OnlineSession> => {
  if (!apiBase) throw new Error('Online multiplayer is not configured for this deployment.')
  if (!isGameName(name)) throw new Error('Use a single-line game name of up to 80 characters.')
  const response = await fetch(`${normalizeApiBase(apiBase)}/v1/games`, { method: 'POST', ...(name ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) } : {}) })
  const value: unknown = await response.json().catch(() => null)
  if (!response.ok || !isRecord(value) || value.protocolVersion !== ONLINE_PROTOCOL_VERSION ||
    !validRoomId(value.roomId) || !validToken(value.jackToken) || !validToken(value.investigatorsToken)) {
    throw new Error(response.status === 429 ? 'Too many games were created from this network. Try again in a minute.' : 'Could not create an online game.')
  }
  return {
    apiBase: normalizeApiBase(apiBase),
    roomId: value.roomId,
    role,
    token: role === 'jack' ? value.jackToken : value.investigatorsToken,
    opponentInvitation: { token: role === 'jack' ? value.investigatorsToken : value.jackToken, generation: 0 },
    ...(typeof value.createdAt === 'number' && Number.isSafeInteger(value.createdAt) && value.createdAt > 0 && value.createdAt <= 8.64e15 ? { startedAt: value.createdAt } : {}),
  }
}

const socketUrl = (session: OnlineSession): string => {
  const url = new URL(`${session.apiBase}/v1/games/${session.roomId}/connect`)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.href
}

export class OnlineSessionStore {
  readonly session: OnlineSession
  private state: OnlineStoreState = {
    status: 'connecting',
    history: null,
    snapshot: null,
    undo: null,
    undoSupported: false,
    createdAt: null,
    seats: null,
    name: undefined,
    pendingRequestId: null,
    error: '',
    presence: { jack: false, investigators: false },
  }
  private listeners = new Set<() => void>()
  private socket: WebSocket | null = null
  private stopped = true
  private reconnectTimer: number | null = null
  private reconnectDelay = 500
  private snapshotSequence = 0

  constructor(session: OnlineSession) {
    this.session = session
  }

  readonly getSnapshot = () => this.state

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private update(patch: Partial<OnlineStoreState>) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  start() {
    if (!this.stopped) return () => this.stop()
    this.stopped = false
    this.connect()
    return () => this.stop()
  }

  stop() {
    this.stopped = true
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    const socket = this.socket
    this.socket = null
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Page closed.')
  }

  private connect() {
    if (this.stopped) return
    this.update({ status: this.state.history ? 'reconnecting' : 'connecting', error: '' })
    const socket = new WebSocket(socketUrl(this.session))
    this.socket = socket
    socket.addEventListener('open', () => {
      if (this.stopped || this.socket !== socket) {
        socket.close(1000, 'Superseded connection.')
        return
      }
      this.reconnectDelay = 500
      socket.send(JSON.stringify({
        type: 'authenticate',
        protocolVersion: ONLINE_PROTOCOL_VERSION,
        token: this.session.token,
      }))
    })
    socket.addEventListener('message', (event) => {
      if (this.socket === socket && typeof event.data === 'string') void this.receive(event.data)
    })
    socket.addEventListener('close', (event) => {
      if (this.socket !== socket) return
      this.socket = null
      if (this.stopped) return
      if (event.code === 4001 || event.code === 4003 || event.code === 4004 || event.code === 4005) {
        this.stopped = true
        this.update({ status: 'error', pendingRequestId: null, error: event.reason || 'The online game connection was closed.' })
        return
      }
      this.update({ status: 'reconnecting', pendingRequestId: null, error: 'Connection lost. Reconnecting…' })
      this.reconnectTimer = window.setTimeout(() => this.connect(), this.reconnectDelay)
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10_000)
    })
    socket.addEventListener('error', () => {
      if (!this.state.history) this.update({ error: 'Could not connect to the multiplayer service.' })
    })
  }

  private async receive(text: string) {
    let message: unknown
    try {
      message = JSON.parse(text)
    } catch {
      this.failCorruptMessage()
      return
    }
    if (!isRecord(message) || typeof message.type !== 'string') {
      this.failCorruptMessage()
      return
    }
    if (message.type === 'presence') {
      if (typeof message.jack !== 'boolean' || typeof message.investigators !== 'boolean') return this.failCorruptMessage()
      this.update({ presence: { jack: message.jack, investigators: message.investigators } })
      return
    }
    if (message.type === 'error') {
      const serverMessage = message as unknown as Extract<OnlineServerMessage, { type: 'error' }>
      this.update({ pendingRequestId: null, error: typeof serverMessage.message === 'string' ? serverMessage.message : 'The multiplayer service rejected a command.' })
      return
    }
    if (message.type !== 'snapshot') return this.failCorruptMessage()
    const sequence = ++this.snapshotSequence
    const verified = await verifyOnlineSnapshot(message.snapshot)
    if (sequence !== this.snapshotSequence) return
    if (!verified || verified.snapshot.roomId !== this.session.roomId) return this.failCorruptMessage()
    if (this.state.snapshot && verified.snapshot.revision < this.state.snapshot.revision) return
    const undoSupported = Object.hasOwn(message, 'undo')
    const undo = undoSupported ? message.undo : null
    if (!isOnlineUndoState(undo, verified.history, verified.snapshot.revision)) return this.failCorruptMessage()
    if (this.state.snapshot && this.state.undoSupported &&
      (!undoSupported || !consistentUndoTransition(this.state.snapshot, verified.snapshot, this.state.undo, undo))) return this.failCorruptMessage()
    const requestId = typeof message.requestId === 'string' ? message.requestId : null
    if (message.createdAt !== undefined && (typeof message.createdAt !== 'number' || !Number.isSafeInteger(message.createdAt) || message.createdAt <= 0 || message.createdAt > 8.64e15 ||
      (this.state.createdAt !== null && this.state.createdAt !== message.createdAt))) return this.failCorruptMessage()
    const seats = message.seats ?? null
    if (seats !== null && !isOnlineSeats(seats, verified.snapshot.revision)) return this.failCorruptMessage()
    if (this.state.seats && (seats === null || (this.state.snapshot?.revision === verified.snapshot.revision && JSON.stringify(this.state.seats) !== JSON.stringify(seats)))) return this.failCorruptMessage()
    const name = message.name
    if (name !== undefined && !isGameName(name)) return this.failCorruptMessage()
    if (this.state.name !== undefined && (name === undefined || (this.state.snapshot?.revision === verified.snapshot.revision && name !== this.state.name))) return this.failCorruptMessage()
    this.update({
      status: 'connected',
      history: verified.history,
      snapshot: verified.snapshot,
      undo,
      undoSupported,
      createdAt: typeof message.createdAt === 'number' ? message.createdAt : null,
      seats,
      name,
      pendingRequestId: requestId && requestId !== this.state.pendingRequestId ? this.state.pendingRequestId : null,
      error: '',
    })
  }

  private failCorruptMessage() {
    this.stopped = true
    this.socket?.close(1008, 'Invalid server message.')
    this.update({ status: 'error', pendingRequestId: null, error: 'Received a damaged or inconsistent game state. The connection was stopped.' })
  }

  sendCommands(commands: HistoryCommand[]) {
    if (!commands.length || this.state.undo?.status === 'pending') return
    if (commands.length > MAX_COMMANDS_PER_MESSAGE) {
      this.update({ error: 'That operation produced too many commands. Make the moves in smaller steps.' })
      return
    }
    this.sendMutation({ type: 'command', commands })
  }

  sendUndo(command: OnlineUndoCommand) {
    if (this.state.undoSupported) this.sendMutation(command)
  }

  private sendMutation(command: { type: 'command'; commands: HistoryCommand[] } | OnlineUndoCommand) {
    const socket = this.socket
    const snapshot = this.state.snapshot
    if (!snapshot || this.state.pendingRequestId || this.state.status !== 'connected' || socket?.readyState !== WebSocket.OPEN) return
    const requestId = crypto.randomUUID()
    socket.send(JSON.stringify({
      ...command,
      protocolVersion: ONLINE_PROTOCOL_VERSION,
      requestId,
      expectedRevision: snapshot.revision,
      expectedHistoryHash: snapshot.historyHash,
    }))
    this.update({ pendingRequestId: requestId, error: '' })
  }
}
