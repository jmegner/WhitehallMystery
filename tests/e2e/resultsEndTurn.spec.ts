import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test'
import { createInitialGame } from '../../src/game/gameEngine'
import { createGameHistory, currentHistoryState, type GameHistory } from '../../src/game/history'
import type { GameState } from '../../src/game/types'
import { reviewScreenshot } from './reviewScreenshot'

const id = 'results-end-turn'
const endTurn = (page: Page) => page.getByRole('button', { name: 'End Turn', exact: true })
const investigatorFocus = (page: Page, color: string) => page.getByRole('button', { name: `Focus ${color} investigator`, exact: true })
async function saved(page: Page): Promise<GameHistory> {
  return page.evaluate(id => JSON.parse(localStorage.getItem(`whitehall-mystery.saved-game.v1.${id}`)!).history, id)
}
async function restore(page: Page, stage: 'investigatorSetupResult' | 'investigatorTurnResult') {
  const state: GameState = { ...createInitialGame(), stage,
    notice: stage === 'investigatorSetupResult' ? 'Deployment complete. Pass the device back to Jack.' : 'The Investigator turn is complete.',
    discoveryLocations: [33, 46, 147, 159], investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' },
    ...(stage === 'investigatorTurnResult' ? { currentJack: 85, moveSlot: 1, reachedDiscoveries: [33], roundTrail: [33, 85],
      publicRound: { start: 33, observations: [], moves: [{ type: 'normal', startSlot: 1, endSlot: 1,
        investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' } }] } } : {}),
  }
  await page.addInitScript(({ history, id }) => {
    if (localStorage.getItem(`whitehall-mystery.saved-game.v1.${id}`)) return
    localStorage.setItem('whitehall-mystery.saved-games-migrated.v1', 'true')
    localStorage.setItem('whitehall-mystery.active-game.v1', id)
    localStorage.setItem(`whitehall-mystery.saved-game.v1.${id}`, JSON.stringify({ id, mode: 'same-device', history,
      startedAt: Date.now(), savedAt: Date.now() }))
  }, { history: createGameHistory(state), id })
  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)
}
async function mapOverlap(page: Page) {
  return page.locator('.game-board').evaluate(element => {
    const rect = element.getBoundingClientRect()
    const viewport = window.visualViewport!
    return { width: Math.max(0, Math.min(rect.right, viewport.offsetLeft + viewport.width) - Math.max(rect.left, viewport.offsetLeft)),
      height: Math.max(0, Math.min(rect.bottom, viewport.offsetTop + viewport.height) - Math.max(rect.top, viewport.offsetTop)) * viewport.scale,
      viewportWidth: viewport.width }
  })
}
async function expectFloatingEndTurn(page: Page) {
  await expect(endTurn(page)).toBeVisible()
  await expect(endTurn(page)).toHaveAttribute('title', 'Finish reviewing the results and continue to the next turn')
  await expect(page.locator('.map-continue-prompt')).toHaveCount(0)
  await expect.poll(() => endTurn(page).evaluate(element => {
    const rect = element.getBoundingClientRect()
    const cluster = element.closest('.floating-control-cluster')!.getBoundingClientRect()
    const viewport = window.visualViewport!
    return Math.abs((cluster.left + cluster.width / 2 - viewport.offsetLeft - viewport.width / 2) * viewport.scale) < 2 &&
      Math.abs((cluster.bottom - viewport.offsetTop - viewport.height) * viewport.scale + 12) < 2 &&
      rect.height * viewport.scale >= 43 && cluster.left >= viewport.offsetLeft && cluster.right <= viewport.offsetLeft + viewport.width
  })).toBe(true)
}
async function tap(page: Page, cdp: CDPSession, target: Locator) {
  const point = await target.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const viewport = window.visualViewport!
    return { x: rect.left + rect.width / 2 - viewport.offsetLeft, y: rect.top + rect.height / 2 - viewport.offsetTop }
  })
  const before = await saved(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
  await page.waitForTimeout(80)
  expect(await saved(page)).toEqual(before)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

test.describe('zoomed results continuation', () => {
  test.use({ viewport: { width: 390, height: 600 }, isMobile: true, hasTouch: true })
  for (const stage of ['investigatorSetupResult', 'investigatorTurnResult'] as const) {
    for (const scale of [2, 3]) {
      test(`${stage} keeps End Turn floating on and off the map at ${scale}x zoom`, async ({ page, context }) => {
        await restore(page, stage)
        const initial = await saved(page)
        await expect(endTurn(page)).toHaveCount(0)
        await expect(page.locator('.map-continue-prompt')).toHaveCount(1)
        const cdp = await context.newCDPSession(page)
        await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: scale })
        await page.evaluate(() => scrollTo(0, 0))
        await expect.poll(async () => (await mapOverlap(page)).height).toBe(0)
        await expectFloatingEndTurn(page)

        // Show only eight screen pixels at the top of the map. The board
        // panel and move track no longer need to fill the visual viewport.
        await page.locator('.game-board').evaluate(element => {
          const viewport = window.visualViewport!
          scrollBy(0, element.getBoundingClientRect().top - viewport.offsetTop - viewport.height + 8 / viewport.scale)
        })
        await expect.poll(async () => Math.abs((await mapOverlap(page)).height - 8)).toBeLessThan(4)
        await expectFloatingEndTurn(page)
        await page.reload()
        await page.evaluate(() => document.fonts.ready)
        // Controls remain available wherever the browser restores the view.
        expect(await saved(page)).toEqual(initial)
        await expectFloatingEndTurn(page)
        await page.locator('.game-board').evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
        await expectFloatingEndTurn(page)

        // Scroll past the map entirely, then bring back just its bottom edge.
        await page.locator('.board-legend').evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
        await expect.poll(async () => (await mapOverlap(page)).height).toBe(0)
        await expectFloatingEndTurn(page)
        await page.locator('.game-board').evaluate(element => {
          const viewport = window.visualViewport!
          scrollBy(0, element.getBoundingClientRect().bottom - viewport.offsetTop - 8 / viewport.scale)
        })
        await expect.poll(async () => Math.abs((await mapOverlap(page)).height - 8)).toBeLessThan(4)
        await expectFloatingEndTurn(page)
        await reviewScreenshot(page, { path: test.info().outputPath(`${stage}-${scale}x-end-turn.png`) })
        expect(await saved(page)).toEqual(initial)

        // Zooming back out restores the original map prompt.
        await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
        await expect(endTurn(page)).toHaveCount(0)
        await expect(page.locator('.map-continue-prompt')).toHaveCount(1)
        await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: scale })
        await page.locator('.game-board').evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
        await expectFloatingEndTurn(page)
        await tap(page, cdp, endTurn(page))
        await expect(page.getByRole('dialog', { name: 'Pass the device to Jack', exact: true })).toBeVisible()
        const after = await saved(page)
        expect(after.cursor).toBe(initial.cursor + 1)
        expect(currentHistoryState(after).stage).toBe(stage === 'investigatorSetupResult' ? 'handoffJackStart' : 'handoffJackTurn')
        await expect(page.locator('.jack-marker, .private-discovery-marker')).toHaveCount(0)
        await cdp.detach()
      })
    }
  }

  test('Y, B, and R bring their pieces into view without ending the investigator review', async ({ page, context }) => {
    await page.setViewportSize({ width: 320, height: 600 })
    await restore(page, 'investigatorTurnResult')
    const initial = await saved(page)
    await expect(investigatorFocus(page, 'yellow')).toHaveCount(0)
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 3 })
    await expectFloatingEndTurn(page)

    for (const [color, letter] of [['yellow', 'Y'], ['blue', 'B'], ['red', 'R']]) {
      const button = investigatorFocus(page, color)
      await expect(button).toHaveText(letter)
      await expect(button).toHaveAttribute('title', `Center the map on the ${color} investigator`)
      await page.locator('.board-legend').evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
      await expect.poll(async () => (await mapOverlap(page)).height).toBe(0)
      await expectFloatingEndTurn(page)
      await tap(page, cdp, button)
      await expect.poll(() => page.locator(`.investigator-piece.${color}`).evaluate(piece => {
        const rect = piece.getBoundingClientRect()
        const viewport = window.visualViewport!
        const x = rect.left + rect.width / 2 - viewport.offsetLeft
        const y = rect.top + rect.height / 2 - viewport.offsetTop
        return viewport.scale === 3 && x > 0 && x < viewport.width && y > 0 && y < viewport.height
      })).toBe(true)
      await expectFloatingEndTurn(page)
      expect(await saved(page)).toEqual(initial)
    }
    await tap(page, cdp, endTurn(page))
    await expect(page.getByRole('dialog', { name: 'Pass the device to Jack', exact: true })).toBeVisible()
    await expect(investigatorFocus(page, 'red')).toHaveCount(0)
    await cdp.detach()
  })

  test('End Turn also floats when only a narrow side of the map is visible', async ({ page, context }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await restore(page, 'investigatorTurnResult')
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 })
    await page.locator('.control-panel').evaluate(element => element.scrollIntoView({ block: 'center', inline: 'end', behavior: 'instant' }))
    const overlap = await mapOverlap(page)
    expect(overlap.width).toBeGreaterThan(0)
    expect(overlap.width).toBeLessThan(overlap.viewportWidth * 0.8)
    expect(overlap.height).toBeGreaterThan(0)
    await expectFloatingEndTurn(page)
    await cdp.detach()
  })
})
