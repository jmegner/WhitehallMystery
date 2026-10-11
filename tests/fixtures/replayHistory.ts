import { createInitialGame, legalInvestigatorDestinations, legalJackDestinations } from '../../src/game/gameEngine'
import { createGameHistory, currentHistoryState, gameHistoryReducer, type GameHistory } from '../../src/game/history'
import { normalizeRemoteHistory } from '../../src/game/remoteHistory'
import { INVESTIGATOR_ORDER, type GameAction, type GameState } from '../../src/game/types'

const apply = (history: GameHistory, action: GameAction) =>
  normalizeRemoteHistory(gameHistoryReducer(history, { type: 'apply', action }))

function streetPath(state: GameState, goal: number): number[] {
  const queue = [{ location: state.currentJack!, path: [] as number[] }]
  const visited = new Set([state.currentJack!])
  for (let index = 0; index < queue.length; index++) {
    const { location, path } = queue[index]!
    if (location === goal) return path
    for (const next of legalJackDestinations({ ...state, currentJack: location, jackMoveSelection: { type: 'normal', path: [] } })) {
      if (visited.has(next)) continue
      visited.add(next)
      queue.push({ location: next, path: [...path, next] })
    }
  }
  throw new Error(`No replay fixture route to ${goal}`)
}

// A real, complete three-round game, with a two-step Coach move and all handoffs.
export function finishedReplayHistory(): GameHistory {
  let history = createGameHistory(createInitialGame())
  for (const circleId of [33, 46, 147, 159]) history = apply(history, { type: 'toggleDiscovery', circleId })
  history = apply(history, { type: 'confirmDiscoveries' })
  for (const crossingId of ['FP', 'HP', 'HZ']) history = apply(history, { type: 'placeInvestigator', crossingId })
  history = apply(history, { type: 'chooseJackStart', circleId: 33 })
  for (const goal of [46, 147, 159]) {
    while (!currentHistoryState(history).reachedDiscoveries.includes(goal)) {
      const state = currentHistoryState(history)
      if (state.stage !== 'jackMove' || state.moveSlot >= 15) throw new Error('Replay fixture failed to reach a discovery')
      const route = streetPath(state, goal)
      const coach = state.round === 1 && state.moveSlot === 0 && route.length >= 2
      history = apply(history, { type: 'setJackMoveType', moveType: coach ? 'coach' : 'normal' })
      const path = route.slice(0, coach ? 2 : 1)
      for (const circleId of path) history = apply(history, { type: 'selectJackDestination', circleId })
      history = apply(history, { type: 'confirmJackMove' })
      if (currentHistoryState(history).currentJack !== path.at(-1)) throw new Error('Invalid replay fixture move')
      for (const color of INVESTIGATOR_ORDER) history = apply(history, {
        type: 'moveInvestigator', crossingId: currentHistoryState(history).investigatorPositions[color]!,
      })
      for (let index = 0; index < 3; index++) history = apply(history, { type: 'passInspectorAction' })
    }
  }
  return history
}

export function occupiedStartReplayHistory(): GameHistory {
  const investigatorPositions = { yellow: 'DD', blue: 'DC', red: 'HZ' }
  let history = createGameHistory({ ...createInitialGame(), stage: 'investigatorMove',
    currentJack: 36, roundTrail: [33, 54, 36], moveSlot: 2,
    discoveryLocations: [33, 46, 147, 159], reachedDiscoveries: [33], investigatorPositions,
    publicRound: { start: 33, observations: [], moves: [{ type: 'coach', startSlot: 1, endSlot: 2, investigatorPositions }] },
  })
  const destination = legalInvestigatorDestinations(currentHistoryState(history)).find(id => id !== 'DD')!
  history = apply(history, { type: 'moveInvestigator', crossingId: destination })
  history = apply(history, { type: 'moveInvestigator', crossingId: 'DD' })
  history = apply(history, { type: 'moveInvestigator', crossingId: 'HZ' })
  history = apply(history, { type: 'passInspectorAction' })
  history = apply(history, { type: 'setInspectorActionMode', mode: 'arrest' })
  history = apply(history, { type: 'arrestCircle', circleId: 36 })
  if (currentHistoryState(history).stage !== 'gameOver') throw new Error('Replay fixture arrest failed')
  return history
}
