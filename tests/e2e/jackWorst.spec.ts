import { expect, test, type Page } from '@playwright/test'
import { createInitialGame } from '../../src/game/gameEngine'
import { createGameHistory, type GameHistory } from '../../src/game/history'
import { worstCaseCrossingEliminations } from '../../src/game/inference'
import { gameReplayTurns } from '../../src/game/replay'
import type { JackMoveType, PublicRoundEvidence } from '../../src/game/types'
import { finishedReplayHistory } from '../fixtures/replayHistory'

const positions = { yellow: 'FP', blue: 'HP', red: 'HZ' }
const evidence: PublicRoundEvidence = { start: 33, observations: [], moves: [1, 2].map(slot => ({
  type: 'normal', startSlot: slot, endSlot: slot, investigatorPositions: positions,
})) }
const id = 'jack-worst'
const savedKey = `whitehall-mystery.saved-game.v1.${id}`

async function restore(page: Page, history: GameHistory) {
  await page.addInitScript(({ history, id, savedKey }) => {
    if (localStorage.getItem(savedKey)) return
    localStorage.setItem('whitehall-mystery.saved-games-migrated.v1', 'true')
    localStorage.setItem('whitehall-mystery.active-game.v1', id)
    localStorage.setItem(savedKey, JSON.stringify({ id, mode: 'same-device', history, startedAt: Date.now(), savedAt: Date.now() }))
    localStorage.setItem('whitehall-mystery.show-next-turn', 'true')
  }, { history, id, savedKey })
  await page.goto('/')
}

async function expectCounts(page: Page, round: PublicRoundEvidence, sprint = false) {
  await page.mouse.move(0, 0)
  const expected = [...worstCaseCrossingEliminations(round, undefined, sprint)]
    .filter(([, count]) => count > 0).map(([id, count]) => [id, String(count)])
  expect(expected.length).toBeGreaterThan(0)
  await expect.poll(() => page.locator('.crossing-worst-indicator').evaluateAll(elements => elements.map(element => [
    element.getAttribute('aria-label')!.split(':')[0]!.slice('Crossing '.length),
    element.querySelector('.crossing-worst-count')!.textContent,
  ]))).toEqual(expected)
}

const forecast = (type: JackMoveType): PublicRoundEvidence => ({ ...evidence, moves: [...evidence.moves, {
  type, startSlot: 3, endSlot: type === 'coach' ? 4 : 3, investigatorPositions: positions,
}] })

test('Jack worst follows public move previews and sprint, saves its preference, and works without maybes', async ({ page }) => {
  await restore(page, createGameHistory({ ...createInitialGame(), stage: 'jackMove', currentJack: 33,
    moveSlot: 2, reachedDiscoveries: [33], discoveryLocations: [33, 46, 147, 159], roundTrail: [33, 13, 33],
    investigatorPositions: positions, publicRound: evidence,
  }))
  const before = await page.evaluate(key => localStorage.getItem(key), savedKey)
  const worst = page.getByRole('checkbox', { name: 'worst', exact: true })
  await expect(worst).not.toBeChecked()
  await expect(worst.locator('..')).toHaveAttribute('title', /guaranteed number.*best order.*stopping at a clue/)
  await expect(page.getByRole('checkbox', { name: 'maybes', exact: true })).not.toBeChecked()
  await worst.check()
  await expectCounts(page, forecast('normal'))
  await page.getByRole('checkbox', { name: 'xings', exact: true }).check()
  await expectCounts(page, forecast('normal')) // Unrelated renders must not restart analysis forever.
  await page.reload()
  await expect(worst).toBeChecked()
  await expectCounts(page, forecast('normal'))
  expect(await page.evaluate(key => localStorage.getItem(key), savedKey)).toBe(before)
  for (const [label, type] of [['Coach (2)', 'coach'], ['Alley (2)', 'alley'], ['Street', 'normal']] as const) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await expectCounts(page, forecast(type))
  }
  const sprint = page.getByRole('checkbox', { name: 'sprint', exact: true })
  await sprint.check()
  await expectCounts(page, forecast('normal'), true)
  await sprint.uncheck()
  await page.getByLabel('Legal Jack destinations').getByRole('button').first().click()
  await expectCounts(page, forecast('normal')) // A secret route choice supplies no public evidence.
  await worst.uncheck()
  await expect(page.locator('.crossing-worst-count')).toHaveCount(0)
  await page.reload()
  await expect(worst).not.toBeChecked()
})

test('Jack worst in replay uses the recorded turn instead of adding another Jack move', async ({ page }) => {
  const history = finishedReplayHistory()
  const turns = gameReplayTurns(history)
  expect(turns[0]!.side).toBe('jack')
  await restore(page, history)
  await page.getByRole('button', { name: 'Start replay', exact: true }).click()
  await page.getByRole('checkbox', { name: 'worst', exact: true }).check()
  await expectCounts(page, turns[0]!.state.publicRound!)
  await page.reload()
  await expectCounts(page, turns[0]!.state.publicRound!)
})
