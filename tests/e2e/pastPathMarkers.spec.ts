import { expect, test, type Page } from '@playwright/test'
import { createInitialGame } from '../../src/game/gameEngine'
import { circles } from '../../src/game/mapData'
import { reviewScreenshot } from './reviewScreenshot'

async function restore(page: Page, trail: number[]) {
  const positions = { yellow: 'FP', blue: 'HP', red: 'HZ' }
  const state = { ...createInitialGame(), stage: 'jackMove', currentJack: trail.at(-1)!, moveSlot: trail.length - 1,
    discoveryLocations: [33, 46, 147, 159], reachedDiscoveries: [33], roundTrail: trail, investigatorPositions: positions,
    publicRound: { start: trail[0]!, observations: [], moves: trail.slice(1).map((_, index) => ({
      type: 'normal', startSlot: index + 1, endSlot: index + 1, investigatorPositions: positions,
    })) } }
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
