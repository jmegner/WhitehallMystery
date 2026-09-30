import { expect, test, type Page } from '@playwright/test'
import { createInitialGame, legalInspectorActionCircles } from '../../src/game/gameEngine'
import { gameHistoryReducer, type GameHistory } from '../../src/game/history'
import type { GameState } from '../../src/game/types'

const id = 'game-over-paths'
const key = `whitehall-mystery.saved-game.v1.${id}`
function finishedHistory(): GameHistory {
  const base: GameState = { ...createInitialGame(), stage: 'investigatorAction', inspectorActionMode: 'arrest',
    discoveryLocations: [33, 46, 147, 159], reachedDiscoveries: [33, 46, 147],
    investigatorPositions: { yellow: 'CF', blue: 'DC', red: 'HZ' } }
  const target = legalInspectorActionCircles(base)[0]!
  const paths = [[33, 44, 55, 44, 46], [46, 60, 147], [147, 86, target]]
  const history: GameHistory = { cursor: 2, pendingReveal: null, entries: paths.map((roundTrail, index) => ({
    state: { ...base, round: index + 1, roundTrail, moveSlot: roundTrail.length - 1, currentJack: roundTrail.at(-1)!,
      publicRound: { start: roundTrail[0]!, moves: [], observations: [] } },
    action: index === 0 ? null : { type: 'continueHandoff' }, counted: index !== 0,
  })) }
  return gameHistoryReducer(history, { type: 'apply', action: { type: 'arrestCircle', circleId: target } })
}

async function restore(page: Page, history: GameHistory) {
  await page.addInitScript(({ history, id, key }) => {
    if (localStorage.getItem(key)) return
    localStorage.setItem('whitehall-mystery.saved-games-migrated.v1', 'true')
    localStorage.setItem('whitehall-mystery.active-game.v1', id)
    localStorage.setItem(key, JSON.stringify({ id, mode: 'same-device', role: 'jack', history,
      startedAt: Date.now(), savedAt: Date.now() }))
  }, { history, id, key })
}

test('game-over past displays selected rounds and all rounds, preserving preferences and undo privacy', async ({ page }) => {
  const history = finishedHistory()
  await restore(page, history)
  await page.goto('/')
  const past = page.getByRole('checkbox', { name: 'past', exact: true })
  const round = page.getByRole('combobox', { name: 'round', exact: true })
  await expect(past).not.toBeChecked()
  await expect(round.locator('option')).toHaveText(['1', '2', '3', 'all'])
  await expect(round).toHaveValue('all')
  await expect(page.locator('.past-path-line')).toHaveCount(0)
  await past.check()
  await expect(page.locator('.past-path-line')).toHaveCount(8)
  await expect(page.locator('.past-path-step text')).toHaveText(['1.1', '1.2', '1.3', '1.4', '2.1', '2.2', '3.1', '3.2'])
  for (const index of [1, 2, 3]) {
    await round.selectOption(String(index))
    const moves = index === 1 ? 4 : 2
    await expect(page.locator('.past-path-line')).toHaveCount(moves)
    await expect(page.locator(`.past-path-line[data-round="${index}"]`)).toHaveCount(moves)
    await expect(page.locator('.past-path-step')).toHaveCount(moves)
  }
  await round.selectOption('2')
  await page.reload()
  await expect(past).toBeChecked()
  await expect(round).toHaveValue('2')
  await expect(page.locator('.past-path-line[data-round="2"]')).toHaveCount(2)
  await page.screenshot({ path: test.info().outputPath('game-over-round-2.png') })
  await round.selectOption('all')
  await page.screenshot({ path: test.info().outputPath('game-over-all-rounds.png') })
  await past.uncheck()
  await page.reload()
  await expect(past).not.toBeChecked()
  await expect(round).toHaveValue('all')
  await expect(page.locator('.past-path-line')).toHaveCount(0)
  await past.check()
  const dialogs: string[] = []
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss() })
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(past).toHaveCount(0)
  await expect(round).toHaveCount(0)
  await expect(page.locator('.past-path-line')).toHaveCount(0)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(past).toBeChecked()
  await expect(page.locator('.past-path-line')).toHaveCount(8)
  expect(dialogs).toEqual([])
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).history, key)).toEqual(history)
})

test('an early finish or older single-snapshot save only offers rounds with recorded paths', async ({ page }) => {
  const state = { ...finishedHistory().entries.at(-1)!.state, round: 1 }
  await restore(page, { entries: [{ state, action: null, counted: false }], cursor: 0, pendingReveal: null })
  await page.addInitScript(() => {
    localStorage.setItem('whitehall-mystery.past-path-round', '3')
    localStorage.setItem('whitehall-mystery.show-past-path', 'true')
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const round = page.getByRole('combobox', { name: 'round', exact: true })
  await expect(round).toHaveValue('all')
  await expect(round.locator('option[value="2"]')).toHaveJSProperty('disabled', true)
  await expect(round.locator('option[value="3"]')).toHaveJSProperty('disabled', true)
  await expect(page.locator('.past-path-line[data-round="1"]')).toHaveCount(2)
  await round.selectOption('1')
  await expect(page.locator('.past-path-step text')).toHaveText(['1', '2'])
  await expect(round).toBeInViewport()
  await page.screenshot({ path: test.info().outputPath('game-over-mobile.png') })
})
