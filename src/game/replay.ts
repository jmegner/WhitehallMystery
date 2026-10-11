import { currentHistoryState, playerViewForState, type GameHistory, type PlayerView } from './history'
import type { GameState } from './types'

export interface ReplayTurn {
  side: PlayerView
  state: GameState
  startPositions: GameState['investigatorPositions']
}

const replayCache = new WeakMap<GameHistory, ReplayTurn[]>()
const displayState = (state: GameState, side: PlayerView): GameState => ({
  ...state,
  stage: side === 'jack' ? 'jackMove' : 'investigatorAction',
  activeInvestigator: 0,
  jackMoveSelection: { type: 'normal', path: [] },
  inspectorActionMode: 'search',
  checkedThisAction: [],
})

// Read committed history only. Private drafts and handoff screens belong to
// their side's whole turn, rather than becoming separate replay steps.
export function gameReplayTurns(history: GameHistory): ReplayTurn[] {
  if (currentHistoryState(history).stage !== 'gameOver') return []
  const cached = replayCache.get(history)
  if (cached) return cached
  const turns: ReplayTurn[] = []
  let turn: ReplayTurn | undefined
  for (let index = 1; index <= history.cursor; index++) {
    const before = history.entries[index - 1]!.state
    const { state: after, action } = history.entries[index]!
    if (action?.type === 'continueHandoff') {
      // Keep the completed round's trail/evidence when confirmation starts a
      // new round, while retaining its discovery or game-winning result.
      if (turn && (before.stage === 'investigatorTurnResult' || after.stage === 'gameOver')) {
        turn.state = { ...turn.state, reachedDiscoveries: after.reachedDiscoveries,
          publicLog: after.publicLog, result: after.result }
      }
      continue
    }
    const side = playerViewForState(before)
    if (!side || after.currentJack === null) continue
    if (!turn || turn.side !== side || turn.state.round !== before.round) {
      if (turn) turns.push(turn)
      turn = { side, startPositions: { ...before.investigatorPositions }, state: displayState(after, side) }
    } else turn.state = displayState(after, side)
  }
  if (turn) turns.push(turn)
  // Older saves may contain only the final position, without earlier actions.
  if (!turns.length) {
    const state = currentHistoryState(history)
    turns.push({ side: 'investigators', state: displayState(state, 'investigators'), startPositions: {} })
  }
  replayCache.set(history, turns)
  return turns
}

export function replayRoundTarget(turns: ReplayTurn[], index: number, direction: -1 | 1): number | null {
  const round = turns[index]?.state.round
  if (round === undefined) return null
  const rounds = [...new Set(turns.map(turn => turn.state.round))]
  const target = rounds[rounds.indexOf(round) + direction]
  return target === undefined ? null : turns.findIndex(turn => turn.state.round === target)
}

interface ReplayStorage { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }
const replayKey = (gameId: string) => `whitehall-mystery.replay-position.${gameId}`
export function loadReplayPosition(storage: ReplayStorage | null | undefined, gameId: string): number | null {
  try {
    const value: unknown = JSON.parse(storage?.getItem(replayKey(gameId)) ?? 'null')
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
  } catch { return null }
}
export function saveReplayPosition(storage: ReplayStorage | null | undefined, gameId: string, index: number | null) {
  try { storage?.setItem(replayKey(gameId), JSON.stringify(index)) } catch { /* Display preferences are optional. */ }
}
