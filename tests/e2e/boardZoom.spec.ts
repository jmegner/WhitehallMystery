import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test'
import { boardZoomRegion, type BoardZoomRegion } from '../../src/boardZoom'
import { createInitialGame } from '../../src/game/gameEngine'
import { createGameHistory } from '../../src/game/history'
import { circlesById, crossingsById } from '../../src/game/mapData'
import type { GameState } from '../../src/game/types'
import { reviewScreenshot } from './reviewScreenshot'
import { holdAiWorker } from './holdAiWorker'

const id = 'board-zoom'
const zoom = (page: Page) => page.getByRole('button', { name: 'Zoom', exact: true })
const jack = (): GameState => ({ ...createInitialGame(), stage: 'jackMove', currentJack: 85,
  discoveryLocations: [33, 46, 147, 159], reachedDiscoveries: [33], roundTrail: [33, 85], moveSlot: 1,
  investigatorPositions: { yellow: 'BS', blue: 'HP', red: 'HZ' },
  publicRound: { start: 33, observations: [], moves: [{ type: 'normal', startSlot: 1, endSlot: 1,
    investigatorPositions: { yellow: 'BS', blue: 'HP', red: 'HZ' } }] } })
async function restore(page: Page, state: GameState, mode = 'same-device') {
  await page.addInitScript(({ id, history, mode }) => {
    if (localStorage.getItem(`whitehall-mystery.saved-game.v1.${id}`)) return
    localStorage.setItem('whitehall-mystery.saved-games-migrated.v1', 'true')
    localStorage.setItem('whitehall-mystery.active-game.v1', id)
    localStorage.setItem(`whitehall-mystery.saved-game.v1.${id}`, JSON.stringify({ id, mode, role: 'jack', history,
      startedAt: Date.now(), savedAt: Date.now() }))
  }, { id, history: createGameHistory(state), mode })
  await page.goto('/')
  await expect(page.locator('.board-frame')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}
async function history(page: Page) {
  return page.evaluate(id => JSON.parse(localStorage.getItem(`whitehall-mystery.saved-game.v1.${id}`)!).history, id)
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
async function clippedTargets(page: Page, region: BoardZoomRegion) {
  const points = [...region.locations.map(id => ({ ...circlesById.get(id)!, label: `location ${id}` })),
    ...region.crossings.map(id => ({ ...crossingsById.get(id)!, label: `crossing ${id}` }))]
  return page.locator('.game-board').evaluate((element, points) => {
    const svg = element as SVGSVGElement
    const matrix = svg.getScreenCTM()!
    const viewport = window.visualViewport!
    return points.filter(point => {
      const first = new DOMPoint(point.x - 20, point.y - 20).matrixTransform(matrix)
      const last = new DOMPoint(point.x + 20, point.y + 20).matrixTransform(matrix)
      return first.x < viewport.offsetLeft - 1 || first.y < viewport.offsetTop - 1 ||
        last.x > viewport.offsetLeft + viewport.width + 1 || last.y > viewport.offsetTop + viewport.height + 1
    }).map(point => point.label)
  }, points)
}
async function expectBottomZoom(page: Page) {
  await expect(zoom(page)).toBeVisible()
  await expect(zoom(page)).toHaveAttribute('title', 'Zoom to the map area relevant to the current phase')
  await expect.poll(() => zoom(page).evaluate(element => {
    const rect = element.getBoundingClientRect()
    const viewport = window.visualViewport!
    return rect.left >= viewport.offsetLeft && rect.right <= viewport.offsetLeft + viewport.width &&
      rect.bottom <= viewport.offsetTop + viewport.height && rect.height * viewport.scale >= 43 &&
      (viewport.offsetTop + viewport.height - rect.bottom) * viewport.scale < 24
  })).toBe(true)
}

test.describe('native touch Zoom button', () => {
  test.use({ viewport: { width: 390, height: 600 }, isMobile: true, hasTouch: true })
  const phases: Array<[string, () => GameState]> = [
    ['Jack Coach and Alley reach', jack],
    ['Jack Boat reach', () => ({ ...jack(), currentJack: 110, roundTrail: [33, 110] })],
    ['Jack Street reach with no special tiles', () => ({ ...jack(), specialRemaining: { coach: 0, alley: 0, boat: 0 } })],
    ['investigator movement', () => ({ ...jack(), stage: 'investigatorMove', activeInvestigator: 1 })],
    ['investigator search next-turn reach', () => ({ ...jack(), stage: 'investigatorAction', activeInvestigator: 2, inspectorActionMode: 'search',
      investigatorPositions: { yellow: 'HK', blue: 'GZ', red: 'HC' } })],
    ['investigator arrest next-turn reach', () => ({ ...jack(), stage: 'investigatorAction', activeInvestigator: 2, inspectorActionMode: 'arrest',
      investigatorPositions: { yellow: 'HK', blue: 'GZ', red: 'HC' } })],
    ['initial investigator crossings', () => ({ ...createInitialGame(), stage: 'investigatorSetup', discoveryLocations: [33, 46, 147, 159] })],
    ['remaining initial investigator crossings', () => ({ ...createInitialGame(), stage: 'investigatorSetup', discoveryLocations: [33, 46, 147, 159],
      investigatorPositions: { yellow: 'HP' }, activeInvestigator: 1 })],
    ['Jack starting discoveries', () => ({ ...createInitialGame(), stage: 'jackChooseStart', discoveryLocations: [33, 46, 147, 159] })],
    ['all discovery choices', createInitialGame],
    ['remaining NW discovery choices', () => ({ ...createInitialGame(), discoveryLocations: [46, 147, 159] })],
    ['completed discovery choices', () => ({ ...createInitialGame(), discoveryLocations: [33, 46, 147, 159] })],
  ]
  for (const [name, makeState] of phases) {
    test(`one tap frames ${name} without changing the game`, async ({ page, context }) => {
      const state = makeState()
      const region = boardZoomRegion(state)!
      await restore(page, state)
      const before = await history(page)
      await expectBottomZoom(page)
      await expect.poll(() => page.evaluate(() => window.visualViewport!.scale)).toBe(1)
      const cdp = await context.newCDPSession(page)
      // Zoom comes from the app's real button, never a test-only scale override.
      await tap(cdp, zoom(page))
      await expect.poll(() => clippedTargets(page, region)).toEqual([])
      expect(await history(page)).toEqual(before)
      const scale = await page.evaluate(() => window.visualViewport!.scale)
      if (scale > 1) await expect(zoom(page)).toHaveCount(0)
      if (name === 'remaining NW discovery choices') expect(scale).toBeGreaterThan(1.5)
      await reviewScreenshot(page, { path: test.info().outputPath(`${name.replaceAll(' ', '-')}.png`) })
      await cdp.detach()
    })
  }

  test('pinching back out restores Zoom, and the same area can be framed again on a narrow phone', async ({ page, context }) => {
    await page.setViewportSize({ width: 320, height: 600 })
    const state: GameState = { ...jack(), stage: 'investigatorMove', activeInvestigator: 1 }
    await restore(page, state)
    const cdp = await context.newCDPSession(page)
    await expectBottomZoom(page)
    await tap(cdp, zoom(page))
    await expect.poll(() => page.evaluate(() => window.visualViewport!.scale)).toBeGreaterThan(1)
    const scale = await page.evaluate(() => window.visualViewport!.scale)
    // Headless Chromium ignores synthesizePinchGesture. Send two actual touch
    // contacts, closing them together, as on a physical touchscreen instead.
    for (let attempt = 0; attempt < 4 && await zoom(page).count() === 0; attempt++) {
      const size = await page.evaluate(() => ({ width: window.visualViewport!.width, height: window.visualViewport!.height }))
      for (let step = 0; step <= 12; step++) {
        const distance = size.width * (0.4 - step * 0.03)
        await cdp.send('Input.dispatchTouchEvent', { type: step === 0 ? 'touchStart' : 'touchMove', touchPoints: [
          { x: size.width / 2 - distance, y: size.height / 2 }, { x: size.width / 2 + distance, y: size.height / 2 },
        ] })
        await page.waitForTimeout(16)
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    await expectBottomZoom(page)
    await tap(cdp, zoom(page))
    await expect.poll(() => page.evaluate(() => window.visualViewport!.scale)).toBeCloseTo(scale, 1)
    await expect.poll(() => clippedTargets(page, boardZoomRegion(state)!)).toEqual([])
    await page.reload()
    await expect(page.locator('.board-frame')).toBeVisible()
    expect((await history(page)).cursor).toBe(0)
    await expect.poll(() => clippedTargets(page, boardZoomRegion(state)!)).toEqual([])
    await cdp.detach()
  })

  test('waiting for AI has no Zoom action', async ({ page }) => {
    await holdAiWorker(page)
    await restore(page, { ...jack(), stage: 'investigatorMove' }, 'versus-ai')
    await expect(zoom(page)).toHaveCount(0)
  })

  test('landscape framing keeps the full discovery selection area visible', async ({ page, context }) => {
    await page.setViewportSize({ width: 844, height: 390 })
    const state = createInitialGame()
    await restore(page, state)
    await expectBottomZoom(page)
    const cdp = await context.newCDPSession(page)
    await tap(cdp, zoom(page))
    await expect.poll(() => clippedTargets(page, boardZoomRegion(state)!)).toEqual([])
    await reviewScreenshot(page, { path: test.info().outputPath('landscape-overview.png') })
    await cdp.detach()
  })
})

test('mouse-only desktop play does not offer Zoom', async ({ page }) => {
  await restore(page, jack())
  await expect(zoom(page)).toHaveCount(0)
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', 'width=device-width, initial-scale=1.0')
})
