import { adjacentCirclesForCrossing, alleyDestinations, boatDestinations, circlesById, crossings, jackTransitions } from './mapData'
import type { InvestigatorColor, JackMoveType, PublicMoveEvidence, PublicRoundEvidence } from './types'

interface Hypothesis {
  position: number
  positiveMask: bigint
  visitedUnion: bigint
  visitedIntersection: bigint
}

export interface SearchOutcome {
  ifNo: Set<number>
  ifYes: Set<number>
  positiveMeansJackIsThereNow: boolean
}

interface InferenceContext {
  evidence: PublicRoundEvidence
  bitForCircle: Map<number, bigint>
  negativeUntil: Map<number, number>
  observationsByMove: Map<number, PublicRoundEvidence['observations']>
}

const isCoachCircle = (circleId: number) => circlesById.get(circleId)?.color !== 'blue'

const occupied = (positions: Record<InvestigatorColor, string>) => new Set(Object.values(positions))

export const publicMovementPaths = (from: number, move: PublicMoveEvidence): number[][] => {
  if (move.type === 'normal') {
    const blocked = occupied(move.investigatorPositions)
    return [...(jackTransitions.get(from)?.entries() ?? [])]
      .filter(([, paths]) => paths.some((path) => path.every((crossingId) => !blocked.has(crossingId))))
      .map(([destination]) => [destination])
  }
  if (move.type === 'alley' || move.type === 'boat') {
    const destinations = move.type === 'alley' ? alleyDestinations : boatDestinations
    return [...(destinations.get(from) ?? [])].map((destination) => [destination])
  }

  const routes: number[][] = []
  for (const first of jackTransitions.get(from)?.keys() ?? []) {
    if (!isCoachCircle(first)) continue
    for (const second of jackTransitions.get(first)?.keys() ?? []) {
      if (second === from || second === first || !isCoachCircle(second)) continue
      routes.push([first, second])
    }
  }
  return routes
}

export const buildInferenceContext = (evidence: PublicRoundEvidence): InferenceContext => {
  const positiveIds = [
    ...new Set(
      evidence.observations
        .filter((observation) => observation.kind === 'clue' && observation.found)
        .map((observation) => observation.circleId),
    ),
  ]
  const bitForCircle = new Map(positiveIds.map((circleId, index) => [circleId, 1n << BigInt(index)]))
  const negativeUntil = new Map<number, number>()
  for (const observation of evidence.observations) {
    if (observation.kind === 'clue' && !observation.found) {
      negativeUntil.set(observation.circleId, Math.max(negativeUntil.get(observation.circleId) ?? -1, observation.afterMove))
    }
  }

  const observationsByMove = new Map<number, PublicRoundEvidence['observations']>()
  for (const observation of evidence.observations) {
    const observations = observationsByMove.get(observation.afterMove) ?? []
    observations.push(observation)
    observationsByMove.set(observation.afterMove, observations)
  }

  return { evidence, bitForCircle, negativeUntil, observationsByMove }
}

const visitedBit = (circleId: number) => 1n << BigInt(circleId)

// Searches happen this turn. Only their surviving current locations are
// projected through the assumed Street move; the future visit is not a clue
// that an investigator can find now. Cache each origin's legal destinations.
const locationProjector = (nextStreetPositions?: Partial<Record<InvestigatorColor, string>>) => {
  const blocked = new Set(Object.values(nextStreetPositions ?? {}))
  const destinations = new Map<number, number[]>()
  return (locations: Iterable<number>): Set<number> => {
    if (!nextStreetPositions) return locations instanceof Set ? locations : new Set(locations)
    const projected = new Set<number>()
    for (const from of locations) {
      let next = destinations.get(from)
      if (!next) {
        next = [...(jackTransitions.get(from) ?? [])]
          .filter(([, paths]) => paths.some(path => path.every(id => !blocked.has(id))))
          .map(([to]) => to)
        destinations.set(from, next)
      }
      for (const to of next) projected.add(to)
    }
    return projected
  }
}

const remainingHypotheses = (context: InferenceContext): Hypothesis[] => {
  const { evidence, bitForCircle, negativeUntil, observationsByMove } = context

  if ((negativeUntil.get(evidence.start) ?? -1) >= 0) return []
  let hypotheses = new Map<string, Hypothesis>()
  const startMask = bitForCircle.get(evidence.start) ?? 0n
  const startVisited = visitedBit(evidence.start)
  hypotheses.set(`${evidence.start}:${startMask}`, {
    position: evidence.start,
    positiveMask: startMask,
    visitedUnion: startVisited,
    visitedIntersection: startVisited,
  })

  for (let moveIndex = 1; moveIndex <= evidence.moves.length; moveIndex += 1) {
    const move = evidence.moves[moveIndex - 1]
    if (!move) continue
    const next = new Map<string, Hypothesis>()
    for (const hypothesis of hypotheses.values()) {
      for (const path of publicMovementPaths(hypothesis.position, move)) {
        if (path.some((circleId) => (negativeUntil.get(circleId) ?? -1) >= moveIndex)) continue
        let mask = hypothesis.positiveMask
        for (const circleId of path) mask |= bitForCircle.get(circleId) ?? 0n
        const position = path[path.length - 1]
        if (position === undefined) continue
        const pathVisited = path.reduce((visited, circleId) => visited | visitedBit(circleId), 0n)
        const visitedUnion = hypothesis.visitedUnion | pathVisited
        const visitedIntersection = hypothesis.visitedIntersection | pathVisited
        const key = `${position}:${mask}`
        const existing = next.get(key)
        next.set(
          key,
          existing
            ? {
                ...existing,
                visitedUnion: existing.visitedUnion | visitedUnion,
                visitedIntersection: existing.visitedIntersection & visitedIntersection,
              }
            : { position, positiveMask: mask, visitedUnion, visitedIntersection },
        )
      }
    }

    const observations = observationsByMove.get(moveIndex) ?? []
    hypotheses = new Map(
      [...next.entries()].filter(([, hypothesis]) =>
        observations.every((observation) => {
          if (observation.kind === 'arrest') return hypothesis.position !== observation.circleId
          if (!observation.found) return true
          const bit = bitForCircle.get(observation.circleId) ?? 0n
          return (hypothesis.positiveMask & bit) !== 0n
        }),
      ),
    )
  }

  return [...hypotheses.values()]
}

export const possibleJackLocations = (evidence: PublicRoundEvidence | null): Set<number> => {
  if (!evidence) return new Set()
  const hypotheses = remainingHypotheses(buildInferenceContext(evidence))
  return new Set(hypotheses.map((hypothesis) => hypothesis.position))
}

const evidenceAfterMove = (
  evidence: PublicRoundEvidence | null,
  type: JackMoveType,
  investigatorPositions: Record<InvestigatorColor, string>,
  currentMoveSlot: number,
): PublicRoundEvidence | null => {
  if (!evidence) return null
  const cost = type === 'coach' ? 2 : 1
  const move: PublicMoveEvidence = {
    type,
    startSlot: currentMoveSlot + 1,
    endSlot: currentMoveSlot + cost,
    investigatorPositions,
  }
  return { ...evidence, moves: [...evidence.moves, move] }
}

export const possibleJackLocationsAfterMove = (
  evidence: PublicRoundEvidence | null,
  type: JackMoveType,
  investigatorPositions: Record<InvestigatorColor, string>,
  currentMoveSlot: number,
): Set<number> =>
  possibleJackLocations(evidenceAfterMove(evidence, type, investigatorPositions, currentMoveSlot))

export const possibleJackSearchOutcomes = (
  evidence: PublicRoundEvidence | null,
  nextStreetPositions?: Partial<Record<InvestigatorColor, string>>,
): Map<number, SearchOutcome> => {
  const outcomes = new Map<number, SearchOutcome>()
  if (!evidence) return outcomes

  const context = buildInferenceContext(evidence)
  const hypotheses = remainingHypotheses(context)
  const project = locationProjector(nextStreetPositions)
  for (const circleId of circlesById.keys()) {
    const bit = visitedBit(circleId)
    const ifYes = new Set<number>()
    const ifNo = new Set<number>()
    for (const hypothesis of hypotheses) {
      if ((hypothesis.visitedUnion & bit) !== 0n) ifYes.add(hypothesis.position)
      if ((hypothesis.visitedIntersection & bit) === 0n) ifNo.add(hypothesis.position)
    }
    if (ifYes.size === 0) continue
    const projectedYes = project(ifYes)
    outcomes.set(circleId, {
      ifNo: project(ifNo),
      ifYes: projectedYes,
      positiveMeansJackIsThereNow: projectedYes.size === 1 && projectedYes.has(circleId),
    })
  }

  return outcomes
}

export const possibleJackSearchOutcomesAfterMove = (
  evidence: PublicRoundEvidence | null,
  type: JackMoveType,
  investigatorPositions: Record<InvestigatorColor, string>,
  currentMoveSlot: number,
): Map<number, SearchOutcome> =>
  possibleJackSearchOutcomes(evidenceAfterMove(evidence, type, investigatorPositions, currentMoveSlot))

const crossingEliminationCache = new WeakMap<PublicRoundEvidence, Map<string, Map<string, number>>>()

// A search ends at the first yes. Choose the next location to minimize the
// largest surviving set, continuing only down the no branch. Re-run inference
// with all preceding misses: intersecting individual outcomes loses correlations
// between different possible trails that end at the same current location.
export const worstCaseCrossingEliminations = (
  evidence: PublicRoundEvidence | null,
  nextStreetPositions?: Partial<Record<InvestigatorColor, string>>,
): Map<string, number> => {
  if (!evidence) return new Map()
  // Investigator moves can change the forecast even when public evidence does
  // not change. Keep current and projected results in separate cache entries.
  const cacheKey = nextStreetPositions ? `next:${Object.values(nextStreetPositions).sort().join(',')}` : 'current'
  const cachedByPerspective = crossingEliminationCache.get(evidence) ?? new Map<string, Map<string, number>>()
  const cached = cachedByPerspective.get(cacheKey)
  if (cached) return cached
  const context = buildInferenceContext(evidence)
  const initial = remainingHypotheses(context)
  const project = locationProjector(nextStreetPositions)
  const total = project(initial.map(hypothesis => hypothesis.position)).size
  const hypothesesByMisses = new Map<string, Hypothesis[]>([['', initial]])
  const afterMisses = (misses: number[]) => {
    const key = misses.join(',')
    const known = hypothesesByMisses.get(key)
    if (known) return known
    const negativeUntil = new Map(context.negativeUntil)
    for (const id of misses) negativeUntil.set(id, evidence.moves.length)
    const hypotheses = remainingHypotheses({ ...context, negativeUntil })
    hypothesesByMisses.set(key, hypotheses)
    return hypotheses
  }
  const counts = new Map<string, number>()
  for (const crossing of crossings) {
    // Guaranteed misses add no information and need no hypothetical branches.
    const adjacent = adjacentCirclesForCrossing(crossing.id).filter(id =>
      initial.some(hypothesis => (hypothesis.visitedUnion & visitedBit(id)) !== 0n))
    const residuals = new Map<string, number>()
    const worstRemaining = (misses: number[]): number => {
      const key = misses.join(',')
      const known = residuals.get(key)
      if (known !== undefined) return known
      const hypotheses = afterMisses(misses)
      const possible = project(hypotheses.map(hypothesis => hypothesis.position))
      let best = possible.size
      if (best === 0) return 0 // No locations survive in the displayed perspective.
      for (const id of adjacent) {
        if (misses.includes(id)) continue
        const bit = visitedBit(id)
        const yes = project(hypotheses.filter(hypothesis => (hypothesis.visitedUnion & bit) !== 0n)
          .map(hypothesis => hypothesis.position)).size
        // This order already cannot improve on the best one found so far.
        if (yes >= best) continue
        const no = worstRemaining([...misses, id].sort((a, b) => a - b))
        best = Math.min(best, Math.max(yes, no))
      }
      residuals.set(key, best)
      return best
    }
    counts.set(crossing.id, total - worstRemaining([]))
  }
  cachedByPerspective.set(cacheKey, counts)
  crossingEliminationCache.set(evidence, cachedByPerspective)
  return counts
}

export const movementLabel = (type: JackMoveType) =>
  ({ normal: 'Street', coach: 'Coach', alley: 'Alley', boat: 'Boat' })[type]
