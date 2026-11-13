import { expect, test, type Page } from '@playwright/test'
import { createInitialGame } from '../../src/game/gameEngine'
import { createGameHistory } from '../../src/game/history'
import type { GameState } from '../../src/game/types'
import { reviewScreenshot } from './reviewScreenshot'

const toggles = (page: Page) => page.getByRole('group', { name: 'Floating analysis controls', exact: true })
const preferences = [
  ['alt', '.alternate-angle-toggle input'],
  ['next', '.next-turn-toggle input'],
  ['sprint', '.sprint-toggle input'],
] as const

async function restore(page: Page, side: 'jack' | 'investigators') {
  const state: GameState = { ...createInitialGame(), stage: side === 'jack' ? 'jackMove' : 'investigatorAction',
    currentJack: 33, moveSlot: 1, discoveryLocations: [33, 17, 147, 159], reachedDiscoveries: [33], roundTrail: [33],
    investigatorPositions: { yellow: 'BS', blue: 'HP', red: 'HZ' },
    publicRound: { start: 33, observations: [], moves: [{ type: 'normal', startSlot: 1, endSlot: 1,
      investigatorPositions: { yellow: 'BS', blue: 'HP', red: 'HZ' } }] } }
  await page.addInitScript(history => {
    const id = 'floating-analysis-controls'
    if (localStorage.getItem(`whitehall-mystery.saved-game.v1.${id}`)) return
    localStorage.setItem('whitehall-mystery.saved-games-migrated.v1', 'true')
    localStorage.setItem('whitehall-mystery.active-game.v1', id)
    localStorage.setItem(`whitehall-mystery.saved-game.v1.${id}`, JSON.stringify({ id, mode: 'same-device', history,
      startedAt: Date.now(), savedAt: Date.now() }))
  }, createGameHistory(state))
  await page.goto('/')
  await expect(page.locator('.board-frame')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

async function expectCompactTopbar(page: Page) {
  await expect(toggles(page)).toBeVisible()
  await expect.poll(() => page.locator('.floating-map-topbar').evaluate(bar => {
    const viewport = window.visualViewport!
    const rect = bar.getBoundingClientRect()
    const summary = bar.querySelector('output')!.getBoundingClientRect()
    return Math.abs((rect.top - viewport.offsetTop) * viewport.scale - 12) < 2 &&
      rect.left >= viewport.offsetLeft && rect.right <= viewport.offsetLeft + viewport.width &&
      [...bar.querySelectorAll('button')].every(button => {
        const bounds = button.getBoundingClientRect()
        return Math.abs(bounds.height - summary.height) * viewport.scale < 2 && bounds.height * viewport.scale < 32 &&
          bounds.left >= viewport.offsetLeft && bounds.right <= viewport.offsetLeft + viewport.width &&
          bounds.top >= summary.top && bounds.bottom <= viewport.offsetTop + viewport.height
      })
  })).toBe(true)
}

test.describe('floating analysis toggles', () => {
  test.use({ viewport: { width: 390, height: 600 }, hasTouch: true })

  test.beforeEach(async ({ page, browserName }) => {
    // Playwright's desktop Firefox enables touch events but still reports zero
    // touch points. Model Android's touch capability for this mobile QA suite.
    if (browserName === 'firefox') await page.addInitScript(() => {
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 })
    })
  })

  for (const side of ['jack', 'investigators'] as const) {
    test(`${side} toggles mirror checkboxes and survive refresh`, async ({ page }) => {
      await restore(page, side)
      const maybes = page.locator(side === 'jack' ? '.investigator-knowledge-toggle input' : '.possibility-toggle input')
      const floatingMaybes = toggles(page).getByRole('button', { name: 'maybes', exact: true })
      const count = page.locator('.floating-possible-count')
      async function expectCount() {
        await expect(count).toHaveText(await maybes.locator('..').locator('strong').innerText())
        await expect(count).toHaveCSS('color', 'rgb(93, 52, 135)')
        const summary = page.getByRole('status', { name: 'Floating turn summary', exact: true })
        expect(await summary.textContent()).toMatch(new RegExp(` \\b${await count.innerText()}$`))
      }
      await expect(count).toHaveCount(0)
      await expect(toggles(page).getByRole('button')).toHaveCount(1)
      await expect(floatingMaybes).toHaveAttribute('aria-pressed', 'false')
      await expect(floatingMaybes).toHaveAttribute('title', await maybes.locator('..').getAttribute('title') as string)
      await floatingMaybes.click()
      await expect(floatingMaybes).toHaveAttribute('aria-pressed', 'true')
      await expect(maybes).toBeChecked()
      await expectCount()
      await expectCompactTopbar(page)
      const available = preferences.filter(([name]) => side === 'investigators' || name !== 'next')
      await expect(toggles(page).getByRole('button')).toHaveCount(available.length + 1)
      const before = await page.evaluate(() => localStorage.getItem('whitehall-mystery.saved-game.v1.floating-analysis-controls'))
      for (const [name, selector] of available) {
        const button = toggles(page).getByRole('button', { name, exact: true })
        await expect(button).toHaveAttribute('aria-pressed', 'false')
        await expect(button).toHaveText(name)
        await expect(button.locator('input, svg, .floating-toggle-check')).toHaveCount(0)
        await expect(button).toHaveCSS('background-color', 'rgba(242, 232, 213, 0.95)')
        await expect(button).toHaveAttribute('title', await page.locator(selector).locator('..').getAttribute('title') as string)
        await button.click()
        await expectCount()
        await expect(button).toHaveAttribute('aria-pressed', 'true')
        await expect(button).toHaveCSS('background-color', 'rgb(46, 113, 69)')
        await expect(page.locator(selector)).toBeChecked()
        await page.locator(selector).uncheck()
        await expect(button).toHaveAttribute('aria-pressed', 'false')
        await expect(button).toHaveCSS('background-color', 'rgba(242, 232, 213, 0.95)')
        await button.click()
      }
      expect(await page.evaluate(() => localStorage.getItem('whitehall-mystery.saved-game.v1.floating-analysis-controls'))).toBe(before)
      await page.reload()
      await expect(floatingMaybes).toHaveAttribute('aria-pressed', 'true')
      await expect(maybes).toBeChecked()
      for (const [name, selector] of available) {
        await expect(toggles(page).getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
        await expect(page.locator(selector)).toBeChecked()
      }
      await expectCompactTopbar(page)
      await expectCount()
      await reviewScreenshot(page, { path: test.info().outputPath(`${side}-floating-analysis.png`) })
      await maybes.uncheck()
      await expect(count).toHaveCount(0)
      await expect(toggles(page).getByRole('button')).toHaveCount(1)
      await expect(floatingMaybes).toHaveAttribute('aria-pressed', 'false')
      await maybes.check()
      await expect(floatingMaybes).toHaveAttribute('aria-pressed', 'true')
      await floatingMaybes.click()
      await expect(maybes).not.toBeChecked()
      await expect(page.getByRole('status', { name: 'Floating turn summary', exact: true })).toBeVisible()
    })
  }

  test('compact toggles stay reachable after native zoom, pan, and narrow resizing', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Native pinch zoom uses Chromium’s touch protocol')
    await restore(page, 'investigators')
    await page.locator('.possibility-toggle input').check()
    const cdp = await context.newCDPSession(page)
    for (const scale of [2, 3]) {
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: scale })
      await cdp.send('Input.synthesizeScrollGesture', { x: 60, y: 100, xDistance: -70, yDistance: -150, gestureSourceType: 'touch' })
      await page.setViewportSize({ width: 320, height: 600 })
      await expectCompactTopbar(page)
      // Toggle maybes off and back on so each zoom level exercises both states.
      const maybes = ['maybes', '.possibility-toggle input'] as const
      for (const [name, selector] of [...preferences, maybes, maybes]) {
        const button = toggles(page).getByRole('button', { name, exact: true })
        const pressed = await button.getAttribute('aria-pressed') === 'true'
        const point = await button.evaluate(element => {
          const rect = element.getBoundingClientRect()
          return { x: rect.left + rect.width / 2 - window.visualViewport!.offsetLeft,
            y: rect.top + rect.height / 2 - window.visualViewport!.offsetTop }
        })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await expect(button).toHaveAttribute('aria-pressed', String(!pressed))
        await expect(page.locator(selector)).toBeChecked({ checked: !pressed })
      }
      await expectCompactTopbar(page)
      await reviewScreenshot(page, { path: test.info().outputPath(`floating-analysis-${scale}x.png`) })
    }
    await cdp.detach()
  })
})

test.describe('desktop floating analysis conditions', () => {
  test.use({ hasTouch: false, isMobile: false })

  test('analysis toggles only accompany viewport-floating controls', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1600 })
    await restore(page, 'investigators')
    await page.locator('.possibility-toggle input').check()
    await expect(toggles(page)).toHaveCount(0)
    await page.setViewportSize({ width: 974, height: 1600 })
    await expect(page.locator('.map-top-controls')).toBeVisible()
    await expect(toggles(page)).toHaveCount(0)
    await page.setViewportSize({ width: 974, height: 600 })
    await page.locator('.board-frame').evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
    await expectCompactTopbar(page)
    await page.setViewportSize({ width: 974, height: 1600 })
    await expect(toggles(page)).toHaveCount(0)
  })
})
