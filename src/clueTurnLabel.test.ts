import { expect, test } from 'vitest'
import { clueTurnLabel, estimatedClueTurnLabelWidth } from './clueTurnLabel'

test('sorts and deduplicates visits, collapses ranges, and retains gaps', () => {
  expect(clueTurnLabel([9, 2, 7, 8, 2, 12], 100)).toEqual({ text: 'M2,7-9,12', fullText: 'M2,7-9,12' })
  expect(clueTurnLabel([0])).toEqual({ text: 'M0', fullText: 'M0' })
  expect(clueTurnLabel([])).toEqual({ text: '', fullText: '' })
})

test('summarizes wide text with the earliest and latest turn while preserving the exact list', () => {
  expect(clueTurnLabel([2, 4, 6, 8, 10, 12])).toEqual({ text: 'M2..12', fullText: 'M2,4,6,8,10,12' })
  expect(clueTurnLabel([7, 8, 9])).toEqual({ text: 'M7-9', fullText: 'M7-9' })
})

test('uses estimated horizontal glyph widths rather than a character limit', () => {
  expect('1,11,13'.length).toBe('8,10,12'.length)
  const width = estimatedClueTurnLabelWidth('M1,11,13')
  expect(estimatedClueTurnLabelWidth('M8,10,12')).toBeGreaterThan(width)
  expect(clueTurnLabel([1, 11, 13], width).text).toBe('M1,11,13')
  expect(clueTurnLabel([8, 10, 12], width).text).toBe('M8..12')
})
