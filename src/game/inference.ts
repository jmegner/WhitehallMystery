import { adjacentCirclesForCrossing, alleyDestinations, boatDestinations, circlesById, crossings, jackTransitions } from './mapData'
import type { InvestigatorColor, JackMoveType, PublicMoveEvidence, PublicRoundEvidence } from './types'

interface Hypothesis {
  position: number
  positiveMask: bigint
  visitedUnion: bigint
  visitedIntersection: bigint
  clueVisitTurns?: bigint
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
  transitionsByMove: Map<number, Map<number, InferenceTransition[]>>
  visitTurnBits?: Map<number, bigint>
  visitTurnStride: number
}

interface InferenceTransition {
  position: number
  positiveMask: bigint
  visitedMask: bigint
  clueVisitTurns?: bigint
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

export const buildInferenceContext = (evidence: PublicRoundEvidence, trackVisitTurns = false): InferenceContext => {
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

  // Pack one row of numbered move slots per confirmed location, including slot 0.
  const visitTurnStride = trackVisitTurns ? Math.max(0, ...evidence.moves.map(move => move.endSlot)) + 1 : 0
  const visitTurnBits = trackVisitTurns
    ? new Map(positiveIds.map((id, index) => [id, 1n << BigInt(index * visitTurnStride)])) : undefined
  return { evidence, bitForCircle, negativeUntil, observationsByMove, transitionsByMove: new Map(), visitTurnBits, visitTurnStride }
}

const visitedBits = new Map([...circlesById.keys()].map(id => [id, 1n << BigInt(id)]))
const visitedBit = (circleId: number) => visitedBits.get(circleId) ?? (1n << BigInt(circleId))

// Every hypothetical search reuses the same movement graph and original
// observations. Compile each origin once, including Coach's intermediate visit.
const inferenceTransitions = (context: InferenceContext, moveIndex: number, from: number): InferenceTransition[] => {
  let origins = context.transitionsByMove.get(moveIndex)
  if (!origins) {
    origins = new Map()
    context.transitionsByMove.set(moveIndex, origins)
  }
  const cached = origins.get(from)
  if (cached) return cached
  const transitions: InferenceTransition[] = []
  const move = context.evidence.moves[moveIndex - 1]
  if (move) {
    for (const path of publicMovementPaths(from, move)) {
      if (path.some(id => (context.negativeUntil.get(id) ?? -1) >= moveIndex)) continue
      const position = path[path.length - 1]
      if (position === undefined) continue
      let positiveMask = 0n
      let visitedMask = 0n
      let clueVisitTurns = context.visitTurnBits ? 0n : undefined
      for (let step = 0; step < path.length; step++) {
        const id = path[step]!
        positiveMask |= context.bitForCircle.get(id) ?? 0n
        visitedMask |= visitedBit(id)
        if (clueVisitTurns !== undefined) {
          clueVisitTurns |= (context.visitTurnBits!.get(id) ?? 0n) << BigInt(move.startSlot + step)
        }
      }
      transitions.push({ position, positiveMask, visitedMask, clueVisitTurns })
    }
  }
  origins.set(from, transitions)
  return transitions
}

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

const remainingHypotheses = (context: InferenceContext, missedLocations = 0n): Hypothesis[] => {
  const { evidence, bitForCircle, negativeUntil, observationsByMove } = context

  if ((negativeUntil.get(evidence.start) ?? -1) >= 0 || (visitedBit(evidence.start) & missedLocations) !== 0n) return []
  // With no positive clues, position alone identifies an aggregation group.
  const keyFor = bitForCircle.size === 0
    ? (position: number): string | number => position
    : (position: number, mask: bigint): string | number => `${position}:${mask}`
  let hypotheses = new Map<string | number, Hypothesis>()
  const startMask = bitForCircle.get(evidence.start) ?? 0n
  const startVisited = visitedBit(evidence.start)
  hypotheses.set(keyFor(evidence.start, startMask), {
    position: evidence.start,
    positiveMask: startMask,
    visitedUnion: startVisited,
    visitedIntersection: startVisited,
    clueVisitTurns: context.visitTurnBits?.get(evidence.start) ?? (context.visitTurnBits ? 0n : undefined),
  })

  for (let moveIndex = 1; moveIndex <= evidence.moves.length; moveIndex += 1) {
    const next = new Map<string | number, Hypothesis>()
    for (const hypothesis of hypotheses.values()) {
      for (const transition of inferenceTransitions(context, moveIndex, hypothesis.position)) {
        if ((transition.visitedMask & missedLocations) !== 0n) continue
        const mask = hypothesis.positiveMask | transition.positiveMask
        const position = transition.position
        const visitedUnion = hypothesis.visitedUnion | transition.visitedMask
        const visitedIntersection = hypothesis.visitedIntersection | transition.visitedMask
        const clueVisitTurns = context.visitTurnBits
          ? (hypothesis.clueVisitTurns ?? 0n) | (transition.clueVisitTurns ?? 0n) : undefined
        const key = keyFor(position, mask)
        const existing = next.get(key)
        if (existing) {
          existing.visitedUnion |= visitedUnion
          existing.visitedIntersection &= visitedIntersection
          if (clueVisitTurns !== undefined) existing.clueVisitTurns = (existing.clueVisitTurns ?? 0n) | clueVisitTurns
        } else {
          next.set(key, { position, positiveMask: mask, visitedUnion, visitedIntersection, clueVisitTurns })
        }
      }
    }

    const observations = observationsByMove.get(moveIndex) ?? []
    hypotheses = next
    if (observations.length > 0) {
      for (const [key, hypothesis] of next) {
        if (!observations.every((observation) => {
          if (observation.kind === 'arrest') return hypothesis.position !== observation.circleId
          if (!observation.found) return true
          const bit = bitForCircle.get(observation.circleId) ?? 0n
          return (hypothesis.positiveMask & bit) !== 0n
        })) next.delete(key)
      }
    }
  }

  return [...hypotheses.values()]
}

export const possibleJackLocations = (evidence: PublicRoundEvidence | null): Set<number> => {
  if (!evidence) return new Set()
  const hypotheses = remainingHypotheses(buildInferenceContext(evidence))
  return new Set(hypotheses.map((hypothesis) => hypothesis.position))
}

const clueVisitTurnsCache = new WeakMap<PublicRoundEvidence, Map<number, number[]>>()

export const possibleClueVisitTurns = (evidence: PublicRoundEvidence | null): Map<number, number[]> => {
  if (!evidence || !evidence.observations.some(observation => observation.kind === 'clue' && observation.found)) return new Map()
  const cached = clueVisitTurnsCache.get(evidence)
  if (cached) return cached
  const context = buildInferenceContext(evidence, true)
  // Histories sharing a position and satisfied-clue mask admit the same future
  // evidence, so their possible visit times can be unioned without losing constraints.
  const visits = remainingHypotheses(context).reduce((mask, hypothesis) => mask | (hypothesis.clueVisitTurns ?? 0n), 0n)
  const result = new Map<number, number[]>()
  for (const [id, bit] of context.visitTurnBits!) {
    const turns = Array.from({ length: context.visitTurnStride }, (_, slot) => slot)
      .filter(slot => (visits & (bit << BigInt(slot))) !== 0n)
    if (turns.length) result.set(id, turns)
  }
  clueVisitTurnsCache.set(evidence, result)
  return result
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
    const missedLocations = misses.reduce((mask, id) => mask | visitedBit(id), 0n)
    const hypotheses = remainingHypotheses(context, missedLocations)
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
