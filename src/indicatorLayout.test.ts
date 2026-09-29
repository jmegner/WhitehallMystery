import { describe, expect, test } from 'vitest'
import { INDICATOR_OBSTACLE_PRIORITIES, indicatorObscuring, rankIndicatorPositions, selectIndicatorPosition, type IndicatorObstacle } from './indicatorLayout'

const viewport = { x: 0, y: 0, width: 300, height: 300 }
const anchor = { x: 100, y: 100, kind: 'location' as const }
const text = { width: 24, height: 12, baselineOffset: -10, padding: 1 }
const unobscured = rankIndicatorPositions(anchor, text, [], viewport)
const block = (index: number): IndicatorObstacle => ({ kind: 'box', priority: 'piece', box: unobscured[index]!.box })

describe('indicator angle selection', () => {
  test('Alt keeps the only piece-clear angle even when that angle overlaps outlines', () => {
    const ranked = rankIndicatorPositions(anchor, text, [
      { ...block(0), priority: 'outline' }, block(1), block(2),
    ], viewport)
    expect(selectIndicatorPosition(ranked, false).angle).toBe('top')
    expect(selectIndicatorPosition(ranked, true).angle).toBe('top')
  })

  test('Alt still chooses the second angle among equally piece-clear positions', () => {
    const ranked = rankIndicatorPositions(anchor, text, [block(0)], viewport)
    expect(selectIndicatorPosition(ranked, false).angle).toBe('top-right')
    expect(selectIndicatorPosition(ranked, true).angle).toBe('right')
    expect(selectIndicatorPosition(unobscured, true).angle).toBe('top-right')
  })

  test('Alt does not increase unavoidable piece overlap or board-edge clipping', () => {
    const ranked = rankIndicatorPositions(anchor, text, unobscured.map((position, index) => ({
      kind: 'box' as const, priority: 'piece' as const,
      box: { ...position.box, width: position.box.width * [0.75, 0.5, 0.25][index]! },
    })), viewport)
    expect(selectIndicatorPosition(ranked, true).angle).toBe('right')
    const clipped = rankIndicatorPositions({ ...anchor, y: 12 }, text, [], viewport)
    expect(selectIndicatorPosition(clipped, true).angle).toBe('right')
  })

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
      kind: 'box', priority: 'piece', box: { ...position.box, width: position.box.width * [0.75, 0.5, 0.25][index]! },
    }))
    const ranked = rankIndicatorPositions(anchor, text, obstacles, viewport)
    expect(ranked.map(position => position.angle)).toEqual(['right', 'top-right', 'top'])
    expect(ranked[0]!.obscuring).toBeGreaterThan(0)
  })

  test('counts overlapping pieces only once and distinguishes hollow rings from solid pieces', () => {
    const circle: IndicatorObstacle = { kind: 'circle', priority: 'piece', x: 100, y: 100, radius: 20, innerRadius: 0,
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
    const second = rankIndicatorPositions(anchor, text, [{ kind: 'box', priority: 'text', box: first.box }], viewport)[0]!
    expect(first.angle).toBe('top')
    expect(second.angle).toBe('top-right')
    expect(second.obscuring).toBe(0)
  })

  test.each(INDICATOR_OBSTACLE_PRIORITIES.slice(0, -1))('even a little %s overlap outweighs all lower-priority clutter', priority => {
    const index = INDICATOR_OBSTACLE_PRIORITIES.indexOf(priority)
    const top = unobscured[0]!.box
    const obstacles: IndicatorObstacle[] = [
      { ...block(0), priority, box: { ...top, width: top.width / 4 } },
      ...INDICATOR_OBSTACLE_PRIORITIES.slice(index + 1).map(lower => ({ ...block(1), priority: lower })),
      block(2),
    ]
    const ranked = rankIndicatorPositions(anchor, text, obstacles, viewport)
    expect(ranked.map(position => position.angle)).toEqual(['top-right', 'top', 'right'])
    expect(ranked[0]!.obscuring).toBeGreaterThan(ranked[1]!.obscuring)
  })

  test('uses lower priorities only after equal higher-priority overlap, then angle preference', () => {
    const ranked = rankIndicatorPositions(anchor, text, [
      { ...block(0), priority: 'text' }, { ...block(1), priority: 'outline' }, { ...block(2), priority: 'outline' },
    ], viewport)
    expect(ranked.map(position => position.angle)).toEqual(['top-right', 'right', 'top'])
    expect(ranked[1]!.angle).toBe('right') // Alt still selects the second-ranked angle.
  })
})
