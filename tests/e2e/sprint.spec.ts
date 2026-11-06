import { expect, test, type Page } from '@playwright/test'
import { createInitialGame, gameReducer } from '../../src/game/gameEngine'
import { createGameHistory } from '../../src/game/history'
import { possibleJackLocations, possibleJackLocationsAfterMove, possibleJackSearchOutcomes, publicMovementPaths,
  worstCaseCrossingEliminations } from '../../src/game/inference'
import { adjacentCirclesForCrossing, circles, crossings } from '../../src/game/mapData'
import type { GameState, PublicMoveEvidence, PublicRoundEvidence } from '../../src/game/types'

const positions = { yellow: 'FP', blue: 'HP', red: 'HZ' }
const street = (slot: number): PublicMoveEvidence => ({ type: 'normal', startSlot: slot, endSlot: slot, investigatorPositions: positions })
const round: PublicRoundEvidence = { start: 33, moves: [street(1), street(2), street(3)], observations: [] }
const savedKey = 'whitehall-mystery.saved-game.v1.sprint-regression'

async function restore(page: Page, state: GameState, sprint = false) {
  await page.addInitScript(({ history, sprint, savedKey }) => {
    if (localStorage.getItem('whitehall-mystery.active-game.v1')) return
    const id = 'sprint-regression'
    localStorage.setItem('whitehall-mystery.saved-games-migrated.v1', 'true')
    localStorage.setItem('whitehall-mystery.active-game.v1', id)
    localStorage.setItem(savedKey, JSON.stringify({ id, mode: 'same-device', history, startedAt: Date.now(), savedAt: Date.now() }))
    localStorage.setItem('whitehall-mystery.show-possible-locations', 'true')
    // The renamed Jack checkbox must retain the previous know preference.
    localStorage.setItem('whitehall-mystery.show-investigator-knowledge', 'true')
    localStorage.setItem('whitehall-mystery.sprint', String(sprint))
  }, { history: createGameHistory(state), sprint, savedKey })
  await page.goto('/')
}

function stateFor(stage: GameState['stage'], evidence = round): GameState {
  return { ...createInitialGame(), stage, moveSlot: evidence.moves.at(-1)?.endSlot ?? 0,
    currentJack: 33, investigatorPositions: positions, discoveryLocations: [33, 46, 147, 159],
    reachedDiscoveries: [33], roundTrail: [33, 13, 33, 13], publicRound: evidence }
}

async function expectMarkers(page: Page, ids: Set<number>) {
  await expect(page.locator('.possible-marker')).toHaveCount(ids.size)
  const coordinates = await page.locator('.possible-marker').evaluateAll(elements => elements.map(element =>
    `${element.getAttribute('cx')},${element.getAttribute('cy')}`).sort())
  expect(coordinates).toEqual(circles.filter(circle => ids.has(circle.id)).map(circle => `${circle.x},${circle.y}`).sort())
}

test('Jack maybes keeps the old preference and sprint persists across refresh and the side handoff', async ({ page }) => {
  const evidence = { ...round, moves: round.moves.slice(0, 2) }
  await restore(page, { ...stateFor('jackMove', evidence), roundTrail: [33, 13, 33] })
  await expect(page.locator('.investigator-knowledge-toggle input')).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'know', exact: true })).toHaveCount(0)
  const sprint = page.getByRole('checkbox', { name: 'sprint', exact: true })
  await expect(sprint).not.toBeChecked()
  const normal = possibleJackLocationsAfterMove(evidence, 'normal', positions, 2)
  const efficient = possibleJackLocationsAfterMove(evidence, 'normal', positions, 2, true)
  expect(efficient.size).toBeLessThan(normal.size)
  await expectMarkers(page, normal)
  await sprint.check()
  await expect(sprint.locator('..')).toHaveAttribute('title', /least total delay.*public clues/)
  await expectMarkers(page, efficient)
  await page.reload()
  await expect(sprint).toBeChecked()
  await expectMarkers(page, efficient)
  await page.getByLabel('Legal Jack destinations').getByRole('button', { name: '13', exact: true }).click()
  await page.getByRole('button', { name: 'Record move privately' }).click()
  await expect(page.getByRole('heading', { name: 'Yellow Investigator: Move' })).toBeVisible()
  await expect(sprint).toBeChecked()
  await expectMarkers(page, possibleJackLocations(round, true))
  const maybes = page.locator('.possibility-toggle input')
  await maybes.uncheck()
  await expect(page.locator('.possible-marker')).toHaveCount(0)
  await expect(sprint).toBeChecked()
  await maybes.check()
  await expectMarkers(page, possibleJackLocations(round, true))
  await sprint.uncheck()
  await expectMarkers(page, possibleJackLocations(round))
  await page.reload()
  await expect(sprint).not.toBeChecked()
})

test('sprint refreshes current and next maybes and worker worst counts without changing the game', async ({ page }) => {
  await restore(page, stateFor('investigatorMove'))
  const sprint = page.getByRole('checkbox', { name: 'sprint', exact: true })
  const next = page.getByRole('checkbox', { name: 'next', exact: true })
  const worst = page.getByRole('checkbox', { name: 'worst', exact: true })
  const saved = await page.evaluate(key => localStorage.getItem(key), savedKey)
  await worst.check()
  async function expectPerspective(sprinting: boolean, future: boolean) {
    const outcomes = possibleJackSearchOutcomes(round, future ? positions : undefined, sprinting)
    await expectMarkers(page, new Set([...outcomes.values()].flatMap(outcome => [...outcome.ifYes])))
    await expect.poll(() => page.locator('.crossing-worst-count').allTextContents()).toEqual(
      [...worstCaseCrossingEliminations(round, future ? positions : undefined, sprinting).values()].filter(count => count > 0).map(String))
  }
  await expectPerspective(false, false)
  await sprint.check()
  await expectPerspective(true, false)
  await next.check()
  await expectPerspective(true, true)
  await sprint.uncheck()
  await expectPerspective(false, true)
  await sprint.check()
  await expectPerspective(true, true)
  await page.reload()
  await expect(sprint).toBeChecked()
  await expect(next).toBeChecked()
  await expect(worst).toBeChecked()
  await expectPerspective(true, true)
  expect(await page.evaluate(key => localStorage.getItem(key), savedKey)).toBe(saved)
})

test('a real clue can require backtracking and sprint keeps the least inefficient explanations', async ({ page }) => {
  const neighbors = (id: number) => publicMovementPaths(id, street(1)).flat()
  const first = neighbors(33).find(id => neighbors(33).some(other => other !== id && !neighbors(id).includes(other)
    && neighbors(id).filter(common => neighbors(other).includes(common)).every(common => common === 33)))!
  const second = neighbors(33).find(other => other !== first && !neighbors(first).includes(other)
    && neighbors(first).filter(common => neighbors(other).includes(common)).every(common => common === 33))!
  const yellow = crossings.find(crossing => adjacentCirclesForCrossing(crossing.id).includes(second))!.id
  const evidence: PublicRoundEvidence = { ...round, observations: [{ kind: 'clue', circleId: first,
    found: true, afterMove: 1, investigator: 'yellow' }] }
  const state: GameState = { ...stateFor('investigatorAction', evidence), inspectorActionMode: 'search',
    currentJack: second, clueLocations: [first], roundTrail: [33, first, 33, second],
    investigatorPositions: { ...positions, yellow } }
  expect(possibleJackLocations(evidence, true).has(second)).toBe(false)
  await restore(page, state, true)
  await expectMarkers(page, possibleJackLocations(evidence, true))
  await page.getByLabel('Locations adjacent to the yellow Investigator').getByRole('button', { name: String(second), exact: true }).click()
  const after = gameReducer(state, { type: 'searchCircle', circleId: second })
  const efficient = possibleJackLocations(after.publicRound, true)
  expect(efficient.size).toBeGreaterThan(0)
  expect(efficient.has(second)).toBe(true)
  await page.mouse.move(0, 0)
  await expectMarkers(page, efficient)
  await expect(page.getByRole('checkbox', { name: 'sprint', exact: true })).toBeChecked()
  await expect(page.locator(`.clue-visit-turns[aria-label^="Possible visit turns at ${second}:"]`)).toHaveText('3')
})
