import { expect, test, type Page } from '@playwright/test'
import { createInitialGame } from '../../src/game/gameEngine'
import { createGameHistory } from '../../src/game/history'
import type { GameState } from '../../src/game/types'

function knownClueState(): GameState {
  const positions = { yellow: 'CF', blue: 'DC', red: 'HZ' }
  return {
    ...createInitialGame(), stage: 'investigatorAction', activeInvestigator: 1, moveSlot: 3,
    currentJack: 36, roundTrail: [54, 36, 54, 36],
    discoveryLocations: [54, 46, 147, 159], reachedDiscoveries: [54], clueLocations: [36],
    inspectorActionMode: 'search', investigatorPositions: { ...positions, blue: 'DD' },
    publicLog: ['M0: Round 1 begins from 54.', 'M1: yellow searched 36: clue found.'],
    publicRound: {
      start: 54,
      moves: [1, 2, 3].map(slot => ({ type: 'normal', startSlot: slot, endSlot: slot, investigatorPositions: positions })),
      observations: [{ kind: 'clue', circleId: 36, found: true, afterMove: 1, investigator: 'yellow' }],
    },
  }
}

async function restoreGame(page: Page, state: GameState, mode: 'same-device' | 'versus-ai', role: 'jack' | 'investigators' = 'investigators') {
  await page.addInitScript(({ history, mode, role }) => {
    const id = 'inv-auto-known-clue'
    if (localStorage.getItem(`whitehall-mystery.saved-game.v1.${id}`)) return
    localStorage.setItem('whitehall-mystery.saved-games-migrated.v1', 'true')
    localStorage.setItem('whitehall-mystery.active-game.v1', id)
    localStorage.setItem(`whitehall-mystery.saved-game.v1.${id}`, JSON.stringify({
      id, mode, role, history, startedAt: Date.now(), savedAt: Date.now(),
    }))
  }, { history: createGameHistory(state), mode, role })
}

for (const mode of ['same-device', 'versus-ai'] as const) {
  test(`InvAuto arrests on a known clue in ${mode}, with undo, redo and refresh`, async ({ page }) => {
    await restoreGame(page, knownClueState(), mode)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Blue Investigator: Clues and Suspicion', exact: true })).toBeVisible()
    await expect(page.locator('.clue-marker')).toHaveCount(1)
    await expect(page.locator('.jack-marker')).toHaveCount(0)
    // The successful arrest immediately removes the in-game checkbox.
    await expect(page.getByLabel('InvAuto', { exact: true })).not.toBeChecked()
    await page.getByLabel('InvAuto', { exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Jack Was Stopped', exact: true })).toBeVisible()
    await expect(page.locator('.public-log')).toContainText('blue arrested Jack at 36.')
    await expect(page.locator('.public-log')).not.toContainText('blue passed the action phase.')

    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Blue Investigator: Clues and Suspicion', exact: true })).toBeVisible()
    await expect(page.getByLabel('InvAuto', { exact: true })).toBeChecked()
    await expect(page.locator('.public-log')).not.toContainText('blue arrested Jack at 36.')
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Jack Was Stopped', exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Jack Was Stopped', exact: true })).toBeVisible()
    await expect(page.locator('.public-log')).toContainText('blue arrested Jack at 36.')
  })
}

test('the investigator AI worker arrests Jack on a known clue', async ({ page }) => {
  await restoreGame(page, knownClueState(), 'versus-ai', 'jack')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Jack Was Stopped', exact: true })).toBeVisible({ timeout: 15000 })
  await expect(page.locator('.public-log')).toContainText('blue arrested Jack at 36.')
  await expect(page.locator('.public-log')).not.toContainText('blue passed the action phase.')
})

test('InvAuto executes a coordinated three-investigator capture', async ({ page }) => {
  const state: GameState = {
    ...createInitialGame(), stage: 'investigatorAction', inspectorActionMode: 'search',
    currentJack: 61, roundTrail: [63, 61], round: 2, moveSlot: 1,
    discoveryLocations: [54, 63, 147, 159], reachedDiscoveries: [54, 63],
    investigatorPositions: { yellow: 'JX', blue: 'CR', red: 'JZ' },
    publicRound: { start: 63, observations: [], moves: [{
      type: 'normal', startSlot: 1, endSlot: 1, investigatorPositions: { yellow: 'JW', blue: 'CV', red: 'JP' },
    }] },
  }
  await restoreGame(page, state, 'versus-ai')
  await page.goto('/')
  await page.getByLabel('InvAuto', { exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Jack Was Stopped', exact: true })).toBeVisible()
  const log = page.locator('.public-log')
  await expect(log).toContainText('yellow attempted an arrest at 62: missed.')
  await expect(log).toContainText('blue attempted an arrest at 46: missed.')
  await expect(log).toContainText('red arrested Jack at 61.')
  await expect(log).not.toContainText('searched')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Jack Was Stopped', exact: true })).toBeVisible()
})

test('InvAuto reorders searches after each answer once the player starts searching', async ({ page }) => {
  const positions = { yellow: 'FP', blue: 'HP', red: 'HZ' }
  const state: GameState = {
    ...createInitialGame(), stage: 'investigatorAction', inspectorActionMode: 'search', activeInvestigator: 2,
    currentJack: 75, roundTrail: [33, 34, 54, 72, 73, 74, 75], moveSlot: 6,
    discoveryLocations: [33, 46, 147, 159], reachedDiscoveries: [33],
    publicLog: [],
    investigatorPositions: { ...positions, red: 'CQ' },
    publicRound: { start: 33, observations: [], moves: [1, 2, 3, 4, 5, 6].map(slot => ({
      type: 'normal', startSlot: slot, endSlot: slot, investigatorPositions: positions,
    })) },
  }
  await restoreGame(page, state, 'same-device')
  await page.goto('/')
  await page.getByLabel('InvAuto', { exact: true }).check()
  await expect(page.getByRole('heading', { name: 'Red Investigator: Clues and Suspicion', exact: true })).toBeVisible()
  await expect(page.locator('.public-log')).not.toContainText('searched')
  await page.getByLabel('Locations adjacent to the red Investigator').getByRole('button', { name: '44', exact: true }).click()
  await expect(page.getByText('Results shown · Click anywhere on the map to continue')).toBeVisible()
  // The log is newest first; the actual search order is 44, 43, 59, 42.
  await expect(page.locator('.public-log-section li')).toHaveText([
    'M6: red searched 42: no clue.', 'M6: red searched 59: no clue.',
    'M6: red searched 43: no clue.', 'M6: red searched 44: no clue.',
  ])
  await page.reload()
  await expect(page.getByText('Results shown · Click anywhere on the map to continue')).toBeVisible()
})
