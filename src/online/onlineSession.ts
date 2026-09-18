import type { GameHistory, HistoryCommand, PlayerView } from '../game/history'
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
}

export interface OnlineStoreState {
  status: 'connecting' | 'connected' | 'reconnecting' | 'error'
  history: GameHistory | null
  snapshot: OnlineSnapshot | null
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

export const saveOnlineSession = (session: OnlineSession | null) => {
  try {
    if (session) localStorage.setItem(ONLINE_SESSION_STORAGE_KEY, JSON.stringify(session))
    else localStorage.removeItem(ONLINE_SESSION_STORAGE_KEY)
  } catch {
    // The connection still works when private browsing makes storage unavailable.
  }
}

export const loadOnlineSession = (): OnlineSession | null => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(ONLINE_SESSION_STORAGE_KEY) ?? 'null')
    if (!isRecord(value) || typeof value.apiBase !== 'string' || !validRoomId(value.roomId) || !validToken(value.token)) return null
    if (value.role !== 'jack' && value.role !== 'investigators') return null
    if (value.investigatorsToken !== undefined && !validToken(value.investigatorsToken)) return null
    return {
      apiBase: normalizeApiBase(value.apiBase),
      roomId: value.roomId,
      role: value.role,
      token: value.token,
      ...(value.investigatorsToken ? { investigatorsToken: value.investigatorsToken } : {}),
    }
  } catch {
    return null
  }
}

export const onlineInviteUrl = (session: OnlineSession, location = window.location.href): string => {
  if (!session.investigatorsToken) throw new Error('This session does not have an investigator invitation.')
  const url = new URL(location)
  url.search = ''
  url.hash = new URLSearchParams({ online: `${session.roomId}.${session.investigatorsToken}` }).toString()
  return url.href
}

export const onlineSessionFromInvite = (input: string, apiBase = configuredOnlineApi()): OnlineSession | null => {
  if (!apiBase) return null
  let invitation = input.trim()
  if (/^https?:\/\//i.test(invitation)) {
    try {
      invitation = new URLSearchParams(new URL(invitation).hash.slice(1)).get('online') ?? ''
    } catch {
      return null
    }
  }
  const separator = invitation.indexOf('.')
  if (separator < 0) return null
  const roomId = invitation.slice(0, separator)
  const token = invitation.slice(separator + 1)
  if (!validRoomId(roomId) || !validToken(token)) return null
  return { apiBase: normalizeApiBase(apiBase), roomId, role: 'investigators', token }
}

export const onlineSessionFromLocation = (): OnlineSession | null => {
  const invitation = new URLSearchParams(window.location.hash.slice(1)).get('online')
  return invitation ? onlineSessionFromInvite(invitation) : null
}

export const createOnlineGame = async (apiBase = configuredOnlineApi()): Promise<OnlineSession> => {
  if (!apiBase) throw new Error('Online multiplayer is not configured for this deployment.')
  const response = await fetch(`${normalizeApiBase(apiBase)}/v1/games`, { method: 'POST' })
  const value: unknown = await response.json().catch(() => null)
  if (!response.ok || !isRecord(value) || value.protocolVersion !== ONLINE_PROTOCOL_VERSION ||
    !validRoomId(value.roomId) || !validToken(value.jackToken) || !validToken(value.investigatorsToken)) {
    throw new Error(response.status === 429 ? 'Too many games were created from this network. Try again in a minute.' : 'Could not create an online game.')
  }
  return {
    apiBase: normalizeApiBase(apiBase),
    roomId: value.roomId,
    role: 'jack',
    token: value.jackToken,
    investigatorsToken: value.investigatorsToken,
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
      if (event.code === 4001 || event.code === 4003 || event.code === 4004) {
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
    const requestId = typeof message.requestId === 'string' ? message.requestId : null
    this.update({
      status: 'connected',
      history: verified.history,
      snapshot: verified.snapshot,
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
    const socket = this.socket
    const snapshot = this.state.snapshot
    if (!commands.length || !snapshot || this.state.pendingRequestId || socket?.readyState !== WebSocket.OPEN) return
    if (commands.length > MAX_COMMANDS_PER_MESSAGE) {
      this.update({ error: 'That operation produced too many commands. Make the moves in smaller steps.' })
      return
    }
    const requestId = crypto.randomUUID()
    socket.send(JSON.stringify({
      type: 'command',
      protocolVersion: ONLINE_PROTOCOL_VERSION,
      requestId,
      expectedRevision: snapshot.revision,
      expectedHistoryHash: snapshot.historyHash,
      commands,
    }))
    this.update({ pendingRequestId: requestId, error: '' })
  }
}
