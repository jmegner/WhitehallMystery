import { expect, test } from 'vitest'
import { possibleAlleyNeeds } from './alleyInference'
import { possibleJackLocations, publicMovementPaths } from './inference'
import { alleyEvidence, alleyPositions } from '../../tests/fixtures/alleyEvidence'

test('distinguishes could need Alley, definitely needs Alley, and an ordinary Street destination', () => {
  const evidence = alleyEvidence()
  const before = { ...evidence, moves: evidence.moves.slice(0, -1) }
  expect(possibleJackLocations(before)).toEqual(new Set([43, 46]))
  const move = evidence.moves.at(-1)!
  expect(publicMovementPaths(43, { ...move, type: 'normal' }).flat()).toContain(60)
  expect(publicMovementPaths(46, { ...move, type: 'normal' }).flat()).not.toContain(60)
  const result = possibleAlleyNeeds(evidence)
  expect(result.get(60)).toBe('could')
  expect(result.get(47)).toBe('definite')
  expect(result.has(44)).toBe(false)
  expect(possibleJackLocations(evidence).has(44)).toBe(true)
})

test('uses the investigator blockers when the Alley was made, including alternative Street routes', () => {
  const evidence = alleyEvidence()
  const move = evidence.moves.at(-1)!
  const blocked = { ...evidence, moves: [...evidence.moves.slice(0, -1), {
    ...move, investigatorPositions: { yellow: 'JR', blue: 'JZ', red: alleyPositions.red },
  }] }
  expect(possibleAlleyNeeds(blocked).get(60)).toBe('definite')
  const oneRouteOpen = { ...blocked, moves: [...blocked.moves.slice(0, -1), {
    ...move, investigatorPositions: { ...alleyPositions, yellow: 'JR' },
  }] }
  expect(possibleAlleyNeeds(oneRouteOpen).get(60)).toBe('could')
})

test('removes locations ruled out by subsequent searches without changing earlier evidence', () => {
  const evidence = alleyEvidence()
  const original = JSON.stringify(evidence)
  const searched = { ...evidence, observations: [...evidence.observations, {
    kind: 'clue' as const, circleId: 47, found: false, afterMove: evidence.moves.length, investigator: 'yellow' as const,
  }] }
  expect(possibleAlleyNeeds(searched).has(47)).toBe(false)
  expect(possibleAlleyNeeds(searched).get(60)).toBe('could')
  expect(JSON.stringify(evidence)).toBe(original)
})

test('handles known older clues and Coach slots without confusing slots with public move indices', () => {
  expect(possibleAlleyNeeds(alleyEvidence(true)).get(60)).toBe('could')
  const coach = alleyEvidence(false, true)
  expect(coach.moves.at(-1)!.endSlot).toBe(3)
  expect(possibleAlleyNeeds(coach).get(60)).toBe('could')
  expect(possibleAlleyNeeds(coach).get(47)).toBe('definite')
})

test('sprint filters displayed endpoints without strengthening a could deduction into a definite one', () => {
  const evidence = alleyEvidence(true)
  const exact = possibleAlleyNeeds(evidence)
  const sprint = possibleAlleyNeeds(evidence, true)
  const possible = possibleJackLocations(evidence, true)
  expect(sprint.size).toBeGreaterThan(0)
  for (const [id, need] of sprint) {
    expect(possible.has(id)).toBe(true)
    expect(need).toBe(exact.get(id))
  }
})

test.each(['normal', 'coach', 'boat'] as const)('does not retain Alley annotations after a %s move', type => {
  const evidence = alleyEvidence()
  expect(possibleAlleyNeeds({ ...evidence, moves: [...evidence.moves, { ...evidence.moves.at(-1)!, type }] }).size).toBe(0)
})

test('handles missing evidence and a newly started round', () => {
  expect(possibleAlleyNeeds(null).size).toBe(0)
  expect(possibleAlleyNeeds({ start: 24, moves: [], observations: [] }).size).toBe(0)
})
