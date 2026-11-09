import { expect, test, type Page } from '@playwright/test'
import { createInitialGame } from '../../src/game/gameEngine'
import { createGameHistory } from '../../src/game/history'
import { circles } from '../../src/game/mapData'
import type { GameState } from '../../src/game/types'
import { alleyEvidence, alleyPositions, alleyTrail } from '../fixtures/alleyEvidence'
import { holdAiWorker } from './holdAiWorker'
import { reviewScreenshot } from './reviewScreenshot'

function afterAlley(knownVisit = false): GameState {
  const evidence = alleyEvidence(knownVisit)
  const trail = alleyTrail(knownVisit)
  const quadrant = circles.find(circle => circle.id === 24)!.quadrant
  const discoveries = [24, ...(['NW', 'NE', 'SW', 'SE'] as const).filter(value => value !== quadrant).map(value =>
    circles.find(circle => circle.quadrant === value && circle.color === 'white' && !trail.includes(circle.id))!.id)]
  return { ...createInitialGame(), stage: 'investigatorMove', moveSlot: evidence.moves.at(-1)!.endSlot,
    currentJack: 60, roundTrail: trail, investigatorPositions: alleyPositions, publicRound: evidence,
    reachedDiscoveries: [24], discoveryLocations: discoveries, clueLocations: knownVisit ? [60] : [] }
}

async function restore(page: Page, state: GameState, mode = 'same-device') {
  await page.addInitScript(({ history, mode }) => {
    const id = 'alley-indicators'
    if (localStorage.getItem(`whitehall-mystery.saved-game.v1.${id}`)) return
    localStorage.setItem('whitehall-mystery.saved-games-migrated.v1', 'true')
    localStorage.setItem('whitehall-mystery.active-game.v1', id)
    localStorage.setItem(`whitehall-mystery.saved-game.v1.${id}`, JSON.stringify({ id, mode, role: 'jack', history,
      startedAt: Date.now(), savedAt: Date.now() }))
    localStorage.setItem('whitehall-mystery.show-possible-locations', 'true')
    localStorage.setItem('whitehall-mystery.show-investigator-knowledge', 'true')
    localStorage.setItem('whitehall-mystery.show-next-turn', String(mode === 'versus-ai'))
  }, { history: createGameHistory(state), mode })
  if (mode === 'versus-ai') await holdAiWorker(page)
  await page.goto('/')
  await page.mouse.move(0, 0)
}

const marker = (page: Page, id: number) => page.locator(`.possible-marker[data-location-id="${id}"]`)

async function expectAlleyStyles(page: Page, knownVisit = false) {
  await page.mouse.move(0, 0)
  await expect(marker(page, 60)).toHaveAttribute('data-alley-need', 'could')
  await expect(marker(page, 60)).toHaveCSS('stroke', 'rgb(0, 191, 255)')
  await expect(marker(page, 47)).toHaveAttribute('data-alley-need', 'definite')
  await expect(marker(page, 47)).toHaveCSS('stroke', 'rgb(0, 191, 255)')
  await expect(marker(page, 47)).toHaveCSS('stroke-dasharray', /3(?:px)?,?\s+3/)
  const definite = marker(page, 47).locator('..')
  await expect(definite.locator('.alley-definite-gray-marker')).toHaveCSS('stroke', 'rgb(208, 208, 208)')
  await expect(definite.locator('.alley-definite-gray-marker')).toHaveCSS('stroke-opacity', '1')
  await expect(definite.locator('.alley-definite-gray-marker')).toHaveCSS('opacity', '1')
  await expect(definite.locator('.alley-definite-gray-marker')).toHaveCSS('stroke-dasharray', 'none')
  await expect(definite.locator('.possible-certainty-marker')).toHaveCount(0)
  await expect(marker(page, 60).locator('..').locator('.possible-certainty-marker')).toHaveCount(knownVisit ? 0 : 1)
  await expect(marker(page, 44)).not.toHaveAttribute('data-alley-need')
  await expect(marker(page, 44)).toHaveCSS('stroke', 'rgb(122, 60, 175)')
  await expect(page.getByText('Could need Alley', { exact: true })).toBeVisible()
  await expect(page.getByText('Definitely needs Alley', { exact: true })).toBeVisible()
  await expect(page.locator('.legend-alley .alley-definite-gray-marker')).toHaveCSS('stroke', 'rgb(208, 208, 208)')
  await expect(page.locator('.legend-alley .alley-definite-gray-marker')).toHaveCSS('stroke-opacity', '1')
  await expect(page.locator('.legend-alley .alley-definite-blue-marker')).toHaveAttribute('pathLength', '8')
  await expect(page.locator('.legend-alley .alley-definite-blue-marker')).toHaveCSS('stroke-dasharray', /1(?:px)?,?\s+1/)
}

for (const mode of ['same-device', 'versus-ai']) {
  test(`definite Alley indicators have no pink while could-need indicators preserve pink in ${mode}`, async ({ page }) => {
    await restore(page, afterAlley(), mode)
    await expectAlleyStyles(page)
    const pink = marker(page, 60).locator('..').locator('.possible-certainty-marker')
    await expect(pink).toHaveCSS('stroke', 'rgb(255, 3, 167)')
    if (mode === 'same-device') {
      const next = page.getByRole('checkbox', { name: 'next', exact: true })
      await next.check()
      await expect(page.locator('.possible-marker[data-alley-need]')).toHaveCount(0)
      await next.uncheck()
      const choice = page.getByLabel('Legal yellow Investigator destinations').getByRole('button').first()
      await choice.click()
      await expectAlleyStyles(page) // Current investigator moves cannot change Jack's earlier blockers.
    }
    await page.reload()
    await expectAlleyStyles(page)
    const maybes = page.locator(mode === 'same-device' ? '.possibility-toggle input' : '.investigator-knowledge-toggle input')
    await maybes.uncheck()
    await expect(page.locator('.possible-marker[data-alley-need]')).toHaveCount(0)
    await maybes.check()
    await expectAlleyStyles(page)
    await reviewScreenshot(page.locator('.game-board'), { path: test.info().outputPath('alley-indicators.png') })
  })
}

test('an Alley destination visited earlier keeps its old-location pink absence', async ({ page }) => {
  await restore(page, afterAlley(true))
  await expectAlleyStyles(page, true)
  await reviewScreenshot(page.locator('.game-board'), { path: test.info().outputPath('older-alley-indicators.png') })
})

test('Jack previews Alley necessity using public possibilities, and clears it for Street previews', async ({ page }) => {
  const state = afterAlley()
  const before = { ...state.publicRound!, moves: state.publicRound!.moves.slice(0, -1) }
  await restore(page, { ...state, stage: 'jackMove', currentJack: 43, moveSlot: 1, roundTrail: [24, 43], publicRound: before })
  await expect(page.locator('.possible-marker[data-alley-need]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Alley (2)', exact: true }).click()
  await expectAlleyStyles(page)
  await expect(marker(page, 60).locator('..').locator('.possible-certainty-marker')).toHaveCSS('stroke', 'rgb(255, 0, 255)')
  await page.getByRole('button', { name: 'Street', exact: true }).click()
  await expect(page.locator('.possible-marker[data-alley-need]')).toHaveCount(0)
})
