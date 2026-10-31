import { expect, test } from 'vitest'
import { pastPathVisits } from './pastPathVisits'

test('combines repeated visits into one exact move list at each location', () => {
  const markers = pastPathVisits([{ round: 1, locations: [33, 11, 22, 44, 55, 13, 66, 13] }])
  expect(markers.find(marker => marker.location === 13)).toEqual({
    location: 13, visits: [{ round: 1, move: 5 }, { round: 1, move: 7 }], label: '5,7',
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
