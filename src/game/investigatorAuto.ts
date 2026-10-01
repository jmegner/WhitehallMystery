import { legalInspectorActionCircles } from './gameEngine'
import { possibleJackSearchOutcomes, type SearchOutcome } from './inference'
import { createInvestigatorWeights } from './aiInvestigatorWeights'
import { coveringArrests, investigatorTargets, orderedSearches, possibleLocationsFromOutcomes, soleArrestTarget } from './investigatorTactics'
import {
  currentHistoryState,
  gameHistoryReducer,
  type GameHistory,
  type HistoryCommand,
} from './history'
import { INVESTIGATOR_ORDER, type GameAction, type InvestigatorAutoMode, type PublicRoundEvidence } from './types'

type SearchOutcomeResolver = (evidence: PublicRoundEvidence | null) => Map<number, SearchOutcome>

const nextAutomaticActions = (
  history: GameHistory,
  resolveOutcomes: SearchOutcomeResolver,
  mode: InvestigatorAutoMode,
): GameAction[] => {
  const state = currentHistoryState(history)
  if (state.stage !== 'investigatorAction' || state.inspectorActionMode !== 'search') return []

  const adjacent = legalInspectorActionCircles(state)
  const searching = state.checkedThisAction.length > 0
  const remaining = adjacent.filter(id => !state.checkedThisAction.includes(id))
  // A search already underway cannot switch to arrest. Its last known clue
  // adds no information, so finish with a replayable action even with InvAuto off.
  if (searching && remaining.length === 1 && state.clueLocations.includes(remaining[0]!)) {
    return [{ type: 'passInspectorAction' }]
  }
  if (mode === 'off') return []

  const outcomes = resolveOutcomes(state.publicRound)
  const possible = possibleLocationsFromOutcomes(outcomes)
  const color = INVESTIGATOR_ORDER[state.activeInvestigator]!
  const available = INVESTIGATOR_ORDER.slice(state.activeInvestigator + (searching ? 1 : 0))
  // Use ALL exact possibilities for a guaranteed capture, including positions
  // with poor strategic prospects. Never spend an already-used arrest action.
  const capture = coveringArrests(possible, state.investigatorPositions, available)
  if (capture) {
    const id = capture[color]
    return id === undefined ? [{ type: 'passInspectorAction' }] : [
      { type: 'setInspectorActionMode', mode: 'arrest' }, { type: 'arrestCircle', circleId: id },
    ]
  }
  const resolved = new Set([...state.clueLocations, ...state.reachedDiscoveries.slice(-1)])
  const targets = investigatorTargets(adjacent, outcomes, possible, resolved, state.checkedThisAction)

  if (searching) {
    const unsearched = remaining.filter(id => !resolved.has(id))
    if (mode === 'med' && unsearched.length === 1) return [{ type: 'searchCircle', circleId: unsearched[0]! }]
    if (targets.searches.length === 0) return [{ type: 'passInspectorAction' }]
    const searches = mode === 'med' ? targets.searches.filter(id => outcomes.get(id)!.ifYes.size === 1) : targets.searches
    if (!searches.length) return []
    const id = orderedSearches(searches, outcomes, possible, state.investigatorPositions,
      undefined, createInvestigatorWeights(state))[0]!
    return [{ type: 'searchCircle', circleId: id }]
  }

  if (!targets.searches.length && !targets.arrests.length) return [{ type: 'passInspectorAction' }]
  const onlyTarget = soleArrestTarget(targets, outcomes)
  if (onlyTarget !== undefined) {
    return [
      { type: 'setInspectorActionMode', mode: 'arrest' },
      { type: 'arrestCircle', circleId: onlyTarget },
    ]
  }
  return []
}

export const automaticInvestigatorActions = (
  initial: GameHistory,
  resolveOutcomes: SearchOutcomeResolver = possibleJackSearchOutcomes,
  mode: InvestigatorAutoMode = 'hi',
) => {
  const commands: HistoryCommand[] = []
  let next = initial
  while (true) {
    const actions = nextAutomaticActions(next, resolveOutcomes, mode)
    if (actions.length === 0) break
    for (const action of actions) {
      const command = { type: 'apply' as const, action }
      const advanced = gameHistoryReducer(next, command)
      if (advanced === next) return { next, commands }
      next = advanced
      commands.push(command)
    }
  }
  return { next, commands }
}
