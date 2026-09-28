import { describe, expect, test } from 'vitest'
import { indicatorObscuring, rankIndicatorPositions, type IndicatorObstacle } from './indicatorLayout'

const viewport = { x: 0, y: 0, width: 300, height: 300 }
const anchor = { x: 100, y: 100, kind: 'location' as const }
const text = { width: 24, height: 12, baselineOffset: -10, padding: 1 }
const unobscured = rankIndicatorPositions(anchor, text, [], viewport)
const block = (index: number): IndicatorObstacle => ({ kind: 'box', box: unobscured[index]!.box })

describe('indicator angle selection', () => {
  test('breaks clear-space ties with top, top-right, then right; alt is the second choice', () => {
    expect(unobscured.map(position => position.angle)).toEqual(['top', 'top-right', 'right'])
    expect(unobscured.every(position => position.obscuring === 0)).toBe(true)
    expect(unobscured[1]!.angle).toBe('top-right')
  })

  test('moves away from blocked top and diagonal positions and ranks the remaining fallback', () => {
    expect(rankIndicatorPositions(anchor, text, [block(0)], viewport).map(position => position.angle))
      .toEqual(['top-right', 'right', 'top'])
    const ranked = rankIndicatorPositions(anchor, text, [block(0), block(1)], viewport)
    expect(ranked[0]!.angle).toBe('right')
    expect(ranked[1]!.obscuring).toBeGreaterThan(ranked[0]!.obscuring)
  })

  test('chooses the least covered angle when none is completely clear', () => {
    const obstacles = unobscured.map((position, index): IndicatorObstacle => ({
      kind: 'box', box: { ...position.box, width: position.box.width * [0.75, 0.5, 0.25][index]! },
    }))
    const ranked = rankIndicatorPositions(anchor, text, obstacles, viewport)
    expect(ranked.map(position => position.angle)).toEqual(['right', 'top-right', 'top'])
    expect(ranked[0]!.obscuring).toBeGreaterThan(0)
  })

  test('counts overlapping pieces only once and distinguishes hollow rings from solid pieces', () => {
    const circle: IndicatorObstacle = { kind: 'circle', x: 100, y: 100, radius: 20, innerRadius: 0,
      box: { x: 80, y: 80, width: 40, height: 40 } }
    const center = { x: 96, y: 96, width: 8, height: 8 }
    expect(indicatorObscuring(center, [circle], viewport)).toBe(1)
    expect(indicatorObscuring(center, [circle, circle], viewport)).toBe(1)
    expect(indicatorObscuring(center, [{ ...circle, innerRadius: 16 }], viewport)).toBe(0)
    expect(indicatorObscuring({ x: 118, y: 118, width: 2, height: 2 }, [circle], viewport)).toBe(0)
  })

  test('accounts for glyph width and board-edge clipping', () => {
    const ranked = rankIndicatorPositions({ ...anchor, y: 12 }, text, [], viewport)
    expect(ranked.map(position => position.angle)).toEqual(['right', 'top-right', 'top'])
    const atRight = { ...anchor, x: 268 }
    expect(rankIndicatorPositions(atRight, { ...text, width: 55 }, [], viewport)[0]!.angle).toBe('top')
  })

  test('reserves an earlier indicator so two labels at one location do not share the top slot', () => {
    const first = rankIndicatorPositions(anchor, text, [], viewport)[0]!
    const second = rankIndicatorPositions(anchor, text, [{ kind: 'box', box: first.box }], viewport)[0]!
    expect(first.angle).toBe('top')
    expect(second.angle).toBe('top-right')
    expect(second.obscuring).toBe(0)
  })
})
