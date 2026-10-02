import { describe, expect, test } from 'vitest'
import { possibleJackLocations, publicMovementPaths, worstCaseCrossingEliminations } from './inference'
import { adjacentCirclesForCrossing, crossings } from './mapData'
import type { PublicRoundEvidence } from './types'

const positions = { yellow: 'FP', blue: 'HP', red: 'HZ' }
const street = (slot: number) => ({ type: 'normal' as const, startSlot: slot, endSlot: slot, investigatorPositions: positions })
const evidence: PublicRoundEvidence = { start: 33, moves: [street(1), street(2)], observations: [] }

// Independent oracle: enumerate actual trails and every search permutation,
// grouping by the first clue found (or by all searches failing).
function trailsFor(round: PublicRoundEvidence): number[][] {
  let trails = [[round.start]]
  for (const [index, move] of round.moves.entries()) {
    trails = trails.flatMap(trail => publicMovementPaths(trail.at(-1)!, move).map(path => [...trail, ...path]))
      .filter(trail => round.observations.filter(observation => observation.afterMove === index + 1)
        .every(observation => observation.kind === 'arrest' ? trail.at(-1) !== observation.circleId
          : trail.includes(observation.circleId) === observation.found))
  }
  return trails
}

function permutations(ids: number[]): number[][] {
  return ids.length === 0 ? [[]] : ids.flatMap(id => permutations(ids.filter(other => other !== id)).map(rest => [id, ...rest]))
}

function remainingForOrder(trails: number[][], order: number[]): number {
  const groups = new Map<number | undefined, Set<number>>()
  for (const trail of trails) {
    const firstClue = order.find(id => trail.includes(id))
    const locations = groups.get(firstClue) ?? new Set()
    locations.add(trail.at(-1)!)
    groups.set(firstClue, locations)
  }
  return Math.max(0, ...[...groups.values()].map(locations => locations.size))
}

describe('worst-case crossing eliminations', () => {
  test.each([
    evidence,
    { ...evidence, moves: [{ ...street(1), type: 'coach' as const, endSlot: 2 }] },
    { ...evidence, observations: [{ kind: 'clue' as const, circleId: 13, found: true, afterMove: 1, investigator: 'yellow' as const }] },
    { ...evidence, observations: [{ kind: 'clue' as const, circleId: 13, found: false, afterMove: 2, investigator: 'yellow' as const },
      { kind: 'arrest' as const, circleId: 10, hit: false as const, afterMove: 2, investigator: 'blue' as const }] },
  ])('matches exhaustive trails and optimal search orders for %#', round => {
    const trails = trailsFor(round)
    const total = new Set(trails.map(trail => trail.at(-1)!)).size
    expect(total).toBe(possibleJackLocations(round).size)
    const counts = worstCaseCrossingEliminations(round)
    for (const crossing of crossings) {
      const worstRemaining = Math.min(...permutations(adjacentCirclesForCrossing(crossing.id))
        .map(order => remainingForOrder(trails, order)))
      expect(counts.get(crossing.id), crossing.id).toBe(total - worstRemaining)
    }
  })

  test('the best order matters and searches stop on a known clue', () => {
    const round = { ...evidence, moves: [street(1)] }
    const trails = trailsFor(round)
    const crossing = crossings.find(({ id }) => {
      const adjacent = adjacentCirclesForCrossing(id)
      return adjacent.includes(round.start) && adjacent.some(location => location !== round.start && possibleJackLocations(round).has(location))
    })!
    const orders = permutations(adjacentCirclesForCrossing(crossing.id))
    const residuals = orders.map(order => remainingForOrder(trails, order))
    expect(Math.max(...residuals)).toBe(possibleJackLocations(round).size)
    expect(Math.min(...residuals)).toBeLessThan(Math.max(...residuals))
    expect(worstCaseCrossingEliminations(round).get(crossing.id)).toBe(possibleJackLocations(round).size - Math.min(...residuals))
  })

  test('handles missing evidence, certain locations, and impossible evidence', () => {
    expect(worstCaseCrossingEliminations(null).size).toBe(0)
    expect(new Set(worstCaseCrossingEliminations({ ...evidence, moves: [] }).values())).toEqual(new Set([0]))
    const impossible = { ...evidence, observations: [{ kind: 'clue' as const, circleId: 33, found: false, afterMove: 2, investigator: 'yellow' as const }] }
    expect(new Set(worstCaseCrossingEliminations(impossible).values())).toEqual(new Set([0]))
    expect(worstCaseCrossingEliminations(evidence)).toBe(worstCaseCrossingEliminations(evidence))
  })

  test('scores a full round without clues and reuses its calculation', () => {
    const round = { ...evidence, moves: Array.from({ length: 15 }, (_, index) => street(index + 1)) }
    const counts = worstCaseCrossingEliminations(round)
    expect(counts.size).toBe(crossings.length)
    for (const count of counts.values()) expect(count).toBeGreaterThanOrEqual(0)
    expect(worstCaseCrossingEliminations(round)).toBe(counts)
  })
})
