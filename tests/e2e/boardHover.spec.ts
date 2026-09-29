import { expect, test, type Page } from '@playwright/test'
import { createInitialGame } from '../../src/game/gameEngine'
import { createGameHistory } from '../../src/game/history'

async function restoreJack(page: Page) {
  const history = createGameHistory({ ...createInitialGame(), stage: 'jackMove', currentJack: 33,
    roundTrail: [33], discoveryLocations: [33, 46, 147, 159], reachedDiscoveries: [33],
    investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' },
    publicRound: { start: 33, moves: [], observations: [] }, jackMoveSelection: { type: 'coach', path: [] },
  })
  await page.addInitScript(history => {
    const id = 'hover-regression'
    localStorage.setItem('whitehall-mystery.saved-games-migrated.v1', 'true')
    localStorage.setItem('whitehall-mystery.active-game.v1', id)
    localStorage.setItem(`whitehall-mystery.saved-game.v1.${id}`, JSON.stringify({
      id, mode: 'same-device', history, startedAt: Date.now(), savedAt: Date.now(),
    }))
  }, history)
  await page.goto('/')
}

test('Coach choices cannot leave stale distances when their hover role changes', async ({ page }) => {
  await restoreJack(page)
  const first = page.locator('.map-hit-target[aria-label^="Location 34"]')
  await first.hover()
  await expect(page.locator('.route-turn-count')).toHaveCount(188)
  await first.click()
  await expect(first).toHaveClass(/route-preview-hover-target/)
  // The same DOM node has changed from legal choice to route-preview target.
  // Moving away used to leave 188 labels from location 34 stuck on the board.
  await page.mouse.move(0, 0)
  await expect(page.locator('.route-turn-count')).toHaveCount(0)
  await expect(page.locator('.route-preview-line')).toHaveCount(0)
  await page.locator('.jack-marker').hover()
  expect(await page.locator('.route-turn-count').count()).toBeGreaterThan(0)
  await page.locator('.investigator-piece.blue').hover()
  await expect(page.locator('.route-turn-count')).toHaveCount(0)
  expect(await page.locator('.investigator-hover-turn-count').count()).toBeGreaterThan(0)
  await page.locator('.map-hit-target[data-board-hover^="crossing:"]').first().hover()
  await expect(page.locator('.route-turn-count')).toHaveCount(0)
  await expect(page.locator('.investigator-hover-turn-count')).toHaveCount(0)
  await first.hover()
  await expect(page.locator('.route-preview-line').first()).toBeVisible()
  await page.locator('.jack-marker').hover()
  await expect(page.locator('.route-preview-line')).toHaveCount(0)
})

test('hover previews clear on window blur and when a piece disappears beneath a stationary pointer', async ({ page }) => {
  await restoreJack(page)
  await page.locator('.jack-marker').hover()
  expect(await page.locator('.route-turn-count').count()).toBeGreaterThan(0)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(page.locator('.route-turn-count')).toHaveCount(0)
  await page.getByRole('button', { name: 'Street', exact: true }).click()
  await page.getByLabel('Legal Jack destinations').getByRole('button', { name: '34', exact: true }).click()
  await page.locator('.jack-marker').hover()
  expect(await page.locator('.route-turn-count').count()).toBeGreaterThan(0)
  // Commit from another input source, leaving the physical pointer over Jack.
  await page.getByRole('button', { name: 'Record move privately' }).evaluate((button: HTMLButtonElement) => button.click())
  await expect(page.getByRole('heading', { name: 'Yellow Investigator: Move' })).toBeVisible()
  await expect(page.locator('.jack-marker')).toHaveCount(0)
  await expect(page.locator('.route-turn-count')).toHaveCount(0)
  await expect(page.locator('.possible-outcome-marker')).toHaveCount(0)
})
