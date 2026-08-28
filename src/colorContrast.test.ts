import { describe, expect, test } from 'vitest'
import { contrastingBlackOrWhite } from './colorContrast'

describe('contrastingBlackOrWhite', () => {
  test.each([
    ['#ffff00', '#000000'],
    ['#1f68ab', '#ffffff'],
    ['#b02f2e', '#ffffff'],
  ])('chooses the higher-contrast text color for %s', (background, expected) => {
    expect(contrastingBlackOrWhite(background)).toBe(expected)
  })
})
