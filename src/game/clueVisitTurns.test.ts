import { expect, test } from 'vitest'
import { possibleClueVisitTurns, publicMovementPaths } from './inference'
import type { PublicMoveEvidence, PublicRoundEvidence } from './types'

const investigatorPositions = { yellow: 'FP', blue: 'HP', red: 'HZ' }
const street = (slot: number): PublicMoveEvidence => ({ type: 'normal', startSlot: slot, endSlot: slot, investigatorPositions })
const positive = (circleId: number, afterMove: number) => ({ kind: 'clue' as const, circleId, found: true, afterMove, investigator: 'yellow' as const })

// Enumerate complete trails independently, preserving the numbered Coach slots
// and applying each observation at the moment it became public.
function enumerateVisitTurns(evidence: PublicRoundEvidence) {
  let trails = [[{ id: evidence.start, slot: 0 }]]
  for (const [index, move] of evidence.moves.entries()) {
    trails = trails.flatMap(trail => publicMovementPaths(trail.at(-1)!.id, move).map(path => [
      ...trail, ...path.map((id, step) => ({ id, slot: move.startSlot + step })),
    ])).filter(trail => evidence.observations.filter(observation => observation.afterMove === index + 1)
      .every(observation => observation.kind === 'arrest' ? trail.at(-1)!.id !== observation.circleId
        : trail.some(visit => visit.id === observation.circleId) === observation.found))
  }
  const result = new Map<number, number[]>()
  for (const observation of evidence.observations) {
    if (observation.kind !== 'clue' || !observation.found) continue
    const turns = [...new Set(trails.flatMap(trail => trail.filter(visit => visit.id === observation.circleId).map(visit => visit.slot)))].sort((a, b) => a - b)
    if (turns.length) result.set(observation.circleId, turns)
  }
  return result
}

test.each<PublicRoundEvidence>([
  { start: 33, moves: [street(1), street(2), street(3)], observations: [positive(13, 1)] },
  { start: 33, moves: [street(1), street(2), street(3)], observations: [positive(13, 1), positive(10, 3)] },
  { start: 33, moves: [street(1), street(2), street(3)], observations: [positive(13, 2),
    { kind: 'clue', circleId: 36, found: false, afterMove: 2, investigator: 'blue' },
    { kind: 'arrest', circleId: 13, hit: false, afterMove: 3, investigator: 'red' }] },
  { start: 33, moves: [{ ...street(1), type: 'coach', endSlot: 2 }, street(3)], observations: [positive(36, 1)] },
  { start: 33, moves: [{ ...street(1), type: 'alley' }, street(2)], observations: [positive(13, 2)] },
  { start: 154, moves: [{ ...street(1), type: 'boat' }, street(2)], observations: [positive(154, 2)] },
  { start: 33, moves: [street(1), street(2)], observations: [positive(33, 1)] },
])('visit times match complete trails after all public evidence: %#', evidence => {
  const expected = enumerateVisitTurns(evidence)
  expect(expected.size).toBeGreaterThan(0)
  expect(possibleClueVisitTurns(evidence)).toEqual(expected)
})

test('Coach intermediate visits use the first numbered slot and its destination uses the second', () => {
  const move: PublicMoveEvidence = { ...street(1), type: 'coach', endSlot: 2 }
  const immediate = new Set(publicMovementPaths(33, street(1)).flat())
  const route = publicMovementPaths(33, move).find(path => !immediate.has(path[1]!) && path[1] !== 33)!
  const evidence = { start: 33, moves: [move], observations: [positive(route[0]!, 1), positive(route[1]!, 1)] }
  expect(possibleClueVisitTurns(evidence).get(route[0]!)).toContain(1)
  expect(possibleClueVisitTurns(evidence).get(route[1]!)).toEqual([2])
})

test('no visit-time indicators are inferred without a confirmed clue or with impossible evidence', () => {
  expect(possibleClueVisitTurns(null)).toEqual(new Map())
  expect(possibleClueVisitTurns({ start: 33, moves: [street(1)], observations: [] })).toEqual(new Map())
  expect(possibleClueVisitTurns({ start: 33, moves: [street(1)], observations: [positive(159, 1)] })).toEqual(new Map())
})
