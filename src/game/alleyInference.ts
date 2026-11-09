import { possibleJackLocations, publicMovementPaths } from './inference'
import type { PublicRoundEvidence } from './types'

export type AlleyNeed = 'could' | 'definite'
const empty = new Map<number, AlleyNeed>()
const cache = new WeakMap<PublicRoundEvidence, Map<boolean, Map<number, AlleyNeed>>>()

// Compare the Alley with legal Street moves from the public possibilities just
// before it. An Alley edge must actually exist from an origin that needs it;
// an unrelated origin unable to reach the destination proves nothing.
export function possibleAlleyNeeds(evidence: PublicRoundEvidence | null, sprint = false): ReadonlyMap<number, AlleyNeed> {
  const move = evidence?.moves.at(-1)
  if (!evidence || move?.type !== 'alley') return empty
  const modes = cache.get(evidence) ?? new Map<boolean, Map<number, AlleyNeed>>()
  const cached = modes.get(sprint)
  if (cached) return cached
  const before: PublicRoundEvidence = { ...evidence, moves: evidence.moves.slice(0, -1),
    observations: evidence.observations.filter(observation => observation.afterMove < evidence.moves.length) }
  // Keep the complete prior support, even when sprint filters displayed current
  // endpoints. A heuristic must not turn "could" into a definite deduction.
  const origins = possibleJackLocations(before)
  const streetReachable = new Set<number>()
  const couldNeed = new Set<number>()
  for (const origin of origins) {
    const street = new Set(publicMovementPaths(origin, { ...move, type: 'normal' }).flat())
    for (const id of street) streetReachable.add(id)
    for (const id of publicMovementPaths(origin, move).flat()) if (!street.has(id)) couldNeed.add(id)
  }
  const result = new Map<number, AlleyNeed>()
  for (const id of possibleJackLocations(evidence, sprint)) {
    if (couldNeed.has(id)) result.set(id, streetReachable.has(id) ? 'could' : 'definite')
  }
  modes.set(sprint, result)
  cache.set(evidence, modes)
  return result
}
