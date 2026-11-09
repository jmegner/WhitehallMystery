import { expect, test } from '@playwright/test'
import { createInitialGame } from '../../src/game/gameEngine'
import { publicMovementPaths } from '../../src/game/inference'
import { adjacentCirclesForCrossing, crossings } from '../../src/game/mapData'
import type { GameState, PublicMoveEvidence, PublicObservation } from '../../src/game/types'
import { MAX_CLUE_TURN_LABEL_WIDTH } from '../../src/clueTurnLabel'
import { reviewScreenshot } from './reviewScreenshot'

const yellow = crossings.find(crossing => {
  const positions = { yellow: crossing.id, blue: 'HP', red: 'HZ' }
  return adjacentCirclesForCrossing(crossing.id).includes(13) && publicMovementPaths(33,
    { type: 'normal', startSlot: 1, endSlot: 1, investigatorPositions: positions }).some(path => path[0] === 13)
})!.id
const investigatorPositions = { yellow, blue: 'HP', red: 'HZ' }
const street = (slot: number): PublicMoveEvidence => ({ type: 'normal', startSlot: slot, endSlot: slot, investigatorPositions })
const clue = { kind: 'clue' as const, circleId: 13, found: true, afterMove: 1, investigator: 'yellow' as const }

for (const side of ['investigators', 'jack'] as const) {
  test(`${side} maybes replaces a confirmed clue result with a width-limited black visit-turn list`, async ({ page }) => {
    const observations: PublicObservation[] = [clue, ...[2, 4, 6, 8, 10, 12].map(afterMove => ({
      kind: 'arrest' as const, circleId: 13, hit: false as const, afterMove, investigator: 'yellow' as const,
    }))]
    const state: GameState = { ...createInitialGame(), stage: side === 'jack' ? 'jackMove' : 'investigatorAction',
      inspectorActionMode: 'search', moveSlot: 13, currentJack: 13, investigatorPositions,
      discoveryLocations: [33, 46, 147, 159], reachedDiscoveries: [33], clueLocations: [13],
      roundTrail: [33, ...Array.from({ length: 13 }, (_, index) => index % 2 === 0 ? 13 : 33)],
      publicRound: { start: 33, observations, moves: Array.from({ length: 13 }, (_, index) => street(index + 1)) },
    }
    await page.addInitScript(state => {
      if (localStorage.getItem('whitehall-mystery.game.v1')) return
      localStorage.setItem('whitehall-mystery.game.v1', JSON.stringify({ version: 1, state }))
      localStorage.setItem('whitehall-mystery.show-possible-locations', 'true')
      localStorage.setItem('whitehall-mystery.show-investigator-knowledge', 'true')
    }, state)
    await page.goto('/')
    const toggle = page.getByLabel('maybes')
    await toggle.check()
    const indicator = page.getByLabel('Possible visit turns at 13: M1,3,5,7,9,11,13', { exact: true })
    await expect(indicator).toHaveText('M1..13')
    await expect(indicator).toHaveCSS('fill', 'rgb(0, 0, 0)')
    await expect(page.locator('[aria-label^="Search outcome at 13:"]')).toHaveCount(0)
    await expect(page.locator('.outcome-count-no').first()).toHaveCSS('fill', 'rgb(36, 92, 138)')
    await page.evaluate(() => document.fonts.ready)
    expect(await indicator.evaluate(element => (element as SVGTextElement).getComputedTextLength())).toBeLessThanOrEqual(MAX_CLUE_TURN_LABEL_WIDTH)
    await page.getByRole('checkbox', { name: 'alt', exact: true }).check()
    await expect(indicator).toHaveAttribute('data-indicator-angle', 'right')
    if (side === 'investigators') await page.getByRole('checkbox', { name: 'next', exact: true }).check()
    else await page.getByRole('button', { name: 'Coach (2)', exact: true }).click()
    await expect(indicator).toHaveText('M1..13')
    for (const width of [1000, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect(indicator).toBeVisible()
      await reviewScreenshot(page.locator('.game-board'), { path: test.info().outputPath(`${side}-clue-turns-${width}.png`) })
    }
    await toggle.uncheck()
    await expect(indicator).toHaveCount(0)
    await page.reload()
    await expect(toggle).not.toBeChecked()
    await toggle.check()
    await expect(indicator).toHaveText('M1..13')
    await expect(indicator).toHaveAttribute('data-indicator-angle', 'right')
  })
}

for (const side of ['investigators', 'jack'] as const) {
  test(`${side} shows inferred visits without a yes-clue and keeps forecast visits out of the list`, async ({ page }) => {
    const observations: PublicObservation[] = publicMovementPaths(33, street(1)).flat()
      .filter(id => id !== 13).map(circleId => ({ kind: 'clue', circleId, found: false,
        afterMove: 1, investigator: 'yellow' }))
    const state: GameState = { ...createInitialGame(), stage: side === 'jack' ? 'jackMove' : 'investigatorAction',
      inspectorActionMode: 'search', moveSlot: 3, currentJack: 13, investigatorPositions,
      discoveryLocations: [33, 46, 147, 159], reachedDiscoveries: [33], roundTrail: [33, 13, 33, 13],
      publicRound: { start: 33, moves: [street(1), street(2), street(3)], observations },
    }
    await page.addInitScript(state => {
      if (localStorage.getItem('whitehall-mystery.game.v1')) return
      localStorage.setItem('whitehall-mystery.game.v1', JSON.stringify({ version: 1, state }))
      localStorage.setItem('whitehall-mystery.show-possible-locations', 'true')
      localStorage.setItem('whitehall-mystery.show-investigator-knowledge', 'true')
    }, state)
    await page.goto('/')
    const indicator = page.getByLabel('Possible visit turns at 13: M1,3', { exact: true })
    await expect(indicator).toHaveText('M1,3')
    await expect(page.locator('[aria-label^="Search outcome at 13:"]')).toHaveCount(0)
    await expect(page.locator('.clue-visit-turns')).toHaveCount(2)
    if (side === 'investigators') await page.getByRole('checkbox', { name: 'next', exact: true }).check()
    else await page.getByRole('button', { name: 'Coach (2)', exact: true }).click()
    await expect(indicator).toHaveText('M1,3')
    await page.reload()
    await expect(indicator).toHaveText('M1,3')
    await page.getByLabel('maybes').uncheck()
    await expect(indicator).toHaveCount(0)
  })
}

test('a new yes-clue changes its result indicator into possible visit turns immediately', async ({ page }) => {
  const state: GameState = { ...createInitialGame(), stage: 'investigatorAction', inspectorActionMode: 'search',
    moveSlot: 2, currentJack: 33, investigatorPositions, discoveryLocations: [33, 46, 147, 159],
    reachedDiscoveries: [33], roundTrail: [33, 13, 33],
    publicRound: { start: 33, moves: [street(1), street(2)], observations: [] },
  }
  await page.addInitScript(state => {
    localStorage.setItem('whitehall-mystery.game.v1', JSON.stringify({ version: 1, state }))
    localStorage.setItem('whitehall-mystery.show-possible-locations', 'true')
  }, state)
  await page.goto('/')
  await expect(page.locator('[aria-label^="Search outcome at 13:"]')).toBeVisible()
  await page.getByLabel('Locations adjacent to the yellow Investigator').getByRole('button', { name: '13', exact: true }).click()
  await expect(page.locator('[aria-label^="Search outcome at 13:"]')).toHaveCount(0)
  await expect(page.locator('.clue-visit-turns[aria-label^="Possible visit turns at 13:"]')).toBeVisible()
})
