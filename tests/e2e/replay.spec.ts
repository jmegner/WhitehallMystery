import { expect, test, type Page } from '@playwright/test'
import { finishedReplayHistory, occupiedStartReplayHistory } from '../fixtures/replayHistory'
import { gameReplayTurns } from '../../src/game/replay'
import { encodeMail } from '../../src/game/byMail'
import type { GameHistory } from '../../src/game/history'
import type { SavedGame } from '../../src/game/savedGames'
import { crossingsById } from '../../src/game/mapData'
import { possibleJackLocations } from '../../src/game/inference'
import { reviewScreenshot } from './reviewScreenshot'

const id = 'replay-game'
const key = `whitehall-mystery.saved-game.v1.${id}`
async function restore(page: Page, history: GameHistory, mode: 'same-device' | 'versus-ai' | 'by-mail' = 'same-device') {
  const common = { id, startedAt: Date.now(), savedAt: Date.now() }
  const mailId = 1789142400
  const saved: SavedGame = mode === 'by-mail' ? { ...common, mode,
    session: { id: mailId, role: 'investigators', history, outgoing: encodeMail(mailId, 'investigators', history),
      turnStart: history.cursor, baselineEndedAt: null },
    view: { draft: '', showBoard: false, activeSharing: true },
  } : mode === 'versus-ai' ? { ...common, mode, role: 'investigators', history }
    : { ...common, mode, history }
  await page.addInitScript(({ saved, key }) => {
    if (localStorage.getItem(key)) return
    localStorage.setItem('whitehall-mystery.saved-games-migrated.v1', 'true')
    localStorage.setItem('whitehall-mystery.active-game.v1', saved.id)
    localStorage.setItem(key, JSON.stringify(saved))
  }, { saved, key })
  return saved
}

test('replays whole side turns and rounds with analysis controls, persists its position, and preserves the finished game', async ({ page }) => {
  const history = finishedReplayHistory()
  const turns = gameReplayTurns(history)
  await restore(page, history)
  await page.goto('/')
  await reviewScreenshot(page.locator('.board-toolbar'), { path: test.info().outputPath('replay-start-button.png') })
  await page.getByRole('button', { name: 'Start replay', exact: true }).click()
  const controls = page.getByRole('region', { name: 'Replay controls' })
  const status = controls.getByRole('status')
  await expect(status).toContainText(`Round 1 · Move 2 · Jack · 1/${turns.length}`)
  await expect(controls.getByRole('button', { name: 'Previous turn' })).toBeDisabled()
  await expect(controls.getByRole('button', { name: 'Previous round' })).toBeDisabled()
  await expect(page.locator('.jack-marker')).toHaveCount(1)
  await expect(page.locator('.past-path-step')).toHaveCount(2)
  const past = page.getByRole('checkbox', { name: 'past', exact: true })
  await expect(past).toBeChecked()
  await expect(past).toBeDisabled()
  for (const name of ['coach', 'future', 'know', 'xings', 'alt']) {
    await expect(page.getByRole('checkbox', { name, exact: true })).toBeEnabled()
  }
  await page.getByRole('checkbox', { name: 'know', exact: true }).check()
  await expect(page.locator('.game-board')).toHaveClass(/investigator-knowledge-preview/)
  await expect(page.locator('.investigator-knowledge-toggle strong')).toHaveText(String(possibleJackLocations(turns[0]!.state.publicRound).size))
  await controls.getByRole('button', { name: 'Next turn' }).click()
  await expect(status).toContainText(`Investigators · 2/${turns.length}`)
  for (const name of ['next', 'worst', 'maybes', 'xings', 'alt']) {
    await expect(page.getByRole('checkbox', { name, exact: true })).toBeEnabled()
  }
  await page.getByRole('checkbox', { name: 'maybes', exact: true }).check()
  await expect(page.locator('.possibility-toggle strong')).toHaveText(String(possibleJackLocations(turns[1]!.state.publicRound).size))
  await page.getByRole('checkbox', { name: 'worst', exact: true }).check()
  await expect(page.locator('.crossing-worst-indicator').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /^(Undo|Redo|Pass|Search|Arrest|Submit)$/ })).toHaveCount(0)
  await expect(page.locator('[data-active-playing-piece]')).toHaveCount(0)
  await controls.getByRole('button', { name: 'Next round' }).click()
  const second = turns.findIndex(turn => turn.state.round === 2)
  await expect(status).toContainText(`Round 2 · Move 1 · Jack · ${second + 1}/${turns.length}`)
  await expect(page.locator('.past-path-step')).toHaveCount(1)
  await page.reload()
  await expect(status).toContainText(`Round 2 · Move 1 · Jack · ${second + 1}/${turns.length}`)
  await expect(page.locator('.investigator-knowledge-toggle input')).toBeChecked()
  await controls.getByRole('button', { name: 'Previous turn' }).click()
  await expect(status).toContainText('Round 1')
  await expect(status).toContainText('Investigators')
  await expect(page.locator('.possibility-toggle input')).toBeChecked()
  await controls.getByRole('button', { name: 'Next round' }).click()
  await controls.getByRole('button', { name: 'Next round' }).click()
  await expect(status).toContainText('Round 3')
  await expect(controls.getByRole('button', { name: 'Next round' })).toBeDisabled()
  await controls.getByRole('button', { name: 'Previous round' }).click()
  await expect(status).toContainText('Round 2')
  await controls.getByRole('button', { name: 'Next round' }).click()
  for (let index = turns.findIndex(turn => turn.state.round === 3); index < turns.length - 1; index++) {
    await controls.getByRole('button', { name: 'Next turn' }).click()
  }
  await expect(controls.getByRole('button', { name: 'Next turn' })).toBeDisabled()
  await expect(status).toContainText(`Investigators · ${turns.length}/${turns.length}`)
  await expect(page.locator('.past-path-step')).toHaveCount(turns.at(-1)!.state.roundTrail.length - 1)
  await expect(page.locator('.notice')).toContainText(history.entries.at(-1)!.state.result!.reason)
  await controls.getByRole('button', { name: 'Exit replay' }).click()
  await expect(page.getByRole('heading', { name: 'Jack Escaped', exact: true })).toBeVisible()
  await expect(past).not.toBeChecked()
  await page.reload()
  await expect(controls).toHaveCount(0)
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).history, key)).toEqual(history)
})

test('investigator replay uses ghosts and starting-color outlines around occupied starts, including in AI games', async ({ page }) => {
  const history = occupiedStartReplayHistory()
  await restore(page, history, 'versus-ai')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Start replay', exact: true }).click()
  const ghost = page.locator('.investigator-ghost')
  await expect(ghost).toHaveCount(1)
  await expect(ghost).toHaveAttribute('data-starting-color', 'blue')
  expect(await ghost.evaluate(element => Number(getComputedStyle(element).opacity))).toBe(1)
  const start = crossingsById.get('DC')!
  await expect(ghost.locator('circle')).toHaveAttribute('cx', String(start.x))
  await expect(ghost.locator('circle')).toHaveAttribute('cy', String(start.y))
  const outline = page.locator('.replay-start-outline[data-starting-color="yellow"]')
  const ending = page.locator('.investigator-piece.blue circle')
  await expect(outline).toHaveAttribute('stroke', '#ffff00')
  await expect(outline).toHaveAttribute('cx', String(crossingsById.get('DD')!.x))
  await expect(outline).toHaveAttribute('cy', String(crossingsById.get('DD')!.y))
  await expect(ending).toHaveAttribute('cx', await outline.getAttribute('cx') ?? '')
  await expect(ending).toHaveAttribute('cy', await outline.getAttribute('cy') ?? '')
  await expect(page.locator('.replay-start-outline[data-starting-color="red"]')).toHaveAttribute('stroke', '#b02f2e')
  const worst = page.getByRole('checkbox', { name: 'worst', exact: true })
  await worst.check()
  await worst.hover()
  async function expectWorstClearsStarts() {
    for (const [crossing, marker] of [['DC', ghost], ['DD', outline]] as const) {
      const badge = page.locator(`.crossing-worst-indicator[aria-label^="Crossing ${crossing}:"]`)
      await expect(badge).toBeVisible()
      const badgeBounds = (await badge.boundingBox())!
      const markerBounds = (await marker.boundingBox())!
      expect(badgeBounds.y + badgeBounds.height).toBeLessThanOrEqual(markerBounds.y)
    }
  }
  await expectWorstClearsStarts()
  await expect(page.locator('.jack-marker')).toHaveCount(1)
  await expect(page.locator('.past-path-step')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Next turn' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Previous turn' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Next round' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Previous round' })).toBeDisabled()
  await expect(page.locator('[aria-label$=", selectable"]')).toHaveCount(0)
  await ending.click({ force: true })
  await ending.click({ button: 'middle', force: true })
  await worst.hover()
  await expect(page.getByRole('region', { name: 'Replay controls' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await reviewScreenshot(page, { path: test.info().outputPath('replay-mobile.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1100 })
  await expectWorstClearsStarts()
  await reviewScreenshot(page.locator('.game-board'), { path: test.info().outputPath('replay-starts.png') })
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).history, key)).toEqual(history)
})

test('starts replay directly from a finished By Mail sharing screen without changing game text', async ({ page }) => {
  const history = finishedReplayHistory()
  const saved = await restore(page, history, 'by-mail')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Game over', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Start replay', exact: true }).click()
  const controls = page.getByRole('region', { name: 'Replay controls' })
  await expect(controls.getByRole('status')).toContainText('Round 1 · Move 2 · Jack')
  await expect(page.locator('.jack-marker')).toHaveCount(1)
  await controls.getByRole('button', { name: 'Next turn' }).click()
  await page.reload()
  await expect(controls.getByRole('status')).toContainText('Investigators · 2/')
  const after = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)
  expect(after.session).toEqual(saved.mode === 'by-mail' && saved.session)
  expect(after.view.activeSharing).toBe(false)
})
