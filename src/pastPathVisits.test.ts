import { expect, test } from 'vitest'
import { pastPathVisits } from './pastPathVisits'
import type { JackMoveType, PublicMoveEvidence } from './game/types'

const move = (type: JackMoveType, startSlot: number, endSlot = startSlot): PublicMoveEvidence => ({
  type, startSlot, endSlot, investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' },
})

test('combines repeated visits into one exact move list at each location', () => {
  const markers = pastPathVisits([{ round: 1, locations: [33, 11, 22, 44, 55, 13, 66, 13] }])
  expect(markers.find(marker => marker.location === 13)).toEqual({
    location: 13, visits: [{ round: 1, move: 5, type: 'normal' }, { round: 1, move: 7, type: 'normal' }], label: '5,7',
  })
  expect(markers.map(marker => marker.label)).toEqual(['1', '2', '3', '4', '5,7', '6'])
})

test('distinguishes revisits in different rounds without stacking markers', () => {
  const markers = pastPathVisits([{ round: 1, locations: [33, 44, 55, 44] }, { round: 2, locations: [46, 44, 147] }])
  expect(markers.find(marker => marker.location === 44)?.label).toBe('1.1,1.3,2.1')
  expect(markers.filter(marker => marker.location === 44)).toHaveLength(1)
  expect(markers.find(marker => marker.location === 147)?.label).toBe('2.2')
})

test('keeps single-round move labels short and omits unmoved starting locations', () => {
  expect(pastPathVisits([{ round: 2, locations: [46, 60, 46] }]).map(marker => marker.label)).toEqual(['1', '2'])
  expect(pastPathVisits([{ round: 1, locations: [33] }])).toEqual([])
  expect(pastPathVisits([])).toEqual([])
})

test('suffixes each visit using its recorded move, including both Coach stops', () => {
  const markers = pastPathVisits([{ round: 1, locations: [33, 44, 55, 44, 55, 44, 55],
    moves: [move('coach', 1, 2), move('normal', 3), move('alley', 4), move('boat', 5), move('normal', 6)] }])
  expect(markers.find(marker => marker.location === 44)?.label).toBe('1C,3,5B')
  expect(markers.find(marker => marker.location === 55)?.label).toBe('2C,4A,6')
})

test('keeps movement suffixes attached to the correct round when visits are combined', () => {
  const markers = pastPathVisits([
    { round: 2, locations: [46, 44, 55], moves: [move('coach', 1, 2)] },
    { round: 1, locations: [33, 44, 55], moves: [move('alley', 1), move('boat', 2)] },
  ])
  expect(markers.find(marker => marker.location === 44)?.label).toBe('1.1A,2.1C')
  expect(markers.find(marker => marker.location === 55)?.label).toBe('1.2B,2.2C')
})
