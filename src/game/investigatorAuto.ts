import { legalInspectorActionCircles } from './gameEngine'
import { possibleJackSearchOutcomes, type SearchOutcome } from './inference'
import {
  currentHistoryState,
  gameHistoryReducer,
  type GameHistory,
  type HistoryCommand,
} from './history'
import type { GameAction, PublicRoundEvidence } from './types'

type SearchOutcomeResolver = (evidence: PublicRoundEvidence | null) => Map<number, SearchOutcome>

const nextAutomaticActions = (
  history: GameHistory,
  resolveOutcomes: SearchOutcomeResolver,
): GameAction[] => {
  const state = currentHistoryState(history)
  if (state.stage !== 'investigatorAction' || state.inspectorActionMode !== 'search') return []

  const outcomes = resolveOutcomes(state.publicRound)
  const adjacent = legalInspectorActionCircles(state)
  const mostRecentlyRevealedDiscovery = state.reachedDiscoveries.at(-1)
  const alreadyResolvedLocations = new Set(state.clueLocations)
  if (mostRecentlyRevealedDiscovery !== undefined) {
    alreadyResolvedLocations.add(mostRecentlyRevealedDiscovery)
  }
  const possibleAdjacent = adjacent.filter(
    (id) =>
      !state.checkedThisAction.includes(id) &&
      !alreadyResolvedLocations.has(id) &&
      outcomes.has(id),
  )

  if (state.checkedThisAction.length > 0) {
    const newPossible = possibleAdjacent.find(
      (id) => outcomes.get(id)?.positiveMeansJackIsThereNow,
    )
    if (newPossible !== undefined) return [{ type: 'searchCircle', circleId: newPossible }]
    if (possibleAdjacent.length === 0) return [{ type: 'passInspectorAction' }]
    if (possibleAdjacent.length === 1) {
      return [{ type: 'searchCircle', circleId: possibleAdjacent[0]! }]
    }
    return []
  }

  if (possibleAdjacent.length === 0) return [{ type: 'passInspectorAction' }]
  if (
    possibleAdjacent.length === 1 &&
    outcomes.get(possibleAdjacent[0]!)?.positiveMeansJackIsThereNow
  ) {
    return [
      { type: 'setInspectorActionMode', mode: 'arrest' },
      { type: 'arrestCircle', circleId: possibleAdjacent[0]! },
    ]
  }
  return []
}

export const automaticInvestigatorActions = (
  initial: GameHistory,
  resolveOutcomes: SearchOutcomeResolver = possibleJackSearchOutcomes,
) => {
  const commands: HistoryCommand[] = []
  let next = initial
  while (true) {
    const actions = nextAutomaticActions(next, resolveOutcomes)
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
