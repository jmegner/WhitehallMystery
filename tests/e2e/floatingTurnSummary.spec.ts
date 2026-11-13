import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test'
import { createInitialGame, legalJackDestinations } from '../../src/game/gameEngine'
import { createGameHistory, currentHistoryState, type GameHistory } from '../../src/game/history'
import type { GameState } from '../../src/game/types'
import { reviewScreenshot } from './reviewScreenshot'

const id = 'floating-turn-summary'
const summary = (page: Page) => page.getByRole('status', { name: 'Floating turn summary', exact: true })
const controls = (page: Page) => page.getByRole('group', { name: 'Floating map controls', exact: true })
const jackState = (): GameState => ({ ...createInitialGame(), stage: 'jackMove', currentJack: 33,
  discoveryLocations: [33, 17, 147, 159], reachedDiscoveries: [33], roundTrail: [33],
  specialRemaining: { alley: 0, boat: 1, coach: 2 },
  investigatorPositions: { yellow: 'BS', blue: 'HP', red: 'HZ' },
  publicRound: { start: 33, observations: [], moves: [] } })

async function restore(page: Page, state: GameState) {
  await page.addInitScript(({ id, history }) => {
    if (localStorage.getItem(`whitehall-mystery.saved-game.v1.${id}`)) return
    localStorage.setItem('whitehall-mystery.saved-games-migrated.v1', 'true')
    localStorage.setItem('whitehall-mystery.active-game.v1', id)
    localStorage.setItem(`whitehall-mystery.saved-game.v1.${id}`, JSON.stringify({ id, mode: 'same-device', history,
      startedAt: Date.now(), savedAt: Date.now() }))
  }, { id, history: createGameHistory(state) })
  await page.goto('/')
  await expect(page.locator('.board-frame')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}
async function saved(page: Page) {
  const history: GameHistory = await page.evaluate(id => JSON.parse(localStorage.getItem(`whitehall-mystery.saved-game.v1.${id}`)!).history, id)
  return currentHistoryState(history)
}
async function expectAtTop(page: Page) {
  await expect(controls(page)).toHaveCSS('position', 'fixed')
  await expect(controls(page).getByRole('button').first()).toBeVisible()
  await expect(summary(page)).toBeVisible()
  await expect(page.locator('.floating-map-topbar')).toHaveCSS('position', 'fixed')
  await expect.poll(() => page.locator('.floating-map-topbar').evaluate(bar => {
    const bounds = bar.getBoundingClientRect()
    const rect = bar.querySelector('output')!.getBoundingClientRect()
    const viewport = window.visualViewport!
    return Math.abs((rect.top - viewport.offsetTop) * viewport.scale - 12) < 2 &&
      Math.abs((bounds.left + bounds.width / 2 - viewport.offsetLeft - viewport.width / 2) * viewport.scale) < 2 &&
      rect.left >= viewport.offsetLeft && rect.right <= viewport.offsetLeft + viewport.width &&
      rect.height * viewport.scale < 32 && rect.height * viewport.scale >= 20
  })).toBe(true)
}
async function tap(cdp: CDPSession, target: Locator) {
  const point = await target.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2 - window.visualViewport!.offsetLeft,
      y: rect.top + rect.height / 2 - window.visualViewport!.offsetTop }
  })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

test.describe('zoomed floating turn summaries', () => {
  test.use({ viewport: { width: 390, height: 600 }, isMobile: true, hasTouch: true })

  for (const [type, letter, scale] of [['normal', 'S', 2], ['alley', 'A', 3], ['boat', 'B', 2], ['coach', 'C', 3]] as const) {
    test(`investigators see ${letter} for the last confirmed ${type} move at ${scale}x zoom`, async ({ page, context }) => {
      const state: GameState = { ...jackState(), stage: 'investigatorAction', round: 2, moveSlot: 7,
        inspectorActionMode: 'search', publicRound: { start: 33, observations: [], moves: [{ type,
          startSlot: type === 'coach' ? 6 : 7, endSlot: 7, investigatorPositions: { yellow: 'BS', blue: 'HP', red: 'HZ' } }] } }
      await restore(page, state)
      const cdp = await context.newCDPSession(page)
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: scale })
      await expectAtTop(page)
      await expect(summary(page)).toHaveText(`R2 M7 ${letter} 012`)
      await expect(summary(page)).toHaveAttribute('title', /Alley 0, Boat 1, Coach 2/)
      await cdp.send('Input.synthesizeScrollGesture', { x: 60, y: 100, xDistance: -70, yDistance: -150, gestureSourceType: 'touch' })
      await expectAtTop(page)
      await page.setViewportSize({ width: 320, height: 600 })
      await expectAtTop(page)
      await reviewScreenshot(page, { path: test.info().outputPath(`investigator-${letter}-${scale}x.png`) })
      await tap(cdp, controls(page).getByRole('button', { name: 'Pass', exact: true }))
      expect((await saved(page)).activeInvestigator).toBe(1)
      await expect(summary(page)).toHaveText(`R2 M7 ${letter} 012`)
      await page.reload()
      await expectAtTop(page)
      await expect(summary(page)).toHaveText(`R2 M7 ${letter} 012`)
      await cdp.detach()
    })
  }

  test('Jack sees the Street-only distance with first-move blocking, then investigators see the committed Coach and new counts', async ({ page, context }) => {
    await restore(page, jackState())
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 })
    await expectAtTop(page)
    await expect(summary(page)).toHaveText('R1 M0 012 D2')
    await expect(summary(page)).toHaveAttribute('title', /Investigators block crossings for the next Street move only/)
    await tap(cdp, controls(page).getByRole('button', { name: 'Cycle move type: Street', exact: true }))
    for (let step = 0; step < 2; step++) {
      const destination = legalJackDestinations(await saved(page))[0]!
      const target = page.getByLabel(`Location ${destination}, selectable`, { exact: true })
      await target.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }))
      await tap(cdp, target)
      await expect(summary(page)).toHaveText('R1 M0 012 D2')
      await expectAtTop(page)
    }
    await reviewScreenshot(page, { path: test.info().outputPath('jack-coach-draft-summary.png') })
    await page.reload()
    await expect(summary(page)).toHaveText('R1 M0 012 D2')
    await expectAtTop(page)
    await tap(cdp, controls(page).getByRole('button', { name: 'Submit', exact: true }))
    await expect(summary(page)).toHaveText('R1 M2 C 011')
    await expectAtTop(page)
    await expect(page.locator('.jack-marker, .private-discovery-marker')).toHaveCount(0)
    await page.reload()
    await expect(summary(page)).toHaveText('R1 M2 C 011')
    await cdp.detach()
  })
})

test('summary only accompanies viewport-floating buttons through resizing and scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1600 })
  await restore(page, jackState())
  await expect(controls(page)).toHaveCount(0)
  await expect(summary(page)).toHaveCount(0)
  await page.setViewportSize({ width: 974, height: 1600 })
  await expect(controls(page)).toHaveCSS('position', 'absolute')
  await expect(summary(page)).toHaveCount(0)
  await reviewScreenshot(page, { path: test.info().outputPath('map-top-without-summary.png') })
  await page.setViewportSize({ width: 974, height: 600 })
  await page.locator('.board-frame').evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
  await expectAtTop(page)
  await expect(summary(page)).toHaveText('R1 M0 012 D2')
  await expect(summary(page)).toHaveCount(1)
  await reviewScreenshot(page, { path: test.info().outputPath('desktop-floating-summary.png') })
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(controls(page)).toHaveCSS('position', 'absolute')
  await expect(summary(page)).toHaveCount(0)
  await page.locator('.board-frame').evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
  await expectAtTop(page)
  await page.setViewportSize({ width: 974, height: 1600 })
  await expect(controls(page)).toHaveCSS('position', 'absolute')
  await expect(summary(page)).toHaveCount(0)
  await page.setViewportSize({ width: 1440, height: 1600 })
  await expect(controls(page)).toHaveCount(0)
  await expect(summary(page)).toHaveCount(0)
})
