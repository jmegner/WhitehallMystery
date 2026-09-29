import type { JackMoveType } from './types'

// Shared with the investigator deployment forecast so it anticipates Jack's
// updated opening preferences when he chooses his start after deployment.
export const JACK_PROGRESS_WEIGHT = 14
export const JACK_THREAT_WEIGHT = 60

export function jackSpecialCost(type: JackMoveType, round: number, remaining: number): number {
  if (type === 'normal') return 0
  if (type !== 'coach') return 12
  // The second Coach slot is scored separately as travel time. This reserve
  // price requires an actual escape/tempo benefit, especially in Round 1.
  return (round === 1 ? 28 : 14) + (remaining === 1 ? 8 : 0)
}

export function jackPacePenalty(distance: number, remaining: number): number {
  // Keep four slots in hand for detours/blocks. A distant goal creates urgency
  // earlier than a nearby one; waiting for Move 9 was too late in long rounds.
  return 8 * Math.max(0, 4 - (remaining - distance)) ** 2
}
