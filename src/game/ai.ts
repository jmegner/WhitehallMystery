import { chooseEasyDiscoveries } from './aiDiscoveries'
import { chooseJackStart, jackMoveActions } from './aiJack'
import { investigatorAction, investigatorMoveActions } from './aiInvestigators'
import { currentHistoryState, gameHistoryReducer, type GameHistory, type PlayerView } from './history'
import { normalizeRemoteHistory } from './remoteHistory'
import { needsAiTurn } from './aiSession'
import type { GameAction } from './types'

export function playAiTurn(initial: GameHistory, human: PlayerView, random = Math.random): GameHistory {
  let history = normalizeRemoteHistory(initial)
  for (let step = 0; step < 100; step += 1) {
    if (!needsAiTurn(history, human)) return history
    const state = currentHistoryState(history)
    let actions: GameAction[]
    switch (state.stage) {
      case 'jackDiscoverySetup': actions = [...state.discoveryLocations, ...chooseEasyDiscoveries(random)].map(circleId => ({ type: 'toggleDiscovery' as const, circleId })); actions.push({ type: 'confirmDiscoveries' }); break
      case 'jackChooseStart': actions = [{ type: 'chooseJackStart', circleId: chooseJackStart(state, random) }]; break
      case 'jackMove': actions = jackMoveActions(state, random); break
      case 'investigatorSetup':
      case 'investigatorMove': actions = investigatorMoveActions(state, random); break
      case 'investigatorAction': actions = investigatorAction(state, random); break
      default: throw new Error(`AI cannot act during ${state.stage}.`)
    }
    const before = history
    for (const action of actions) history = gameHistoryReducer(history, { type: 'apply', action })
    history = normalizeRemoteHistory(history)
    if (history === before) throw new Error('AI could not find a legal action. Your saved game is safe; retry the turn.')
  }
  throw new Error('AI turn exceeded its action limit. Your saved game is safe; retry the turn.')
}
