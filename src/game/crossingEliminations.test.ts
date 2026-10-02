import { describe, expect, test } from 'vitest'
import { possibleJackLocations, possibleJackSearchOutcomes, publicMovementPaths, worstCaseCrossingEliminations } from './inference'
import { adjacentCirclesForCrossing, crossings } from './mapData'
import type { InvestigatorColor, PublicRoundEvidence } from './types'

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

function remainingForOrder(trails: number[][], order: number[], project = (id: number) => [id]): number {
  const groups = new Map<number | undefined, Set<number>>()
  for (const trail of trails) {
    const firstClue = order.find(id => trail.includes(id))
    const locations = groups.get(firstClue) ?? new Set()
    for (const id of project(trail.at(-1)!)) locations.add(id)
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

  test.each([
    evidence,
    { ...evidence, moves: [{ ...street(1), type: 'coach' as const, endSlot: 2 }] },
    { ...evidence, observations: [{ kind: 'clue' as const, circleId: 13, found: true, afterMove: 1, investigator: 'yellow' as const },
      { kind: 'arrest' as const, circleId: 10, hit: false as const, afterMove: 2, investigator: 'blue' as const }] },
  ])('projects current searches through a later Street move and optimizes that perspective for %#', round => {
    const trails = trailsFor(round)
    const forecastPositions = { yellow: 'DM', blue: 'FP', red: 'HZ' }
    const project = (id: number) => publicMovementPaths(id, { ...street(3), investigatorPositions: forecastPositions })
      .map(path => path.at(-1)!)
    const projected = (paths: number[][]) => new Set(paths.flatMap(trail => project(trail.at(-1)!)))
    const total = projected(trails).size
    const outcomes = possibleJackSearchOutcomes(round, forecastPositions)
    expect([...outcomes.keys()]).toEqual([...possibleJackSearchOutcomes(round).keys()])
    for (const [id, outcome] of outcomes) {
      expect(outcome.ifYes, `yes at ${id}`).toEqual(projected(trails.filter(trail => trail.includes(id))))
      expect(outcome.ifNo, `no at ${id}`).toEqual(projected(trails.filter(trail => !trail.includes(id))))
    }
    const counts = worstCaseCrossingEliminations(round, forecastPositions)
    for (const crossing of crossings) {
      const residual = Math.min(...permutations(adjacentCirclesForCrossing(crossing.id))
        .map(order => remainingForOrder(trails, order, project)))
      expect(counts.get(crossing.id), crossing.id).toBe(total - residual)
    }
    expect(counts).not.toBe(worstCaseCrossingEliminations(round))
    expect(worstCaseCrossingEliminations(round, { ...forecastPositions })).toBe(counts)
  })

  test('a future visit cannot be searched now, and a known current position can have many future destinations', () => {
    const round = { ...evidence, moves: [] }
    const next = possibleJackSearchOutcomes(round, positions)
    expect([...next.keys()]).toEqual([33])
    expect(next.get(33)!.ifYes.size).toBeGreaterThan(1)
    expect(next.get(33)!.ifNo.size).toBe(0)
    expect(next.get(33)!.positiveMeansJackIsThereNow).toBe(false)
    expect(new Set(worstCaseCrossingEliminations(round, positions).values())).toEqual(new Set([0]))
  })

  test('forecasts respect current investigator blockers and invalidate cached scores when they move', () => {
    const forecastPositions: Partial<Record<InvestigatorColor, string>> = {}
    const open = worstCaseCrossingEliminations(evidence, forecastPositions)
    const openOutcomes = possibleJackSearchOutcomes(evidence, forecastPositions)
    const blockedPositions = { yellow: 'CZ', blue: 'DM', red: 'DG' }
    const blocked = worstCaseCrossingEliminations(evidence, blockedPositions)
    expect(blocked).not.toBe(open)
    const trails = trailsFor(evidence)
    const project = (id: number) => publicMovementPaths(id, { ...street(3), investigatorPositions: blockedPositions })
      .map(path => path.at(-1)!)
    const total = new Set(trails.flatMap(trail => project(trail.at(-1)!))).size
    for (const crossing of crossings) {
      const residual = Math.min(...permutations(adjacentCirclesForCrossing(crossing.id))
        .map(order => remainingForOrder(trails, order, project)))
      expect(blocked.get(crossing.id), crossing.id).toBe(total - residual)
    }
    const blockedOutcomes = possibleJackSearchOutcomes(evidence, blockedPositions)
    expect([...blockedOutcomes.values()].some((outcome, index) =>
      outcome.ifYes.size !== [...openOutcomes.values()][index]!.ifYes.size)).toBe(true)
    for (const [id, outcome] of blockedOutcomes) {
      expect(outcome.ifYes).toEqual(new Set(trails.filter(trail => trail.includes(id)).flatMap(trail => project(trail.at(-1)!))))
      expect(outcome.ifNo).toEqual(new Set(trails.filter(trail => !trail.includes(id)).flatMap(trail => project(trail.at(-1)!))))
    }
    expect(worstCaseCrossingEliminations(evidence, {})).toBe(open)
  })
})
