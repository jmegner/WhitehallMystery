import { possibleJackLocations, publicMovementPaths } from '../../src/game/inference'
import type { PublicMoveEvidence, PublicRoundEvidence } from '../../src/game/types'

export const alleyPositions = { yellow: 'FP', blue: 'HP', red: 'HZ' }

// Immediately before the final Alley, the only possible origins are 43 and 46.
// 60: Alley from both, Street from 43 only. 47: Alley from 46, Street from neither.
// 44: Alley and Street from 43; the unrelated origin 46 must not mark it blue.
export function alleyEvidence(knownVisit = false, coach = false): PublicRoundEvidence {
  const prefix: PublicMoveEvidence[] = knownVisit ? [1, 2, 3, 4].map(slot => ({
    type: slot === 2 ? 'alley' : 'normal', startSlot: slot, endSlot: slot, investigatorPositions: alleyPositions,
  })) : [{ type: coach ? 'coach' : 'normal', startSlot: 1, endSlot: coach ? 2 : 1, investigatorPositions: alleyPositions }]
  const observations: PublicRoundEvidence['observations'] = knownVisit
    ? [{ kind: 'clue', circleId: 60, found: true, afterMove: 2, investigator: 'yellow' }] : []
  const before: PublicRoundEvidence = { start: 24, moves: prefix, observations }
  // Synthetic misses isolate the two origins without changing the map graph.
  for (const circleId of possibleJackLocations(before)) if (circleId !== 43 && circleId !== 46) {
    observations.push({ kind: 'arrest', circleId, hit: false, afterMove: prefix.length, investigator: 'red' })
  }
  const slot = prefix.at(-1)!.endSlot + 1
  return { ...before, moves: [...prefix, { type: 'alley', startSlot: slot, endSlot: slot, investigatorPositions: alleyPositions }] }
}

export function alleyTrail(knownVisit = false): number[] {
  if (!knownVisit) return [24, 43, 60]
  const street: PublicMoveEvidence = { type: 'normal', startSlot: 1, endSlot: 1, investigatorPositions: alleyPositions }
  const middle = publicMovementPaths(60, street).flat().find(id => publicMovementPaths(id, street).flat().includes(43))!
  return [24, 43, 60, middle, 43, 60]
}
