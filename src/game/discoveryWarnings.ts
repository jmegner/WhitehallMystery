import { minimumDiscoveryMoves } from './aiDiscoveryDistance'
import { legalJackDestinations } from './gameEngine'
import { circles, circlesById, jackTransitions } from './mapData'
import type { GameState } from './types'

export type DiscoveryWarning = 'unreachable' | 'special-needed'

export function jackDiscoveryWarnings(state: GameState, coachDestinations: ReadonlySet<number>): ReadonlyMap<number, DiscoveryWarning> {
  const targets = new Set(state.discoveryLocations.filter(id => !state.reachedDiscoveries.includes(id)))
  const warnings = new Map<number, DiscoveryWarning>()
  if (!targets.size) return warnings

  // Budget the selected move first. Investigators can reposition before Jack
  // moves again, so use optimistic distances for the rest of the round.
  const distances = minimumDiscoveryMoves(targets, state.specialRemaining, true)
  const { type, path } = state.jackMoveSelection
  const firstCoachStops = new Set(type === 'coach' && path.length === 0 ? legalJackDestinations(state) : [])
  const { alley, boat } = state.specialRemaining
  const afterCoach = 15 - state.moveSlot - 2
  const slots = type === 'coach' ? afterCoach : 15 - state.moveSlot - 1
  const available = distances[alley - Number(type === 'alley')]?.[boat - Number(type === 'boat')]
  const street = distances[0]![0]!
  const warningAt = (id: number, remaining: number, moves = available): DiscoveryWarning | undefined => {
    if ((street.get(id) ?? Infinity) <= remaining) return undefined
    return (moves?.get(id) ?? Infinity) <= remaining ? 'special-needed' : 'unreachable'
  }

  // Treat each location as a hypothetical landing spot for the selected move.
  // A selectable first Coach stop still has to complete the two-stop route.
  for (const { id } of circles) {
    let warning: DiscoveryWarning | undefined
    if (firstCoachStops.has(id)) {
      const endings = legalJackDestinations({ ...state, jackMoveSelection: { type, path: [id] } })
      const outcomes = endings.map(end => warningAt(end, slots))
      if (outcomes.every(Boolean)) warning = outcomes.includes('special-needed') ? 'special-needed' : 'unreachable'
    } else if (coachDestinations.has(id)) {
      warning = warningAt(id, afterCoach, distances[alley]![boat]!)
    } else if (type !== 'normal' || !targets.has(id)) {
      warning = warningAt(id, slots)
    }
    if (warning) warnings.set(id, warning)
  }
  return warnings
}

type PublicProgress = Pick<GameState, 'publicRound' | 'reachedDiscoveries' | 'moveSlot' | 'specialRemaining'>

export function investigatorDiscoveryWarnings(state: PublicProgress): ReadonlyMap<number, DiscoveryWarning> {
  const warnings = new Map<number, DiscoveryWarning>()
  const lastMove = state.publicRound?.moves.at(-1)
  if (!state.publicRound || !lastMove) return warnings

  const visitedQuadrants = new Set([...state.reachedDiscoveries, state.publicRound.start].map(id => circlesById.get(id)?.quadrant))
  const targets = new Set(circles.filter(({ color, quadrant }) => color === 'white' && !visitedQuadrants.has(quadrant)).map(({ id }) => id))
  if (!targets.size) return warnings

  const { alley, boat } = state.specialRemaining
  const distances = minimumDiscoveryMoves(targets, state.specialRemaining)
  const remaining = 15 - state.moveSlot
  for (const { id } of circles) {
    let routes = distances
    if (targets.has(id)) {
      if (lastMove.type === 'normal') continue
      // A public special move rules out its landing spot as a discovery. A
      // Street edge to another candidate already gives the best possible time.
      if (remaining > 0 && ![...jackTransitions.get(id)!.keys()].some(to => targets.has(to))) {
        const otherTargets = new Set(targets)
        otherTargets.delete(id)
        routes = minimumDiscoveryMoves(otherTargets, state.specialRemaining)
      }
    }
    if (routes[0]![0]!.get(id)! <= remaining) continue
    warnings.set(id, routes[alley]![boat]!.get(id)! <= remaining ? 'special-needed' : 'unreachable')
  }
  return warnings
}
