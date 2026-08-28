import { alleyDestinations, boatDestinations, circlesById, jackTransitions } from './mapData'
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

const movementPaths = (from: number, move: PublicMoveEvidence): number[][] => {
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

const buildInferenceContext = (evidence: PublicRoundEvidence): InferenceContext => {
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
      for (const path of movementPaths(hypothesis.position, move)) {
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

export const possibleJackSearchOutcomes = (evidence: PublicRoundEvidence | null): Map<number, SearchOutcome> => {
  const outcomes = new Map<number, SearchOutcome>()
  if (!evidence) return outcomes

  const context = buildInferenceContext(evidence)
  const hypotheses = remainingHypotheses(context)
  for (const circleId of circlesById.keys()) {
    const bit = visitedBit(circleId)
    const ifYes = new Set<number>()
    const ifNo = new Set<number>()
    for (const hypothesis of hypotheses) {
      if ((hypothesis.visitedUnion & bit) !== 0n) ifYes.add(hypothesis.position)
      if ((hypothesis.visitedIntersection & bit) === 0n) ifNo.add(hypothesis.position)
    }
    if (ifYes.size === 0) continue
    outcomes.set(circleId, {
      ifNo,
      ifYes,
      positiveMeansJackIsThereNow: ifYes.size === 1 && ifYes.has(circleId),
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

export const movementLabel = (type: JackMoveType) =>
  ({ normal: 'Street', coach: 'Coach', alley: 'Alley', boat: 'Boat' })[type]
