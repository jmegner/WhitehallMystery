import { currentHistoryState, playerViewForState, type GameHistory, type PlayerView } from './history'
import { isGameName } from './gameName'

export interface OnlineSeat { leftAt: number | null; generation: number }
export type OnlineSeats = Record<PlayerView, OnlineSeat>
export const initialOnlineSeats = (): OnlineSeats => ({ jack: { leftAt: null, generation: 0 }, investigators: { leftAt: null, generation: 0 } })
export const opponentRole = (role: PlayerView): PlayerView => role === 'jack' ? 'investigators' : 'jack'

export function isOnlineSeats(value: unknown, revision = Number.MAX_SAFE_INTEGER): value is OnlineSeats {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'investigators,jack') return false
  return (['jack', 'investigators'] as const).every(role => {
    const seat = (value as OnlineSeats)[role]
    return seat && typeof seat === 'object' && Object.keys(seat).sort().join(',') === 'generation,leftAt' &&
      Number.isSafeInteger(seat.generation) && seat.generation >= 0 && seat.generation <= revision &&
      (seat.leftAt === null || (Number.isSafeInteger(seat.leftAt) && seat.leftAt > 0 && seat.leftAt <= seat.generation))
  })
}

// Only the departed side completing a turn reoccupies its seat. A connection,
// partial move, opponent's turn, or undo decision does not count.
export function seatsAfterTurn(seats: OnlineSeats, role: PlayerView, before: GameHistory, after: GameHistory): OnlineSeats {
  if (seats[role].leftAt === null || playerViewForState(currentHistoryState(before)) !== role ||
    (currentHistoryState(after).stage !== 'gameOver' && playerViewForState(currentHistoryState(after)) === role)) return seats
  return { ...seats, [role]: { ...seats[role], leftAt: null } }
}

export type OnlineSessionRequest = { type: 'status'; token: string } | { type: 'leave' | 'invite'; token: string; requestId: string }
  | { type: 'reinvite'; token: string; requestId: string; expectedGeneration: number }
  | { type: 'rename'; token: string; requestId: string; name: string; expectedName: string }
export function parseOnlineSessionRequest(value: unknown): OnlineSessionRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  if (typeof item.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(item.token)) return null
  if (item.type === 'status' && Object.keys(item).sort().join(',') === 'token,type') return { type: 'status', token: item.token }
  if (item.type === 'reinvite' && Object.keys(item).sort().join(',') === 'expectedGeneration,requestId,token,type' &&
    Number.isSafeInteger(item.expectedGeneration) && Number(item.expectedGeneration) >= 0 && typeof item.requestId === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(item.requestId)) {
    return { type: 'reinvite', token: item.token, requestId: item.requestId, expectedGeneration: Number(item.expectedGeneration) }
  }
  if (item.type === 'rename' && Object.keys(item).sort().join(',') === 'expectedName,name,requestId,token,type' &&
    isGameName(item.name) && isGameName(item.expectedName) && typeof item.requestId === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(item.requestId)) {
    return { type: 'rename', token: item.token, requestId: item.requestId, name: item.name, expectedName: item.expectedName }
  }
  if ((item.type === 'leave' || item.type === 'invite') && Object.keys(item).sort().join(',') === 'requestId,token,type' &&
    typeof item.requestId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(item.requestId)) {
    return { type: item.type, token: item.token, requestId: item.requestId }
  }
  return null
}
