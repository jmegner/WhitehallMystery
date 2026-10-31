import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test'
import { createInitialGame } from '../../src/game/gameEngine'
import { createGameHistory, currentHistoryState, type GameHistory } from '../../src/game/history'
import type { GameState } from '../../src/game/types'
import { reviewScreenshot } from './reviewScreenshot'

const id = 'zoomed-handoff'
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Pass the device to Jack', exact: true })
function resultState(stage: 'investigatorSetupResult' | 'investigatorTurnResult'): GameState {
  return { ...createInitialGame(), stage,
    discoveryLocations: [33, 46, 147, 159], investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' },
    ...(stage === 'investigatorTurnResult' ? { currentJack: 85, moveSlot: 1, reachedDiscoveries: [33], roundTrail: [33, 85],
      publicRound: { start: 33, observations: [], moves: [{ type: 'normal', startSlot: 1, endSlot: 1,
        investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' } }] } } : {}),
  }
}
async function seedGame(page: Page, state: GameState) {
  await page.addInitScript(({ initialHistory, id }) => {
    if (localStorage.getItem(`whitehall-mystery.saved-game.v1.${id}`)) return
    localStorage.setItem('whitehall-mystery.saved-games-migrated.v1', 'true')
    localStorage.setItem('whitehall-mystery.active-game.v1', id)
    localStorage.setItem(`whitehall-mystery.saved-game.v1.${id}`, JSON.stringify({ id, mode: 'same-device',
      history: initialHistory, startedAt: Date.now(), savedAt: Date.now() }))
  }, { initialHistory: createGameHistory(state), id })
}
async function history(page: Page): Promise<GameHistory> {
  return page.evaluate(id => JSON.parse(localStorage.getItem(`whitehall-mystery.saved-game.v1.${id}`)!).history, id)
}
async function expectViewportHandoff(page: Page) {
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).getByRole('button')).toHaveCount(2)
  await expect.poll(() => dialog(page).evaluate(element => {
    const viewport = window.visualViewport!
    const bounds = element.getBoundingClientRect()
    return Math.abs((bounds.left - viewport.offsetLeft) * viewport.scale) < 2 &&
      Math.abs((bounds.top - viewport.offsetTop) * viewport.scale) < 2 &&
      Math.abs((bounds.width - viewport.width) * viewport.scale) < 2 &&
      Math.abs((bounds.height - viewport.height) * viewport.scale) < 2 &&
      [...element.querySelectorAll('button')].every(button => {
        const rect = button.getBoundingClientRect()
        return rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top &&
          rect.bottom <= bounds.bottom && rect.height * viewport.scale >= 47 && button.scrollWidth <= button.clientWidth
      })
  })).toBe(true)
}

for (const stage of ['investigatorSetupResult', 'investigatorTurnResult'] as const) {
  test(`zoomed mobile handoff after ${stage} fills the viewport and supports undo, refresh, and reveal`, async ({ page, context }) => {
    const state = resultState(stage)
    await page.setViewportSize({ width: 390, height: 844 })
    await seedGame(page, state)
    await page.goto('/')
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 })
    await page.locator('.board-frame').evaluate(element => element.scrollIntoView({ block: 'center' }))
    await page.getByRole('img', { name: 'Whitehall game board' }).dispatchEvent('click')
    await expectViewportHandoff(page)
    await expect(page.locator('.game-board, .jack-marker, .private-discovery-marker')).toHaveCount(0)
    const handoff = await history(page)
    await dialog(page).getByRole('heading').click()
    await page.keyboard.press('Escape')
    expect(await history(page)).toEqual(handoff)
    await expectViewportHandoff(page)
    await cdp.send('Input.synthesizeScrollGesture', { x: 180, y: 250, xDistance: -80, yDistance: -80, gestureSourceType: 'touch' })
    await expectViewportHandoff(page)
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 3 })
    await expectViewportHandoff(page)
    await page.setViewportSize({ width: 844, height: 390 })
    await expectViewportHandoff(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await expectViewportHandoff(page)
    await page.reload()
    await expectViewportHandoff(page)
    expect(await history(page)).toEqual(handoff)
    await reviewScreenshot(page, { path: test.info().outputPath(`${stage}-compact-handoff.png`) })
    await dialog(page).getByRole('button', { name: 'Undo', exact: true }).click()
    expect(currentHistoryState(await history(page))).toEqual(state)
    await expect(dialog(page)).toHaveCount(0)
    await page.getByRole('img', { name: 'Whitehall game board' }).dispatchEvent('click')
    await expectViewportHandoff(page)
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
    await expect(dialog(page)).toHaveCount(0)
    await expect(page.locator('.handoff-card')).toBeVisible()
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 })
    await expectViewportHandoff(page)
    await dialog(page).getByRole('button', { name: 'I am Jack, reveal my view', exact: true }).click()
    await expect(dialog(page)).toHaveCount(0)
    expect(currentHistoryState(await history(page)).stage).toBe(stage === 'investigatorSetupResult' ? 'jackChooseStart' : 'jackMove')
    await expect(page.locator('.game-board')).toBeVisible()
    await cdp.detach()
  })
}

// Locator.click() can scroll a target into view and hide the mobile failure.
// Send touch input to the point actually visible under the user's finger.
async function nativeTap(page: Page, cdp: CDPSession, target: Locator, edge = false) {
  const point = await target.evaluate((element, edge) => {
    const rect = element.getBoundingClientRect()
    const viewport = window.visualViewport!
    return { x: rect.left - viewport.offsetLeft + (edge ? 3 / viewport.scale : rect.width / 2),
      y: rect.top - viewport.offsetTop + (edge ? rect.height - 3 / viewport.scale : rect.height / 2) }
  }, edge)
  const before = await target.evaluate(element => element.getBoundingClientRect().toJSON())
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
  const jitter = await page.evaluate(() => 1 / window.visualViewport!.scale)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + jitter, y: point.y - jitter }] })
  await page.waitForTimeout(80)
  const held = await target.evaluate(element => element.getBoundingClientRect().toJSON())
  expect(held.x).toBeCloseTo(before.x, 1)
  expect(held.y).toBeCloseTo(before.y, 1)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

async function mapPosition(page: Page) {
  return page.locator('.board-frame').evaluate(element => {
    const rect = element.getBoundingClientRect()
    const viewport = window.visualViewport!
    return { left: rect.left - viewport.offsetLeft, top: rect.top - viewport.offsetTop,
      pageLeft: viewport.pageLeft, pageTop: viewport.pageTop, scale: viewport.scale }
  })
}

test.describe('native mobile handoff taps', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  for (const stage of ['investigatorSetupResult', 'investigatorTurnResult'] as const) {
    for (const scale of [2, 3]) {
      test(`${stage} at ${scale}x reveals on one tap and retains the map position`, async ({ page, context }) => {
        const state = resultState(stage)
        await seedGame(page, state)
        await page.goto('/')
        const cdp = await context.newCDPSession(page)
        await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: scale })
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
        // Pan the visual viewport as well as the document. The old handoff
        // shortened the page here and permanently moved the view upward.
        for (let gesture = 0; gesture < 2; gesture++) {
          const start = await page.evaluate(() => ({ x: window.visualViewport!.width / 2, y: window.visualViewport!.height - 20 }))
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
          for (let step = 1; step <= 10; step++) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove',
              touchPoints: [{ x: start.x - step * 3, y: start.y - step * 20 }] })
            await page.waitForTimeout(20)
          }
          await page.waitForTimeout(150)
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        }
        const original = await mapPosition(page)
        expect(original.pageTop).toBeGreaterThan(844 - 844 / scale + 10)

        const enterHandoff = async () => {
          const point = await page.locator('.game-board').evaluate(element => {
            const rect = element.getBoundingClientRect()
            const viewport = window.visualViewport!
            return { x: Math.max(rect.left + 2, viewport.offsetLeft + 2) - viewport.offsetLeft,
              y: Math.min(rect.bottom - 2, viewport.offsetTop + viewport.height - 2) - viewport.offsetTop }
          })
          expect(point.y).toBeGreaterThan(0)
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
          await expectViewportHandoff(page)
          expect(await page.evaluate(() => window.visualViewport!.pageTop)).toBeCloseTo(original.pageTop, 0)
          await expect(page.locator('#root')).toHaveAttribute('inert', '')
          await expect(page.locator('.game-board, .jack-marker, .private-discovery-marker')).toHaveCount(0)
        }
        const expectOriginalMap = async () => {
          await expect(dialog(page)).toHaveCount(0)
          const position = await mapPosition(page)
          for (const key of ['left', 'top', 'pageLeft', 'pageTop', 'scale'] as const) {
            expect(position[key], key).toBeCloseTo(original[key], 0)
          }
          expect(await page.locator('#root').evaluate(element => element.inert)).toBe(false)
          expect(await page.evaluate(() => document.body.style.minHeight)).toBe('')
        }

        // Repeat Undo and re-entry, including taps close to the button edge.
        for (let attempt = 0; attempt < 3; attempt++) {
          await enterHandoff()
          const handoff = await history(page)
          await nativeTap(page, cdp, dialog(page).getByRole('button', { name: 'Undo', exact: true }), attempt > 0)
          await expectOriginalMap()
          expect(currentHistoryState(await history(page))).toEqual(state)
          expect((await history(page)).cursor).toBe(handoff.cursor - 1)
        }
        await enterHandoff()
        const handoff = await history(page)
        const reveal = dialog(page).getByRole('button', { name: 'I am Jack, reveal my view', exact: true })
        await expect(reveal).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(dialog(page).getByRole('button', { name: 'Undo', exact: true })).toBeFocused()
        await page.keyboard.press('Shift+Tab')
        await expect(reveal).toBeFocused()
        const cancelled = await reveal.evaluate(element => {
          const rect = element.getBoundingClientRect()
          return { x: rect.left + rect.width / 2 - window.visualViewport!.offsetLeft,
            y: rect.top + rect.height / 2 - window.visualViewport!.offsetTop }
        })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [cancelled] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
        expect(await history(page)).toEqual(handoff)
        await nativeTap(page, cdp, reveal, true)
        await expectOriginalMap()
        expect((await history(page)).cursor).toBe(handoff.cursor + 1)
        expect(currentHistoryState(await history(page)).stage).toBe(stage === 'investigatorSetupResult' ? 'jackChooseStart' : 'jackMove')
        await cdp.detach()
      })
    }
  }
})
