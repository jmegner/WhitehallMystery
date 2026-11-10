import { expect, test, type Page } from '@playwright/test'
import { discoveryDifficulty, EASY_DISCOVERY_LIMIT, MEDIUM_DISCOVERY_MIN, MEDIUM_DISCOVERY_MAX, HARD_DISCOVERY_MIN } from '../../src/game/aiDiscoveries'
import { createInitialGame } from '../../src/game/gameEngine'
import { currentHistoryState, type GameHistory } from '../../src/game/history'
import { reviewScreenshot } from './reviewScreenshot'

async function savedHistory(page: Page): Promise<GameHistory> {
  return page.evaluate(() => JSON.parse(localStorage.getItem(`whitehall-mystery.saved-game.v1.${localStorage.getItem('whitehall-mystery.active-game.v1')}`)!).history)
}

for (const level of ['Easy', 'Med', 'Hard']) {
  test(`Rand ${level} preserves selections, fills remaining quadrants, and survives refresh and undo`, async ({ page }) => {
    await page.goto('/')
    const controls = page.getByLabel('Action history controls', { exact: true })
    await expect(controls.getByRole('button')).toHaveText(['Undo Side', 'Undo', 'Redo', 'Redo Side', 'Rand', 'Rand Side', 'Rand Easy', 'Rand Med', 'Rand Hard'])
    if (page.viewportSize()!.width <= 680) {
      for (const button of await controls.getByRole('button').all()) {
        const box = (await button.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width)
      }
    }
    if (level === 'Easy') await reviewScreenshot(controls, { path: test.info().outputPath('discovery-buttons.png') })
    await page.getByLabel('Location 33, selectable', { exact: true }).click()
    const button = controls.getByRole('button', { name: `Rand ${level}`, exact: true })
    await expect(button).toBeEnabled()
    await expect(button).toHaveAttribute('title', /whitehallmystery\.com; keep selected locations/)
    await button.click()
    const completed = currentHistoryState(await savedHistory(page))
    expect(completed.stage).toBe('jackDiscoverySetup')
    expect(completed.discoveryLocations).toHaveLength(4)
    expect(completed.discoveryLocations).toContain(33)
    const difficulty = discoveryDifficulty(completed.discoveryLocations)
    expect(Number.isFinite(difficulty)).toBe(true)
    if (level === 'Easy') expect(difficulty).toBeLessThanOrEqual(EASY_DISCOVERY_LIMIT)
    if (level === 'Med') {
      expect(difficulty).toBeGreaterThanOrEqual(MEDIUM_DISCOVERY_MIN)
      expect(difficulty).toBeLessThanOrEqual(MEDIUM_DISCOVERY_MAX)
    }
    if (level === 'Hard') expect(difficulty).toBeGreaterThanOrEqual(HARD_DISCOVERY_MIN)
    for (const label of ['Easy', 'Med', 'Hard']) await expect(controls.getByRole('button', { name: `Rand ${label}`, exact: true })).toBeDisabled()
    await page.reload()
    expect(currentHistoryState(await savedHistory(page)).discoveryLocations).toEqual(completed.discoveryLocations)
    for (let count = 0; count < 3; count++) await controls.getByRole('button', { name: 'Undo', exact: true }).click()
    expect(currentHistoryState(await savedHistory(page)).discoveryLocations).toEqual([33])
    for (let count = 0; count < 3; count++) await controls.getByRole('button', { name: 'Redo', exact: true }).click()
    expect(currentHistoryState(await savedHistory(page)).discoveryLocations).toEqual(completed.discoveryLocations)
    await page.getByRole('button', { name: 'Lock in four locations', exact: true }).click()
    await expect(controls.getByRole('button', { name: `Rand ${level}`, exact: true })).toHaveCount(0)
  })
}

test('disables impossible difficulties without replacing selected locations', async ({ page }) => {
  await page.addInitScript(state => {
    localStorage.setItem('whitehall-mystery.game.v1', JSON.stringify({ version: 1, state }))
  }, { ...createInitialGame(), discoveryLocations: [33, 43, 130] })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Rand Hard', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Rand Hard', exact: true })).toHaveAttribute('title', 'No Hard set is possible with the selected discovery locations')
  await expect(page.getByRole('button', { name: 'Rand Easy', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Rand Med', exact: true }).click()
  expect(currentHistoryState(await savedHistory(page)).discoveryLocations).toEqual([33, 43, 130, 152])
})
