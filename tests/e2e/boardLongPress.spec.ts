import { expect, test, type Locator, type Page } from '@playwright/test'
import { createInitialGame } from '../../src/game/gameEngine'
import { createGameHistory } from '../../src/game/history'
import type { GameState } from '../../src/game/types'

const gameId = 'board-long-press'
const jackState = (): GameState => ({ ...createInitialGame(), stage: 'jackMove', currentJack: 33,
  roundTrail: [33], discoveryLocations: [33, 46, 147, 159], reachedDiscoveries: [33],
  investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' },
  publicRound: { start: 33, moves: [], observations: [] },
})
const investigatorState = (stage: GameState['stage'] = 'investigatorAction'): GameState => {
  const investigatorPositions = { yellow: 'DD', blue: 'HP', red: 'HZ' }
  return { ...jackState(), stage, currentJack: 36, roundTrail: [54, 36], moveSlot: 1,
    discoveryLocations: [54, 46, 147, 159], reachedDiscoveries: [54], investigatorPositions,
    inspectorActionMode: 'search', publicRound: { start: 54, observations: [], moves: [
      { type: 'normal', startSlot: 1, endSlot: 1, investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' } },
    ] },
  }
}
async function restore(page: Page, state: GameState) {
  await page.addInitScript(({ history, gameId }) => {
    if (localStorage.getItem(`whitehall-mystery.saved-game.v1.${gameId}`)) return
    localStorage.setItem('whitehall-mystery.saved-games-migrated.v1', 'true')
    localStorage.setItem('whitehall-mystery.active-game.v1', gameId)
    localStorage.setItem('whitehall-mystery.show-possible-locations', 'true')
    localStorage.setItem(`whitehall-mystery.saved-game.v1.${gameId}`, JSON.stringify({
      id: gameId, mode: 'same-device', history, startedAt: Date.now(), savedAt: Date.now(),
    }))
  }, { history: createGameHistory(state), gameId })
  await page.goto('/')
}
const cursor = (page: Page) => page.evaluate(gameId =>
  JSON.parse(localStorage.getItem(`whitehall-mystery.saved-game.v1.${gameId}`)!).history.cursor as number, gameId)
async function center(target: Locator) {
  await target.scrollIntoViewIfNeeded()
  const box = (await target.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
async function blankPoint(page: Page) {
  const svg = page.locator('.game-board')
  await svg.scrollIntoViewIfNeeded()
  const box = (await svg.boundingBox())!
  return { x: box.x + 4, y: box.y + 4 }
}
async function touchInput(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  return {
    start: (points: { x: number; y: number; id?: number }[]) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points }),
    move: (points: { x: number; y: number; id?: number }[]) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points }),
    end: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
    cancel: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }),
    hold: async (target: Locator, preview: Locator) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [await center(target)] })
      await page.waitForTimeout(600) // Hold through the threshold even if the preceding target used the same preview.
      await expect(preview.first()).toBeVisible()
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect(preview.first()).toBeVisible()
    },
  }
}

test('mouse click-and-hold pins a preview without moving; normal hover and clicks still work', async ({ page }) => {
  await restore(page, jackState())
  const choice = page.getByLabel('Location 34, selectable', { exact: true })
  await choice.click({ delay: 650 })
  await expect.poll(() => cursor(page)).toBe(0)
  await expect(page.locator('.route-turn-count')).toHaveCount(188)
  await page.keyboard.press('Escape')
  await expect(page.locator('.route-turn-count')).toHaveCount(0)
  // Moving normally still switches previews, without another long-press.
  await page.locator('.investigator-piece.blue').hover()
  await expect(page.locator('.investigator-hover-turn-count').first()).toBeVisible()
  await choice.click()
  await expect.poll(() => cursor(page)).toBe(1)
})

test('mouse long-press prevents native context menus and selecting discoveries', async ({ page }) => {
  await restore(page, createInitialGame())
  const choice = page.getByLabel('Location 33, selectable', { exact: true })
  const point = await center(choice)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.waitForTimeout(600) // Exercise the real long-press timer with the button held.
  expect(await choice.evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))).toBe(false)
  await page.mouse.up()
  await expect.poll(() => cursor(page)).toBe(0)
  await page.mouse.move(0, 0)
  await page.reload()
  await expect(page.locator('.route-turn-count')).toHaveCount(0)
  await page.getByLabel('Location 33, selectable', { exact: true }).click()
  await expect.poll(() => cursor(page)).toBe(1)
})

test.describe('touch long-press', () => {
  test.use({ hasTouch: true })
  test.skip(({ browserName }) => browserName !== 'chromium', 'Native touch gestures use Chromium CDP.')

  test('Jack, locations, routes, and investigator pieces share persistent previews without actions', async ({ page }) => {
    await restore(page, jackState())
    const touch = await touchInput(page)
    await touch.hold(page.locator('.jack-marker'), page.locator('.route-turn-count'))
    await touch.hold(page.getByLabel('Location 34, selectable', { exact: true }), page.locator('.route-turn-count'))
    await expect(page.locator('.route-turn-count')).toHaveCount(188)
    await touch.hold(page.locator('.route-preview-hover-target').first(), page.locator('.route-preview-line'))
    await touch.hold(page.locator('.investigator-piece.blue'), page.locator('.investigator-hover-turn-count'))
    await expect(page.locator('.route-turn-count')).toHaveCount(0)
    await expect.poll(() => cursor(page)).toBe(0)
    const blank = await blankPoint(page)
    await page.touchscreen.tap(blank.x, blank.y)
    await expect(page.locator('.investigator-hover-turn-count')).toHaveCount(0)
    await page.getByLabel('Location 34, selectable', { exact: true }).tap()
    await expect.poll(() => cursor(page)).toBe(1)
  })

  test('discovery setup supports location distances and starting-crossing reach', async ({ page }) => {
    await restore(page, createInitialGame())
    const touch = await touchInput(page)
    await touch.hold(page.getByLabel('Location 33, selectable', { exact: true }), page.locator('.route-turn-count'))
    await touch.hold(page.locator('[data-board-hover="crossing:FP"]'), page.locator('.hovered-investigator-maybe-crossing'))
    await expect(page.locator('.route-turn-count')).toHaveCount(0)
    await expect.poll(() => cursor(page)).toBe(0)
    await page.getByLabel('Location 33, selectable', { exact: true }).tap()
    await expect.poll(() => cursor(page)).toBe(1)
  })

  test('investigator crossings preview future routes and legal moves without moving or staying', async ({ page }) => {
    await restore(page, investigatorState('investigatorMove'))
    const touch = await touchInput(page)
    await touch.hold(page.locator('.investigator-route-preview-hover-target').first(), page.locator('.investigator-route-turn-count'))
    const choice = page.locator('.investigator-distance-preview-hover-target').first()
    await touch.hold(choice, page.locator('.investigator-hover-turn-count'))
    await touch.hold(page.locator('.investigator-piece.yellow'), page.locator('.investigator-hover-turn-count'))
    await expect.poll(() => cursor(page)).toBe(0)
    await page.locator('.investigator-piece.yellow').tap()
    await expect.poll(() => cursor(page)).toBe(1)
    await expect(page.getByRole('heading', { name: 'Blue Investigator: Move', exact: true })).toBeVisible()
    await expect(page.locator('.investigator-hover-turn-count')).toHaveCount(0)
  })

  for (const mode of ['search', 'arrest'] as const) {
    test(`clue outcomes can be inspected without executing ${mode}, then a tap acts normally`, async ({ page }) => {
      await restore(page, { ...investigatorState(), inspectorActionMode: mode })
      const touch = await touchInput(page)
      const choice = page.getByLabel('Location 36, selectable', { exact: true })
      await touch.hold(choice, page.locator('.possible-outcome-marker'))
      await expect.poll(() => cursor(page)).toBe(0)
      await choice.tap()
      await expect.poll(() => cursor(page)).toBe(1)
      await expect(page.locator('.public-log')).toContainText(mode === 'search' ? 'yellow searched 36: clue found.' : 'yellow arrested Jack at 36.')
    })
  }

  test('releasing a hold or dismissing its preview never advances the result screen', async ({ page }) => {
    await restore(page, investigatorState('investigatorTurnResult'))
    const touch = await touchInput(page)
    await touch.hold(page.getByLabel('Location 36', { exact: true }), page.locator('.possible-outcome-marker'))
    await expect.poll(() => cursor(page)).toBe(0)
    const blank = await blankPoint(page)
    await page.touchscreen.tap(blank.x, blank.y)
    await expect(page.locator('.possible-outcome-marker')).toHaveCount(0)
    await expect.poll(() => cursor(page)).toBe(0)
    await page.touchscreen.tap(blank.x, blank.y)
    await expect.poll(() => cursor(page)).toBeGreaterThan(0)
  })

  test('dragging scrolls, multiple fingers and pointer cancellation cancel pending holds', async ({ page }) => {
    await page.setViewportSize({ width: 500, height: 700 })
    await restore(page, jackState())
    const touch = await touchInput(page)
    const choice = page.getByLabel('Location 34, selectable', { exact: true })
    let point = await center(choice)
    const beforeScroll = await page.evaluate(() => window.scrollY)
    await touch.start([point])
    await touch.move([{ x: point.x, y: point.y - 90 }])
    await touch.end()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(beforeScroll)
    await page.waitForTimeout(600)
    await expect(page.locator('.route-turn-count')).toHaveCount(0)
    await expect.poll(() => cursor(page)).toBe(0)
    point = await center(choice)
    await touch.start([{ ...point, id: 0 }])
    await touch.start([{ ...point, id: 0 }, { x: point.x + 50, y: point.y + 50, id: 1 }])
    await page.waitForTimeout(600)
    await touch.end()
    await expect(page.locator('.route-turn-count')).toHaveCount(0)
    await expect.poll(() => cursor(page)).toBe(0)
    await touch.start([await center(choice)])
    await touch.cancel()
    await page.waitForTimeout(600)
    await expect(page.locator('.route-turn-count')).toHaveCount(0)
    await choice.tap()
    await expect.poll(() => cursor(page)).toBe(1)
  })

  test('scroll and refresh preserve game state; blur and turn changes clear pinned previews', async ({ page }) => {
    await restore(page, jackState())
    const touch = await touchInput(page)
    await touch.hold(page.locator('.jack-marker'), page.locator('.route-turn-count'))
    await page.evaluate(() => window.scrollBy(0, 100))
    await expect(page.locator('.route-turn-count').first()).toBeVisible()
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await expect(page.locator('.route-turn-count')).toHaveCount(0)
    await touch.hold(page.getByLabel('Location 34, selectable', { exact: true }), page.locator('.route-turn-count'))
    await page.getByLabel('Location 34, selectable', { exact: true }).tap()
    await touch.hold(page.locator('.jack-marker'), page.locator('.route-turn-count'))
    await expect.poll(() => cursor(page)).toBe(1)
    // Commit from another input source while the preview is pinned.
    await page.getByRole('button', { name: 'Record move privately' }).evaluate((button: HTMLButtonElement) => button.click())
    await expect(page.getByRole('heading', { name: 'Yellow Investigator: Move' })).toBeVisible()
    await expect(page.locator('.route-turn-count')).toHaveCount(0)
    const beforeReload = await cursor(page)
    await page.reload()
    await expect(page.locator('.route-turn-count')).toHaveCount(0)
    await expect.poll(() => cursor(page)).toBe(beforeReload)
  })
})
