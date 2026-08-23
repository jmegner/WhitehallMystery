import { alleyDestinations, boatDestinations, circlesById, jackTransitions } from './mapData'
import type { InvestigatorColor, JackMoveType, PublicMoveEvidence, PublicRoundEvidence } from './types'

interface Hypothesis {
  position: number
  positiveMask: bigint
}

const isCoachCircle = (circleId: number) => circlesById.get(circleId)?.color !== 'blue'

const occupied = (positions: Record<InvestigatorColor, string>) => new Set(Object.values(positions))

const movementPaths = (from: number, move: PublicMoveEvidence): number[][] => {
  if (move.type === 'normal') {
    const blocked = occupied(move.investigatorPositions)
    return [...(jackTransitions.get(from)?.entries() ?? [])]
      .filter(([, via]) => via.some((crossingId) => !blocked.has(crossingId)))
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

export const possibleJackLocations = (evidence: PublicRoundEvidence | null): Set<number> => {
  if (!evidence) return new Set()

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

  if ((negativeUntil.get(evidence.start) ?? -1) >= 0) return new Set()
  let hypotheses = new Map<string, Hypothesis>()
  const startMask = bitForCircle.get(evidence.start) ?? 0n
  hypotheses.set(`${evidence.start}:${startMask}`, { position: evidence.start, positiveMask: startMask })

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
        next.set(`${position}:${mask}`, { position, positiveMask: mask })
      }
    }

    const observations = evidence.observations.filter((observation) => observation.afterMove === moveIndex)
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

  return new Set([...hypotheses.values()].map((hypothesis) => hypothesis.position))
}

export const movementLabel = (type: JackMoveType) =>
  ({ normal: 'Street', coach: 'Coach', alley: 'Alley', boat: 'Boat' })[type]

