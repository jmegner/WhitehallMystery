import { expect, test } from 'vitest'
import { possibleClueVisitTurns, possibleJackLocations, possibleJackLocationsAfterMove, possibleJackSearchOutcomes,
  possibleJackSearchOutcomesAfterMove, publicMovementPaths, worstCaseCrossingEliminations } from './inference'
import { adjacentCirclesForCrossing, crossings } from './mapData'
import type { PublicMoveEvidence, PublicObservation, PublicRoundEvidence } from './types'

const positions = { yellow: 'FP', blue: 'HP', red: 'HZ' }
const street = (slot: number): PublicMoveEvidence => ({ type: 'normal', startSlot: slot, endSlot: slot, investigatorPositions: positions })
const clue = (circleId: number, afterMove: number, found = true): PublicObservation =>
  ({ kind: 'clue', circleId, afterMove, found, investigator: 'yellow' })
const base: PublicRoundEvidence = { start: 33, moves: [street(1), street(2), street(3)], observations: [] }

interface Visit { id: number; slot: number; move: number }

// Independent exhaustive oracle: score complete legal trails before filtering
// by observations. This also catches premature pruning of expensive prefixes.
function bestTrails(evidence: PublicRoundEvidence, forecast?: PublicMoveEvidence) {
  let trails: Visit[][] = [[{ id: evidence.start, slot: 0, move: 0 }]]
  const earliest = new Map([[evidence.start, 0]])
  const moves = forecast ? [...evidence.moves, forecast] : evidence.moves
  for (const [index, move] of moves.entries()) {
    trails = trails.flatMap(trail => publicMovementPaths(trail.at(-1)!.id, move).map(path => [
      ...trail, ...path.map((id, step) => ({ id, slot: move.startSlot + step, move: index + 1 })),
    ]))
    for (const trail of trails) for (const { id, slot } of trail) earliest.set(id, Math.min(earliest.get(id) ?? Infinity, slot))
  }
  const consistent = trails.filter(trail => evidence.observations.every(observation => {
    const past = trail.filter(visit => visit.move <= observation.afterMove)
    return observation.kind === 'arrest' ? past.at(-1)!.id !== observation.circleId
      : past.some(visit => visit.id === observation.circleId) === observation.found
  }))
  const score = (trail: Visit[]) => trail.reduce((sum, visit) => sum + visit.slot - earliest.get(visit.id)!, 0)
  const minimum = Math.min(...consistent.map(score))
  return { trails: consistent.filter(trail => score(trail) === minimum), minimum }
}

const locations = (trails: Visit[][]) => new Set(trails.map(trail => trail.at(-1)!.id))

const cases: PublicRoundEvidence[] = [
  base,
  { ...base, moves: [street(1), { ...street(2), investigatorPositions: { yellow: 'CZ', blue: 'DM', red: 'DG' } }, street(3)] },
  { ...base, observations: [clue(13, 1), clue(10, 3)] },
  { ...base, observations: [clue(13, 2, false), { kind: 'arrest', circleId: 10, afterMove: 3, hit: false, investigator: 'blue' }] },
  { ...base, moves: [{ ...street(1), type: 'coach', endSlot: 2 }, street(3)], observations: [clue(36, 1)] },
  { ...base, moves: [{ ...street(1), type: 'alley' }, street(2), street(3)] },
  { ...base, start: 154, moves: [{ ...street(1), type: 'boat' }, street(2), street(3)], observations: [clue(154, 2)] },
]

test.each(cases)('sprint locations, search outcomes and clue turns match the best complete trails: %#', evidence => {
  const { trails } = bestTrails(evidence)
  expect(trails.length).toBeGreaterThan(0)
  expect(possibleJackLocations(evidence, true)).toEqual(locations(trails))
  const outcomes = possibleJackSearchOutcomes(evidence, undefined, true)
  const searched = new Set(trails.flatMap(trail => trail.map(visit => visit.id)))
  expect(new Set(outcomes.keys())).toEqual(searched)
  for (const [id, outcome] of outcomes) {
    expect(outcome.ifYes, `yes at ${id}`).toEqual(locations(trails.filter(trail => trail.some(visit => visit.id === id))))
    expect(outcome.ifNo, `no at ${id}`).toEqual(locations(trails.filter(trail => trail.every(visit => visit.id !== id))))
  }
  const visitTurns = possibleClueVisitTurns(evidence, true)
  expect(new Set(visitTurns.keys())).toEqual(new Set([...searched].filter(id =>
    trails.every(trail => trail.some(visit => visit.id === id)))))
  for (const observation of evidence.observations) {
    if (observation.kind !== 'clue' || !observation.found) continue
    expect(visitTurns.get(observation.circleId)).toEqual([...new Set(trails.flatMap(trail =>
      trail.filter(visit => visit.id === observation.circleId).map(visit => visit.slot)))].sort((a, b) => a - b))
  }
})

test('sprint excludes backtracking and sideways late arrivals without changing normal inference', () => {
  const sprint = possibleJackLocations(base, true)
  const normal = possibleJackLocations(base)
  expect(sprint.size).toBeGreaterThan(0)
  expect(sprint.size).toBeLessThan(normal.size)
  for (const earlierMoves of [[], [street(1)], [street(1), street(2)]]) {
    for (const earlier of possibleJackLocations({ ...base, moves: earlierMoves })) expect(sprint.has(earlier)).toBe(false)
  }
  expect(possibleJackLocations(base, false)).toEqual(normal)
})

test('new clues relax sprint by exactly the necessary inefficiency, including forced backtracking', () => {
  const neighbors = (id: number) => publicMovementPaths(id, street(1)).flat()
  const first = neighbors(33).find(id => neighbors(33).some(other => other !== id && !neighbors(id).includes(other)
    && neighbors(id).filter(common => neighbors(other).includes(common)).every(common => common === 33)))!
  const second = neighbors(33).find(other => other !== first && !neighbors(first).includes(other)
    && neighbors(first).filter(common => neighbors(other).includes(common)).every(common => common === 33))!
  expect(first).toBeDefined()
  expect(second).toBeDefined()
  const evidence = { ...base, observations: [clue(first, 1), clue(second, 3)] }
  const { trails, minimum } = bestTrails(evidence)
  expect(minimum).toBeGreaterThan(0)
  expect(trails.length).toBeGreaterThan(0)
  expect(trails.every(trail => trail[2]!.id === 33)).toBe(true)
  expect(possibleJackLocations(evidence, true)).toEqual(locations(trails))
})

test.each(cases.slice(0, 5))('sprint forecasts score the next move without turning future visits into current clues: %#', evidence => {
  const forecast = street((evidence.moves.at(-1)?.endSlot ?? 0) + 1)
  const { trails } = bestTrails(evidence, forecast)
  const expected = locations(trails)
  expect(possibleJackLocationsAfterMove(evidence, 'normal', positions, forecast.startSlot - 1, true)).toEqual(expected)
  const outcomes = possibleJackSearchOutcomes(evidence, positions, true)
  const searchable = (trail: Visit[], id: number) => trail.some(visit => visit.move <= evidence.moves.length && visit.id === id)
  expect(new Set(outcomes.keys())).toEqual(new Set(trails.flatMap(trail => trail.filter(visit => visit.move <= evidence.moves.length).map(visit => visit.id))))
  for (const [id, outcome] of outcomes) {
    expect(outcome.ifYes).toEqual(locations(trails.filter(trail => searchable(trail, id))))
    expect(outcome.ifNo).toEqual(locations(trails.filter(trail => !searchable(trail, id))))
  }
  const visits = possibleClueVisitTurns(evidence, true, forecast)
  const certainPastVisits = new Set(trails[0]!.filter(visit => visit.move <= evidence.moves.length)
    .map(visit => visit.id).filter(id => trails.every(trail => searchable(trail, id))))
  expect(new Set(visits.keys())).toEqual(certainPastVisits)
  for (const id of certainPastVisits) {
    expect(visits.get(id)).toEqual([...new Set(trails.flatMap(trail => trail.filter(visit =>
      visit.move <= evidence.moves.length && visit.id === id).map(visit => visit.slot)))].sort((a, b) => a - b))
  }
  for (const observation of evidence.observations) {
    if (observation.kind !== 'clue' || !observation.found) continue
    expect(visits.get(observation.circleId)).toEqual([...new Set(trails.flatMap(trail => trail.filter(visit =>
      visit.move <= evidence.moves.length && visit.id === observation.circleId).map(visit => visit.slot)))].sort((a, b) => a - b))
  }
  const afterMove = possibleJackSearchOutcomesAfterMove(evidence, 'normal', positions, forecast.startSlot - 1, true)
  expect(new Set([...afterMove.values()].flatMap(outcome => [...outcome.ifYes]))).toEqual(expected)
})

const permutations = (ids: number[]): number[][] => ids.length ? ids.flatMap(id =>
  permutations(ids.filter(other => other !== id)).map(rest => [id, ...rest])) : [[]]

test.each([false, true])('worst search counts condition the best trails without switching to worse trails (next=%s)', next => {
  const evidence = { ...base, observations: [clue(13, 1)] }
  const { trails } = bestTrails(evidence, next ? street(4) : undefined)
  const total = locations(trails).size
  const counts = worstCaseCrossingEliminations(evidence, next ? positions : undefined, true)
  for (const crossing of crossings) {
    const residuals = permutations(adjacentCirclesForCrossing(crossing.id)).map(order => {
      const groups = new Map<number | undefined, Set<number>>()
      for (const trail of trails) {
        const firstClue = order.find(id => trail.some(visit => visit.move <= evidence.moves.length && visit.id === id))
        const current = groups.get(firstClue) ?? new Set<number>()
        current.add(trail.at(-1)!.id)
        groups.set(firstClue, current)
      }
      return Math.max(0, ...[...groups.values()].map(group => group.size))
    })
    expect(counts.get(crossing.id), crossing.id).toBe(total - Math.min(...residuals))
  }
  expect(worstCaseCrossingEliminations(evidence, next ? positions : undefined, true)).toBe(counts)
  expect(worstCaseCrossingEliminations(evidence, next ? positions : undefined)).not.toBe(counts)
})

test('sprint handles a full round, separate clue caches, missing evidence, and impossible clues', () => {
  const round = { ...base, moves: Array.from({ length: 15 }, (_, index) => street(index + 1)) }
  expect(possibleJackLocations(round, true).size).toBeGreaterThan(0)
  const evidence = { ...base, observations: [clue(13, 1)] }
  const normalVisits = possibleClueVisitTurns(evidence)
  const sprintVisits = possibleClueVisitTurns(evidence, true)
  expect(sprintVisits.get(13)).toEqual([1])
  expect(normalVisits.get(13)).toContain(3)
  expect(possibleClueVisitTurns(evidence)).toBe(normalVisits)
  expect(possibleClueVisitTurns(evidence, true)).toBe(sprintVisits)
  expect(possibleJackLocations(null, true).size).toBe(0)
  expect(possibleJackLocations({ ...base, observations: [clue(33, 2, false)] }, true).size).toBe(0)
})
