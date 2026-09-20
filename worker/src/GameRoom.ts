import { DurableObject } from 'cloudflare:workers'
import { createInitialGame } from '../../src/game/gameEngine'
import { normalizeRemoteHistory, remoteHistoryReducer } from '../../src/game/remoteHistory'
import { applyOnlineUndo, isOnlineUndoState, type OnlineUndoState } from '../../src/game/onlineUndo'
import {
  MAX_ONLINE_ACTIONS,
  ONLINE_PROTOCOL_VERSION,
  canonicalJson,
  createOnlineSnapshot,
  onlineTurnStart,
  parseOnlineClientMessage,
  sha256Hex,
  verifyOnlineSnapshot,
  type OnlineServerMessage,
  type OnlineSnapshot,
  type OnlineMutation,
} from '../../src/game/onlineProtocol'
import {
  createGameHistory,
  currentHistoryState,
  playerViewForState,
  type GameHistory,
  type HistoryCommand,
  type PlayerView,
} from '../../src/game/history'
import { fixedTimeEqual } from './security'
import type { WorkerEnv } from './env'

const ROOM_KEY = 'room'
const ROOM_SCHEMA_VERSION = 1
const COMMAND_WINDOW_MS = 10_000
const COMMANDS_PER_WINDOW = 20
const MAX_STORED_HISTORY_BYTES = 512 * 1024
const MAX_PROCESSED_REQUESTS = 128

interface RoomRecord {
  schemaVersion: typeof ROOM_SCHEMA_VERSION
  roomId: string
  jackTokenHash: string
  investigatorsTokenHash: string
  revision: number
  snapshot: OnlineSnapshot
  // Optional so existing rooms remain usable without a migration or reset.
  undo?: OnlineUndoState | null
  processedRequestIds: string[]
  recentCommands: Record<PlayerView, number[]>
  recentCommandsByIp: Record<string, number[]>
  createdAt: number
  updatedAt: number
  expiresAt: number
}

interface SocketAttachment {
  authenticated: boolean
  ip: string
  role?: PlayerView
}

const json = (value: unknown, status = 200): Response =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })

const send = (socket: WebSocket, message: OnlineServerMessage) => {
  try {
    socket.send(JSON.stringify(message))
  } catch {
    socket.close(1011, 'Could not send game update.')
  }
}

const historiesEqual = (left: GameHistory, right: GameHistory) =>
  canonicalJson(left) === canonicalJson(right)

const forbiddenClientCommand = (command: HistoryCommand): boolean =>
  command.type === 'revealUndo' ||
  (command.type === 'apply' && (command.action.type === 'continueHandoff' || command.action.type === 'newGame'))

export class GameRoom extends DurableObject<WorkerEnv> {
  private commandQueue: Promise<void> = Promise.resolve()

  private roomLifetimeMs() {
    const days = Number(this.env.ROOM_TTL_DAYS)
    return (Number.isFinite(days) && days >= 1 && days <= 365 ? days : 45) * 24 * 60 * 60 * 1000
  }

  private async room(): Promise<RoomRecord | null> {
    return await this.ctx.storage.get<RoomRecord>(ROOM_KEY) ?? null
  }

  private async persist(record: RoomRecord) {
    await this.ctx.storage.put(ROOM_KEY, record)
    await this.ctx.storage.setAlarm(record.expiresAt)
  }

  private async initialize(request: Request): Promise<Response> {
    if (await this.room()) return json({ error: 'Room already initialized.' }, 409)
    let value: unknown
    try {
      value = await request.json()
    } catch {
      return json({ error: 'Invalid initialization.' }, 400)
    }
    if (
      typeof value !== 'object' || value === null || Array.isArray(value) ||
      typeof (value as Record<string, unknown>).roomId !== 'string' ||
      typeof (value as Record<string, unknown>).jackTokenHash !== 'string' ||
      typeof (value as Record<string, unknown>).investigatorsTokenHash !== 'string'
    ) return json({ error: 'Invalid initialization.' }, 400)
    const { roomId, jackTokenHash, investigatorsTokenHash } = value as Record<string, string>
    if (!/^[a-f0-9]{64}$/.test(roomId) || !/^[a-f0-9]{64}$/.test(jackTokenHash) || !/^[a-f0-9]{64}$/.test(investigatorsTokenHash)) {
      return json({ error: 'Invalid initialization.' }, 400)
    }
    const now = Date.now()
    const snapshot = await createOnlineSnapshot(roomId, 0, createGameHistory(createInitialGame()))
    const record: RoomRecord = {
      schemaVersion: ROOM_SCHEMA_VERSION,
      roomId,
      jackTokenHash,
      investigatorsTokenHash,
      revision: 0,
      snapshot,
      processedRequestIds: [],
      recentCommands: { jack: [], investigators: [] },
      recentCommandsByIp: {},
      createdAt: now,
      updatedAt: now,
      expiresAt: now + this.roomLifetimeMs(),
    }
    await this.persist(record)
    return json({ ok: true }, 201)
  }

  private async openSocket(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket upgrade.', { status: 426 })
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    const attachment: SocketAttachment = {
      authenticated: false,
      ip: request.headers.get('X-Whitehall-Client-IP') ?? 'unknown',
    }
    server.serializeAttachment(attachment)
    this.ctx.acceptWebSocket(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  override async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname
    if (pathname === '/initialize' && request.method === 'POST') return this.initialize(request)
    if (pathname === '/connect' && request.method === 'GET') return this.openSocket(request)
    return new Response('Not found.', { status: 404 })
  }

  private authenticatedSockets(): Array<{ socket: WebSocket; attachment: SocketAttachment }> {
    return this.ctx.getWebSockets().flatMap((socket) => {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null
      return attachment?.authenticated && attachment.role ? [{ socket, attachment }] : []
    })
  }

  private broadcastPresence() {
    const connected = new Set(this.authenticatedSockets().map(({ attachment }) => attachment.role))
    const message: OnlineServerMessage = {
      type: 'presence',
      jack: connected.has('jack'),
      investigators: connected.has('investigators'),
    }
    for (const { socket } of this.authenticatedSockets()) send(socket, message)
  }

  private snapshotMessage(record: RoomRecord, requestId?: string): OnlineServerMessage {
    return { type: 'snapshot', ...(requestId ? { requestId } : {}), snapshot: record.snapshot, undo: record.undo ?? null }
  }

  private broadcastSnapshot(record: RoomRecord, requestId?: string) {
    const message = this.snapshotMessage(record, requestId)
    for (const { socket } of this.authenticatedSockets()) send(socket, message)
  }

  private async authenticate(socket: WebSocket, token: string) {
    const record = await this.room()
    if (!record || record.expiresAt <= Date.now()) {
      send(socket, { type: 'error', code: 'authentication', message: 'The game credential is invalid or the game has expired.' })
      socket.close(4003, 'Authentication failed.')
      return
    }
    const verified = await verifyOnlineSnapshot(record.snapshot)
    if (!verified || !isOnlineUndoState(record.undo ?? null, verified.history, record.revision)) {
      send(socket, { type: 'error', code: 'server-error', message: 'The stored game state failed its consistency check.' })
      socket.close(1011, 'Stored game is inconsistent.')
      return
    }
    const hash = await sha256Hex(token)
    const role = fixedTimeEqual(hash, record.jackTokenHash)
      ? 'jack'
      : fixedTimeEqual(hash, record.investigatorsTokenHash)
        ? 'investigators'
        : null
    if (!role) {
      send(socket, { type: 'error', code: 'authentication', message: 'The game credential is invalid or the game has expired.' })
      socket.close(4003, 'Authentication failed.')
      return
    }
    for (const { socket: existing, attachment } of this.authenticatedSockets()) {
      if (attachment.role === role && existing !== socket) existing.close(4001, 'This role connected on another tab or device.')
    }
    const previous = socket.deserializeAttachment() as SocketAttachment | null
    socket.serializeAttachment({ authenticated: true, ip: previous?.ip ?? 'unknown', role } satisfies SocketAttachment)
    send(socket, this.snapshotMessage(record))
    this.broadcastPresence()
  }

  private rateAllowed(record: RoomRecord, role: PlayerView, ipHash: string, now: number): boolean {
    const recent = record.recentCommands[role].filter((timestamp) => timestamp > now - COMMAND_WINDOW_MS)
    record.recentCommands[role] = recent
    record.recentCommandsByIp ??= {}
    for (const [key, timestamps] of Object.entries(record.recentCommandsByIp)) {
      const active = timestamps.filter((timestamp) => timestamp > now - COMMAND_WINDOW_MS)
      if (active.length > 0) record.recentCommandsByIp[key] = active
      else delete record.recentCommandsByIp[key]
    }
    const recentForIp = record.recentCommandsByIp[ipHash] ?? []
    if (recent.length >= COMMANDS_PER_WINDOW || recentForIp.length >= COMMANDS_PER_WINDOW) return false
    recent.push(now)
    recentForIp.push(now)
    record.recentCommandsByIp[ipHash] = recentForIp
    return true
  }

  private async applyCommands(socket: WebSocket, role: PlayerView, ip: string, message: OnlineMutation) {
    const record = await this.room()
    if (!record || record.expiresAt <= Date.now()) {
      send(socket, { type: 'error', requestId: message.requestId, code: 'room-expired', message: 'This game has expired.' })
      socket.close(4004, 'Game expired.')
      return
    }
    const now = Date.now()
    const rateAllowed = this.rateAllowed(record, role, await sha256Hex(ip), now)
    await this.persist(record)
    if (!rateAllowed) {
      send(socket, { type: 'error', requestId: message.requestId, code: 'rate-limited', message: 'Too many game commands. Wait a few seconds.' })
      return
    }
    if (record.processedRequestIds.includes(message.requestId)) {
      send(socket, this.snapshotMessage(record, message.requestId))
      return
    }
    if (message.expectedRevision !== record.revision || message.expectedHistoryHash !== record.snapshot.historyHash) {
      send(socket, { type: 'error', requestId: message.requestId, code: 'conflict', message: 'Your game was out of date and has been refreshed.' })
      send(socket, this.snapshotMessage(record))
      return
    }
    const verified = await verifyOnlineSnapshot(record.snapshot)
    if (!verified || !isOnlineUndoState(record.undo ?? null, verified.history, record.revision)) {
      send(socket, { type: 'error', requestId: message.requestId, code: 'server-error', message: 'The stored game state failed its consistency check.' })
      return
    }
    let history = verified.history
    let undo = record.undo ?? null
    if (message.type !== 'command') {
      try {
        const result = applyOnlineUndo(history, undo, role, message, message.requestId, record.revision + 1)
        history = result.history
        undo = result.undo
      } catch (error) {
        send(socket, { type: 'error', requestId: message.requestId, code: 'invalid-command', message: error instanceof Error ? error.message : 'Invalid undo request.' })
        return
      }
    } else {
      if (undo?.status === 'pending' || playerViewForState(currentHistoryState(history)) !== role) {
        send(socket, { type: 'error', requestId: message.requestId, code: 'invalid-command', message: undo?.status === 'pending' ? 'Resolve the undo request before making moves.' : 'It is not your turn.' })
        return
      }
      const turnStart = onlineTurnStart(history, role)
      for (const command of message.commands) {
        // A batch may end a turn, but may not then undo across that boundary.
        if (playerViewForState(currentHistoryState(history)) !== role) {
          send(socket, { type: 'error', requestId: message.requestId, code: 'invalid-command', message: 'A command batch cannot continue after your turn ends.' })
          return
        }
        if (forbiddenClientCommand(command)) {
          send(socket, { type: 'error', requestId: message.requestId, code: 'invalid-command', message: 'That command is not available in an online game.' })
          return
        }
        const next = normalizeRemoteHistory(remoteHistoryReducer(history, command, role, turnStart))
        if (historiesEqual(history, next)) {
          send(socket, { type: 'error', requestId: message.requestId, code: 'invalid-command', message: 'That command is not valid for the current game state.' })
          return
        }
        history = next
      }
    }
    if (history.entries.length - 1 > MAX_ONLINE_ACTIONS) {
      send(socket, { type: 'error', requestId: message.requestId, code: 'invalid-command', message: 'This game has reached its action limit.' })
      return
    }
    const snapshot = await createOnlineSnapshot(record.roomId, record.revision + 1, history)
    if (new TextEncoder().encode(JSON.stringify(snapshot.history)).byteLength > MAX_STORED_HISTORY_BYTES) {
      send(socket, { type: 'error', requestId: message.requestId, code: 'invalid-command', message: 'This game has reached its history size limit.' })
      return
    }
    record.revision += 1
    record.snapshot = snapshot
    record.undo = undo
    record.processedRequestIds = [...record.processedRequestIds, message.requestId].slice(-MAX_PROCESSED_REQUESTS)
    record.updatedAt = now
    record.expiresAt = now + this.roomLifetimeMs()
    await this.persist(record)
    this.broadcastSnapshot(record, message.requestId)
  }

  override webSocketMessage(socket: WebSocket, rawMessage: string | ArrayBuffer) {
    if (typeof rawMessage !== 'string') {
      socket.close(1003, 'Only JSON text messages are supported.')
      return
    }
    const message = parseOnlineClientMessage(rawMessage)
    if (!message) {
      send(socket, { type: 'error', code: 'invalid-command', message: 'Malformed multiplayer message.' })
      socket.close(1008, 'Malformed message.')
      return
    }
    const attachment = socket.deserializeAttachment() as SocketAttachment | null
    if (!attachment?.authenticated) {
      if (message.type !== 'authenticate' || message.protocolVersion !== ONLINE_PROTOCOL_VERSION) {
        socket.close(4003, 'Authenticate first.')
        return
      }
      this.commandQueue = this.commandQueue.then(() => this.authenticate(socket, message.token)).catch(() => {
        send(socket, { type: 'error', code: 'server-error', message: 'Could not authenticate.' })
        socket.close(1011, 'Server error.')
      })
      return
    }
    if (message.type === 'authenticate' || !attachment.role) {
      socket.close(1008, 'Unexpected message.')
      return
    }
    this.commandQueue = this.commandQueue.then(() => this.applyCommands(socket, attachment.role!, attachment.ip, message)).catch(() => {
      send(socket, { type: 'error', requestId: message.requestId, code: 'server-error', message: 'Could not apply the command.' })
    })
  }

  override webSocketClose() {
    this.broadcastPresence()
  }

  override async alarm() {
    const record = await this.room()
    if (!record) return
    if (record.expiresAt > Date.now()) {
      await this.ctx.storage.setAlarm(record.expiresAt)
      return
    }
    for (const socket of this.ctx.getWebSockets()) socket.close(4004, 'Game expired.')
    await this.ctx.storage.deleteAll()
  }
}
