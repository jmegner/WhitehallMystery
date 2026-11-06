import { expect, test, type Page } from '@playwright/test'
import { createInitialGame } from '../../src/game/gameEngine'
import { circles } from '../../src/game/mapData'
import { reviewScreenshot } from './reviewScreenshot'
import type { PublicMoveEvidence } from '../../src/game/types'

async function restore(page: Page, trail: number[], moves?: Pick<PublicMoveEvidence, 'type' | 'startSlot' | 'endSlot'>[]) {
  const positions = { yellow: 'FP', blue: 'HP', red: 'HZ' }
  const committedMoves: Pick<PublicMoveEvidence, 'type' | 'startSlot' | 'endSlot'>[] = moves ?? trail.slice(1).map((_, index) => ({
    type: 'normal', startSlot: index + 1, endSlot: index + 1,
  }))
  const state = { ...createInitialGame(), stage: 'jackMove', currentJack: trail.at(-1)!, moveSlot: trail.length - 1,
    discoveryLocations: [33, 46, 147, 159], reachedDiscoveries: [33], roundTrail: trail, investigatorPositions: positions,
    publicRound: { start: trail[0]!, observations: [], moves: committedMoves.map(move => ({ ...move, investigatorPositions: positions })) } }
  await page.addInitScript(state => {
    if (localStorage.getItem('whitehall-mystery.game.v1')) return
    localStorage.setItem('whitehall-mystery.game.v1', JSON.stringify({ version: 1, state }))
  }, state)
  await page.goto('/')
}

async function expectTightRectangles(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  await expect.poll(() => page.locator('.past-path-step').evaluateAll(markers => markers.flatMap(marker => {
    const rect = marker.querySelector('rect')!
    const bounds = marker.querySelector('text')!.getBBox()
    if (!rect) return [{ label: marker.textContent, missingRectangle: true }]
    const padding = { label: marker.textContent, left: bounds.x - rect.x.baseVal.value,
      top: bounds.y - rect.y.baseVal.value,
      right: rect.x.baseVal.value + rect.width.baseVal.value - bounds.x - bounds.width,
      bottom: rect.y.baseVal.value + rect.height.baseVal.value - bounds.y - bounds.height }
    return Math.abs(padding.left - 2) < 0.1 && Math.abs(padding.right - 2) < 0.1 &&
      Math.abs(padding.top - 1.5) < 0.1 && Math.abs(padding.bottom - 1.5) < 0.1 ? [] : [padding]
  }))).toEqual([])
  await expect(page.locator('.past-path-step circle')).toHaveCount(0)
}

test('hovered shortest routes paint above overlapping past badges without blocking board input', async ({ page }) => {
  await restore(page, [33, 13, 33, 13, 33])
  await page.getByRole('checkbox', { name: 'past', exact: true }).check()
  await page.getByRole('checkbox', { name: 'maybes', exact: true }).check()
  await page.locator('.map-hit-target[data-board-hover="location:1"]').hover()
  await expect(page.locator('.route-preview-line').first()).toBeVisible()
  const label = page.locator('.route-turn-count[aria-label^="Location 13:"]')
  await expect(label).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  // Inspect the browser's actual stacking at an overlap. Temporarily enable
  // hit testing on these decorative shapes without changing their paint order.
  const stacking = await label.evaluate(label => {
    const badge = document.querySelector('.past-path-step[data-location="13"] rect')! as SVGRectElement
    const a = label.getBoundingClientRect()
    const b = badge.getBoundingClientRect()
    const left = Math.max(a.left, b.left), right = Math.min(a.right, b.right)
    const top = Math.max(a.top, b.top), bottom = Math.min(a.bottom, b.bottom)
    const shapes = [label, badge] as SVGElement[]
    const previous = shapes.map(shape => shape.style.pointerEvents)
    shapes.forEach(shape => { shape.style.pointerEvents = 'all' })
    const hits = document.elementsFromPoint((left + right) / 2, (top + bottom) / 2)
    shapes.forEach((shape, index) => { shape.style.pointerEvents = previous[index]! })
    return { overlap: right > left && bottom > top, labelHit: hits.indexOf(label), badgeHit: hits.indexOf(badge) }
  })
  expect(stacking.overlap).toBe(true)
  expect(stacking.labelHit).toBeGreaterThanOrEqual(0)
  expect(stacking.badgeHit).toBeGreaterThan(stacking.labelHit)
  expect(await page.locator('.map-hover-indicators *').evaluateAll(elements =>
    elements.every(element => getComputedStyle(element).pointerEvents === 'none'),
  )).toBe(true)
  await reviewScreenshot(page.locator('.game-board'), { path: test.info().outputPath('route-above-past.png') })
  await page.locator('.jack-marker').hover()
  await expect(page.locator('.route-preview-line')).toHaveCount(0)
  expect(await page.locator('.route-turn-count').count()).toBeGreaterThan(0)
  await page.mouse.move(0, 0)
  await expect(page.locator('.route-turn-count')).toHaveCount(0)
  await expect(page.locator('.past-path-step')).toHaveCount(2)
})

test('past badges show every backtracking visit in tight rectangles and preserve the past preference', async ({ page }) => {
  await restore(page, [33, 13, 33, 13, 33, 13, 33, 13])
  await expect(page.locator('.past-path-step')).toHaveCount(0)
  const past = page.getByRole('checkbox', { name: 'past', exact: true })
  await past.check()
  await expect(page.locator('.past-path-step')).toHaveCount(2)
  await expect(page.locator('.past-path-step[data-location="13"] text')).toHaveText('1,3,5,7')
  await expect(page.locator('.past-path-step[data-location="33"] text')).toHaveText('2,4,6')
  await expect(page.locator('.past-path-line')).toHaveCount(7)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1200 })
    await expectTightRectangles(page)
    await expect(page.locator('.past-path-step rect').first()).toHaveCSS('stroke', 'rgb(211, 31, 38)')
    await expect(page.locator('.past-path-step text').first()).toHaveCSS('fill', 'rgb(163, 19, 26)')
    await reviewScreenshot(page.locator('.game-board'), { path: test.info().outputPath(`backtracking-badges-${width}.png`) })
  }
  await page.reload()
  await expect(past).toBeChecked()
  await expect(page.locator('.past-path-step[data-location="13"] text')).toHaveText('1,3,5,7')
  await expectTightRectangles(page)
  await past.uncheck()
  await expect(page.locator('.past-path-step')).toHaveCount(0)
})

test('long backtracking lists remain complete and inside the right edge of the board', async ({ page }) => {
  const rightmost = circles.reduce((rightmost, circle) => circle.x > rightmost.x ? circle : rightmost).id
  await restore(page, [33, ...Array.from({ length: 13 }, (_, index) => index % 2 === 0 ? rightmost : 13)])
  await page.getByRole('checkbox', { name: 'past', exact: true }).check()
  const marker = page.locator(`.past-path-step[data-location="${rightmost}"]`)
  await expect(marker.locator('text')).toHaveText('1,3,5,7,9,11,13')
  await expectTightRectangles(page)
  const bounds = (await marker.boundingBox())!
  const board = (await page.locator('.game-board').boundingBox())!
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(board.x + board.width)
  await reviewScreenshot(page.locator('.game-board'), { path: test.info().outputPath('right-edge-backtracking.png') })
})

test('past visit suffixes show committed Coach, Alley and Boat moves in compact grouped labels', async ({ page }) => {
  await restore(page, [33, 13, 33, 13, 33, 13, 33, 13], [
    { type: 'coach', startSlot: 1, endSlot: 2 }, { type: 'normal', startSlot: 3, endSlot: 3 },
    { type: 'alley', startSlot: 4, endSlot: 4 }, { type: 'boat', startSlot: 5, endSlot: 5 },
    { type: 'normal', startSlot: 6, endSlot: 6 }, { type: 'normal', startSlot: 7, endSlot: 7 },
  ])
  await page.getByRole('checkbox', { name: 'past', exact: true }).check()
  const first = page.locator('.past-path-step[data-location="13"] text')
  const second = page.locator('.past-path-step[data-location="33"] text')
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(first).toHaveText('1C,3,5B,7')
    await expect(second).toHaveText('2C,4A,6')
    await expectTightRectangles(page)
    await reviewScreenshot(page.locator('.game-board'), { path: test.info().outputPath(`special-move-badges-${width}.png`) })
  }
  await page.getByRole('button', { name: 'Coach (2)', exact: true }).click()
  await expect(first).toHaveText('1C,3,5B,7')
  await expect(second).toHaveText('2C,4A,6')
  await page.reload()
  await expect(first).toHaveText('1C,3,5B,7')
  await expect(second).toHaveText('2C,4A,6')
})
