import { createInitialGame } from './gameEngine'
import { createGameHistory, currentHistoryState, gameHistoryReducer, playerViewForState, type GameHistory, type GameHistoryEntry, type HistoryCommand, type PlayerView } from './history'
import type { GameAction, JackMoveType } from './types'

// Wire v1 freezes this crossing order. Changing the map requires a new version.
const crossingIds = 'BB BC BD BF BG BH BJ BK BL BM BN BP BQ BR BS BT BV BW BX BY BZ CB CC CD CF CG CH CJ CK CL CM CN CP CQ CR CS CT CV CW CX CY CZ DB DC DD DF DG DH DJ DK DL DM DN DP DQ DR DS DT DV DW DX DY DZ FB FC FD FF FG FH FJ FK FL FM FN FP FQ FR FS FT FV FW FX FY FZ GB GC GD GF GG GH GJ GK GL GM GN GP GQ GR GS GT GV GW GX GY GZ HB HC HD HF HG HH HJ HK HL HM HN HP HQ HR HS HT HV HW HX HY HZ JB JC JD JF JG JH JJ JK JL JM JN JP JQ JR JS JT JV JW JX JY JZ KB KC KD KF KG KH KJ KK KL KM KN KP KQ KR KS KT KV KW KX KY KZ LB LC LD LF LG LH'.split(' ')
const moveTypes: JackMoveType[] = ['normal', 'coach', 'alley', 'boat']
export const MAIL_STORAGE_KEY = 'whitehall-mystery.by-mail.v1'
export const otherPlayer = (role: PlayerView): PlayerView => role === 'jack' ? 'investigators' : 'jack'
export const mailTimestamp = (id: number, timeZone?: string): string => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
  }).formatToParts(new Date(id * 1000)).map(({ type, value }) => [type, value]))
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.timeZoneName}`
}
const fail = (): never => { throw new Error('Invalid or damaged By Mail text. Copy the complete message again.') }

export function normalizeMailHistory(history: GameHistory): GameHistory {
  for (let i = 0; i < 4; i++) {
    const stage = currentHistoryState(history).stage
    if (!stage.startsWith('handoff') && stage !== 'investigatorSetupResult' && stage !== 'investigatorTurnResult') break
    history = gameHistoryReducer(history, { type: 'apply', action: { type: 'continueHandoff' } })
  }
  return history
}

function mailEntryBytes(entry: GameHistoryEntry, previous: GameHistoryEntry): number[] {
  const { action, state } = entry
  const before = previous.state
  if (!action) return []
  switch (action.type) {
    case 'confirmDiscoveries':
      return state.stage !== before.stage ? state.discoveryLocations : []
    case 'placeInvestigator':
    case 'moveInvestigator':
      return state.investigatorPositions !== before.investigatorPositions ? [crossingIds.indexOf(action.crossingId)] : []
    case 'chooseJackStart': return [action.circleId]
    case 'confirmJackMove':
      return state.stage !== before.stage ? [moveTypes.indexOf(before.jackMoveSelection.type), ...before.jackMoveSelection.path] : []
    case 'searchCircle': return [action.circleId]
    case 'arrestCircle': return [190, action.circleId]
    case 'passInspectorAction': return [0]
    default: return []
  }
}

export function mailBytes(history: GameHistory): number[] {
  return history.entries.slice(1, history.cursor + 1).flatMap((entry, i) => mailEntryBytes(entry, history.entries[i]!))
}

// Count player turns, not move-track slots, individual searches, or setup actions.
function addedTurnCount(history: GameHistory, previousByteCount: number): number {
  let byteCount = 0
  let turns = 0
  let lastOwner: PlayerView | null = null
  for (let i = 1; i <= history.cursor; i++) {
    const previous = history.entries[i - 1]!
    const bytes = mailEntryBytes(history.entries[i]!, previous)
    if (byteCount >= previousByteCount && bytes.length > 0) {
      const owner = playerViewForState(previous.state)
      if (owner && owner !== lastOwner) {
        turns++
        lastOwner = owner
      }
    }
    byteCount += bytes.length
  }
  return turns
}

function checksum(bytes: number[]): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
const uint32 = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const read32 = (a: number[]) => ((a[0]! << 24) | (a[1]! << 16) | (a[2]! << 8) | a[3]!) >>> 0
function obscure(bytes: number[], id: number): number[] {
  let seed = id ^ 0x9e3779b9
  return bytes.map(byte => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
    return byte ^ (seed & 255)
  })
}

export function encodeMail(id: number, recipient: PlayerView, history: GameHistory, endedAt: number | null = null): string {
  if (endedAt !== null && (!Number.isInteger(endedAt) || endedAt < 0 || endedAt > 0xffffffff)) fail()
  const header = (endedAt === null ? 2 : 4) + (recipient === 'jack' ? 0 : 1)
  const body = [header, ...(endedAt === null ? [] : uint32(endedAt)), ...mailBytes(history)]
  const raw = [...uint32(id), ...obscure([...body, ...uint32(checksum([...uint32(id), ...body]))], id)]
  const payload = btoa(String.fromCharCode(...raw)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  return `${String(mailTurns(history).length).padStart(2, '0')}-${payload}`
}

export function mailTextFromInput(input: string): string {
  const trimmed = input.trim()
  if (/^https?:\/\//i.test(trimmed)) {
    try { return new URLSearchParams(new URL(trimmed).hash.slice(1)).get('mail') ?? fail() } catch { return fail() }
  }
  return trimmed.replace(/\s/g, '')
}

export function isMailBoundary(history: GameHistory): boolean {
  const s = currentHistoryState(history)
  return s.discoveryLocations.length === 4 && (
    s.stage === 'gameOver' || s.stage === 'jackChooseStart' ||
    (s.stage === 'jackMove' && s.jackMoveSelection.path.length === 0) ||
    ((s.stage === 'investigatorSetup' || s.stage === 'investigatorMove') && s.activeInvestigator === 0)
  )
}

function decodeMailPayload(text: string): { id: number; role: PlayerView; history: GameHistory; endedAt: number | null } {
  if (text.length > 8192 || text.length < 18 || !/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) fail()
  let raw: number[]
  try { raw = Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)) } catch { return fail() }
  const id = read32(raw.slice(0, 4))
  const payload = obscure(raw.slice(4), id)
  const body = payload.slice(0, -4)
  if (checksum([...uint32(id), ...body]) !== read32(payload.slice(-4))) fail()
  if (![2, 3, 4, 5].includes(body[0]!)) throw new Error('This By Mail format is not supported. Update the app on both devices.')
  const role: PlayerView = body[0]! % 2 === 0 ? 'jack' : 'investigators'
  const endedAt = body[0]! >= 4 ? read32(body.slice(1, 5)) : null
  const data = body.slice(endedAt === null ? 1 : 5)
  let cursor = 0
  let history = createGameHistory(createInitialGame())
  const read = () => data[cursor++] ?? fail()
  const apply = (action: GameAction) => {
    const before = currentHistoryState(history)
    history = gameHistoryReducer(history, { type: 'apply', action })
    const after = currentHistoryState(history)
    if (action.type !== 'setJackMoveType' && action.type !== 'setInspectorActionMode' &&
      JSON.stringify({ ...before, notice: '' }) === JSON.stringify({ ...after, notice: '' })) fail()
  }
  for (let i = 0; i < 4; i++) apply({ type: 'toggleDiscovery', circleId: read() })
  apply({ type: 'confirmDiscoveries' })
  history = normalizeMailHistory(history)
  while (cursor < data.length) {
    const state = currentHistoryState(history)
    if (state.stage === 'investigatorSetup' || state.stage === 'investigatorMove') {
      const crossingId = crossingIds[read()] ?? fail()
      apply({ type: state.stage === 'investigatorSetup' ? 'placeInvestigator' : 'moveInvestigator', crossingId })
    } else if (state.stage === 'jackChooseStart') {
      apply({ type: 'chooseJackStart', circleId: read() })
    } else if (state.stage === 'jackMove') {
      const moveType = moveTypes[read()] ?? fail()
      apply({ type: 'setJackMoveType', moveType })
      apply({ type: 'selectJackDestination', circleId: read() })
      if (moveType === 'coach') apply({ type: 'selectJackDestination', circleId: read() })
      apply({ type: 'confirmJackMove' })
    } else if (state.stage === 'investigatorAction') {
      const value = read()
      if (value === 0) apply({ type: 'passInspectorAction' })
      else {
        apply({ type: 'setInspectorActionMode', mode: value === 190 ? 'arrest' : 'search' })
        apply({ type: value === 190 ? 'arrestCircle' : 'searchCircle', circleId: value === 190 ? read() : value })
      }
    } else fail()
    history = normalizeMailHistory(history)
  }
  if (!isMailBoundary(history) || mailBytes(history).join(',') !== data.join(',')) fail()
  if (encodeMail(id, role, history, endedAt).slice(3) !== text) fail()
  return { id, role, history, endedAt }
}

export function decodeMail(input: string): ReturnType<typeof decodeMailPayload> {
  const text = mailTextFromInput(input)
  if (!/^\d{2}-/.test(text)) {
    throw new Error('By Mail text must start with a two-digit turn number and a hyphen, such as 01-.')
  }
  const decoded = decodeMailPayload(text.slice(3))
  if (Number(text.slice(0, 2)) !== mailTurns(decoded.history).length) {
    throw new Error('The completed turn number does not match this game text. Copy the complete message again.')
  }
  return decoded
}

export function mailUrl(text: string, location = window.location.href): string {
  const url = new URL(location)
  url.search = ''
  url.hash = new URLSearchParams({ mail: text }).toString()
  return url.href
}

export function acceptMail(input: string, current: { id: number; role: PlayerView; history: GameHistory }) {
  const incoming = decodeMail(input)
  if (incoming.id !== current.id) throw new Error(`This is a different game (${mailTimestamp(incoming.id)}). Use New game → By Mail → Join existing game to switch games.`)
  if (incoming.role !== current.role) throw new Error('This message is addressed to the other player. Ask them for their latest game text.')
  const before = mailBytes(current.history)
  const after = mailBytes(incoming.history)
  if (after.length <= before.length) throw new Error('This message is already loaded or older than your game.')
  if (!before.every((byte, i) => after[i] === byte)) throw new Error('This message conflicts with your game history. Ask for the latest message from your partner.')
  if (playerViewForState(currentHistoryState(current.history)) === current.role) throw new Error('It is still your turn. Finish your turn before loading a reply.')
  const turnCount = addedTurnCount(incoming.history, before.length)
  return {
    ...incoming,
    updateNotice: turnCount > 1
      ? `This update includes ${turnCount} player turns since your last saved turn, including turns for your side. A normal reply adds only one opponent turn.`
      : null,
  }
}

export function mailTurnStart(history: GameHistory, role: PlayerView): number {
  let cursor = history.cursor
  while (cursor > 0 && playerViewForState(history.entries[cursor]!.state) !== role) cursor--
  while (cursor > 0 && playerViewForState(history.entries[cursor - 1]!.state) === role) cursor--
  return cursor
}

export function mailHistoryReducer(history: GameHistory, command: HistoryCommand, role: PlayerView, turnStart: number): GameHistory {
  if (command.type === 'redoAll') {
    let next = history
    while (next.cursor < next.entries.length - 1 && playerViewForState(currentHistoryState(next)) === role) {
      next = mailHistoryReducer(next, { type: 'redo' }, role, turnStart)
    }
    return next
  }
  if (command.type === 'bigUndo') return { ...history, cursor: turnStart, pendingReveal: null }
  if (command.type === 'undo') {
    let cursor = history.cursor
    while (cursor > turnStart && history.entries[cursor]!.action?.type === 'continueHandoff') cursor--
    return cursor > turnStart ? { ...history, cursor: cursor - 1, pendingReveal: null } : history
  }
  if (command.type === 'redo') {
    if (history.cursor >= history.entries.length - 1) return history
    return normalizeMailHistory({ ...history, cursor: history.cursor + 1, pendingReveal: null })
  }
  if (command.type !== 'apply' || playerViewForState(currentHistoryState(history)) !== role) return history
  return gameHistoryReducer(history, command)
}

export function mailBoardState(history: GameHistory, role: PlayerView) {
  const state = currentHistoryState(history)
  if (state.stage === 'gameOver' || playerViewForState(state) === role) return state
  return {
    ...state,
    stage: role === 'jack'
      ? state.currentJack === null ? 'jackDiscoverySetup' as const : 'jackMove' as const
      : state.publicRound ? 'investigatorTurnResult' as const : 'investigatorSetupResult' as const,
    notice: 'Your turn is complete. Waiting for your partner.',
  }
}

export function mailTurns(history: GameHistory): Array<{ owner: PlayerView; bytes: number[] }> {
  const turns: Array<{ owner: PlayerView; bytes: number[] }> = []
  for (let i = 1; i <= history.cursor; i++) {
    const previous = history.entries[i - 1]!
    const bytes = mailEntryBytes(history.entries[i]!, previous)
    const owner = playerViewForState(previous.state)
    if (!bytes.length || !owner) continue
    if (turns.at(-1)?.owner === owner) turns.at(-1)!.bytes.push(...bytes)
    else turns.push({ owner, bytes: [...bytes] })
  }
  return turns
}

export function mailTurnTimestamp(endedAt: number | null, timeZone?: string): string {
  if (endedAt === null) return 'time unavailable'
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
    second: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
  }).formatToParts(new Date(endedAt * 1000)).map(({ type, value }) => [type, value]))
  return `${parts.month}${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.timeZoneName}`
}

/** QR byte mode carries the existing wire bytes, starting with the four-byte game ID. */
export function mailQrBytes(text: string): Uint8Array {
  decodeMail(text)
  return Uint8Array.from(atob(mailTextFromInput(text).slice(3).replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))
}

export function mailTextFromQr(bytes: Uint8Array): string {
  if (bytes.length > 6144) fail()
  const text = new TextDecoder().decode(bytes)
  if (/^https?:\/\//i.test(text) || /^\d{2}-/.test(text)) {
    decodeMail(text)
    return mailTextFromInput(text)
  }
  const payload = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  const decoded = decodeMailPayload(payload)
  return encodeMail(decoded.id, decoded.role, decoded.history, decoded.endedAt)
}

export function reviewMailCorrection(input: string, current: { id: number; role: PlayerView; history: GameHistory; turnStart: number }) {
  const incoming = decodeMail(input)
  if (incoming.role !== current.role) throw new Error('This correction is addressed to the other player. Ask for text addressed to your side.')
  // Compare against the last received turn, excluding work based on that turn.
  const previous = mailTurns({ ...current.history, cursor: current.turnStart })
  const corrected = mailTurns(incoming.history)
  const changedTurnNumbers: number[] = []
  for (let i = 0; i < Math.max(previous.length, corrected.length); i++) {
    if (JSON.stringify(previous[i]) !== JSON.stringify(corrected[i])) changedTurnNumbers.push(i + 1)
  }
  const gameIdChanged = incoming.id !== current.id
  const latestReplaced = previous.length === corrected.length && corrected.at(-1)?.owner === otherPlayer(current.role)
  const latestRemoved = corrected.length === previous.length - 1
  const onlyLatestOpponentTurn = (latestReplaced || latestRemoved) &&
    previous.at(-1)?.owner === otherPlayer(current.role) &&
    changedTurnNumbers.every(turn => turn === previous.length)
  return {
    incoming,
    gameIdChanged,
    previousTurnCount: previous.length,
    incomingTurnCount: corrected.length,
    changedTurnNumbers,
    discardsLocalWork: current.history.cursor > current.turnStart,
    requiresConfirmation: gameIdChanged || !onlyLatestOpponentTurn,
  }
}
