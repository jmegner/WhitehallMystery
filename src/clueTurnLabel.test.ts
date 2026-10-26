import { expect, test } from 'vitest'
import { clueTurnLabel, estimatedClueTurnLabelWidth } from './clueTurnLabel'

test('sorts and deduplicates visits, collapses ranges, and retains gaps', () => {
  expect(clueTurnLabel([9, 2, 7, 8, 2, 12], 100)).toEqual({ text: '2,7-9,12', fullText: '2,7-9,12' })
  expect(clueTurnLabel([0])).toEqual({ text: '0', fullText: '0' })
  expect(clueTurnLabel([])).toEqual({ text: '', fullText: '' })
})

test('summarizes wide text with the earliest and latest turn while preserving the exact list', () => {
  expect(clueTurnLabel([2, 4, 6, 8, 10, 12])).toEqual({ text: '2..12', fullText: '2,4,6,8,10,12' })
  expect(clueTurnLabel([7, 8, 9])).toEqual({ text: '7-9', fullText: '7-9' })
})

test('uses estimated horizontal glyph widths rather than a character limit', () => {
  expect('1,11,13'.length).toBe('8,10,12'.length)
  const width = estimatedClueTurnLabelWidth('1,11,13')
  expect(estimatedClueTurnLabelWidth('8,10,12')).toBeGreaterThan(width)
  expect(clueTurnLabel([1, 11, 13], width).text).toBe('1,11,13')
  expect(clueTurnLabel([8, 10, 12], width).text).toBe('8..12')
})
