import { alleyDestinations, boatDestinations, circles, circlesById, jackTransitions } from './mapData'
import type { GameState } from './types'

type PublicProgress = Pick<GameState, 'publicRound' | 'reachedDiscoveries' | 'moveSlot' | 'specialRemaining'>

export interface InvestigatorWeights {
  targets: ReadonlySet<number>
  locationWeights: ReadonlyMap<number, number>
  minimumDiscoveryMoves: (id: number, alley?: number, boat?: number) => number
  specialRemaining: PublicProgress['specialRemaining']
  remainingMoves: number
  pendingDiscoveryAllowed: boolean
}

const streetDistances = new Map(circles.map(({ id }) => {
  const distances = new Map<number, number>([[id, 0]])
  const queue = [id]
  for (let index = 0; index < queue.length; index += 1) {
    const from = queue[index]!
    for (const to of jackTransitions.get(from)!.keys()) {
      if (distances.has(to)) continue
      distances.set(to, distances.get(from)! + 1)
      queue.push(to)
    }
  }
  return [id, distances] as const
}))

// An optimistic minimum in move-track slots, allowing the remaining Alley and
// Boat tiles but ignoring investigators and unknown discovery restrictions en
// route. The final arrival must be a Street move. Coach cannot improve this
// lower bound: it costs two slots for two already-unblocked street edges.
function minimumDiscoveryMoves(targets: Set<number>, special: PublicProgress['specialRemaining']): Map<number, number>[][] {
  const layers: Map<number, number>[][] = []
  for (let alley = 0; alley <= special.alley; alley += 1) {
    const row: Map<number, number>[] = []
    layers.push(row)
    for (let boat = 0; boat <= special.boat; boat += 1) {
      const distances = new Map(circles.map(({ id }) => {
        let best = [...jackTransitions.get(id)!.keys()].some(to => targets.has(to)) ? 1 : Infinity
        if (alley > 0) for (const to of alleyDestinations.get(id)!) best = Math.min(best, 1 + layers[alley - 1]![boat]!.get(to)!)
        if (boat > 0) for (const to of boatDestinations.get(id)!) best = Math.min(best, 1 + row[boat - 1]!.get(to)!)
        return [id, best] as const
      }))
      const queue = circles.filter(({ id }) => Number.isFinite(distances.get(id))).map(({ id }) => id)
      for (let index = 0; index < queue.length; index += 1) {
        const from = queue[index]!
        for (const to of jackTransitions.get(from)!.keys()) {
          const candidate = distances.get(from)! + 1
          if (candidate >= distances.get(to)!) continue
          distances.set(to, candidate)
          queue.push(to)
        }
      }
      row.push(distances)
    }
  }
  return layers
}

export function createInvestigatorWeights(state: PublicProgress): InvestigatorWeights | undefined {
  const evidence = state.publicRound
  if (!evidence) return undefined // Deployment has no public starting location.
  const revealedQuadrants = new Set([...state.reachedDiscoveries, evidence.start].map(id => circlesById.get(id)!.quadrant))
  // A clue found on an earlier investigator turn proves this location was
  // visited without ending the round. A clue found THIS turn could still be a
  // discovery under Jack: discoveries are revealed only after investigators act.
  const visitedEarlier = new Set(evidence.observations.filter(observation =>
    observation.kind === 'clue' && observation.found && observation.afterMove < evidence.moves.length,
  ).map(observation => observation.circleId))
  const targets = new Set(circles.filter(circle => circle.color === 'white' &&
    !revealedQuadrants.has(circle.quadrant) && !visitedEarlier.has(circle.id)).map(circle => circle.id))
  const fromStart = streetDistances.get(evidence.start)!
  const locationWeights = new Map(circles.map(({ id }) => {
    const from = streetDistances.get(id)!
    let distance = Infinity
    let detour = Infinity
    for (const goal of targets) {
      distance = Math.min(distance, from.get(goal)!)
      detour = Math.min(detour, fromStart.get(id)! + from.get(goal)! - fromStart.get(goal)!)
    }
    return [id, targets.size ? 0.2 + 0.8 * 2 ** (-(distance + detour) / 2) : 0] as const
  }))
  const distances = minimumDiscoveryMoves(targets, state.specialRemaining)
  return { targets, locationWeights, specialRemaining: { ...state.specialRemaining },
    minimumDiscoveryMoves: (id, alley = state.specialRemaining.alley, boat = state.specialRemaining.boat) => distances[alley]![boat]!.get(id) ?? Infinity,
    remainingMoves: 15 - state.moveSlot, pendingDiscoveryAllowed: evidence.moves.at(-1)?.type === 'normal' }
}

// These hypotheses remain in exact inference and the displayed clue counts.
// Only strategic planning ignores positions that lose even with optimistic
// future movement and all publicly remaining special tiles.
export function viableJackLocations(possible: Set<number>, weights?: InvestigatorWeights): Set<number> {
  if (!weights) return possible
  return new Set([...possible].filter(id => (weights.pendingDiscoveryAllowed && weights.targets.has(id)) ||
    weights.minimumDiscoveryMoves(id) <= weights.remainingMoves))
}
