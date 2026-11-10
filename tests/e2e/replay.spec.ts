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
  await expect(page.locator('.past-path-step text')).toHaveText(['1C', '2C'])
  const past = page.getByRole('checkbox', { name: 'past', exact: true })
  await expect(past).toBeChecked()
  await expect(past).toBeDisabled()
  for (const name of ['coach', 'future', 'maybes', 'sprint', 'xings', 'alt']) {
    await expect(page.getByRole('checkbox', { name, exact: true })).toBeEnabled()
  }
  await page.getByRole('checkbox', { name: 'maybes', exact: true }).check()
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
  await expect(page.locator('.past-path-step')).toHaveCount(new Set(turns.at(-1)!.state.roundTrail.slice(1)).size)
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
  const replayControls = page.getByRole('region', { name: 'Replay controls' })
  await expect(replayControls.getByRole('button', { name: 'Next turn' })).toBeDisabled()
  await expect(replayControls.getByRole('button', { name: 'Previous turn' })).toBeDisabled()
  await expect(replayControls.getByRole('button', { name: 'Next round' })).toBeDisabled()
  await expect(replayControls.getByRole('button', { name: 'Previous round' })).toBeDisabled()
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

test.describe('floating replay controls', () => {
  test.use({ viewport: { width: 390, height: 600 }, hasTouch: true })

  test.beforeEach(async ({ page, browserName }) => {
    if (browserName === 'firefox') await page.addInitScript(() => {
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 })
    })
  })

  async function expectBottomNavigation(page: Page) {
    const navigation = page.getByRole('group', { name: 'Floating replay controls', exact: true })
    await expect.poll(() => navigation.evaluate(element => {
      const viewport = window.visualViewport!
      const bounds = element.getBoundingClientRect()
      return !!element.closest('.floating-map-controls') &&
        Math.abs((viewport.offsetTop + viewport.height - bounds.bottom) * viewport.scale - 12) < 2 &&
        bounds.left >= viewport.offsetLeft && bounds.right <= viewport.offsetLeft + viewport.width &&
        [...element.querySelectorAll('button')].every(button => {
          const rect = button.getBoundingClientRect()
          return rect.width * viewport.scale >= 43.9 && rect.height * viewport.scale >= 43.9
        })
    })).toBe(true)
    await expect(page.locator('.floating-map-topbar .floating-replay-controls')).toHaveCount(0)
    await expect.poll(() => page.locator('.floating-map-topbar').evaluate(bar => {
      const viewport = window.visualViewport!
      const rect = bar.getBoundingClientRect()
      return Math.abs((rect.top - viewport.offsetTop) * viewport.scale - 12) < 2 &&
        rect.left >= viewport.offsetLeft && rect.right <= viewport.offsetLeft + viewport.width
    })).toBe(true)
  }

  for (const mode of ['same-device', 'versus-ai', 'by-mail'] as const) {
    test(`${mode} floats the summary, analysis toggles, and arrow navigation without changing history`, async ({ page }) => {
      const history = finishedReplayHistory()
      const turns = gameReplayTurns(history)
      await restore(page, history, mode)
      await page.goto('/')
      await page.getByRole('button', { name: 'Start replay', exact: true }).click()
      const navigation = page.getByRole('group', { name: 'Floating replay controls', exact: true })
      const summary = page.getByRole('status', { name: 'Floating turn summary', exact: true })
      const controls = page.getByRole('region', { name: 'Replay controls' })
      await expect(navigation).toBeVisible()
      await expectBottomNavigation(page)
      await expect(summary).toContainText('Replay R1 M2')
      await expect(summary).toHaveText(/ D\d+$/) // Recorded Jack side, even when playing as investigators.
      await expect(navigation.getByRole('button')).toHaveCount(4)
      for (const name of ['Previous round', 'Previous turn', 'Next turn', 'Next round']) {
        const button = navigation.getByRole('button', { name, exact: true })
        await expect(button).toHaveAttribute('title', /./)
        await expect(button).toHaveText('')
        await expect(button.locator('svg path')).toHaveCount(name.includes('round') ? 2 : 1)
      }
      await expect(navigation.getByRole('button', { name: 'Previous turn', exact: true })).toBeDisabled()
      await expect(navigation.getByRole('button', { name: 'Previous round', exact: true })).toBeDisabled()
      await expect(page.getByRole('button', { name: /^(Undo|Redo|Pass|Search|Arrest|Submit|End Turn)$/ })).toHaveCount(0)
      await page.locator('.investigator-knowledge-toggle input').check()
      const analysis = page.getByRole('group', { name: 'Floating analysis controls', exact: true })
      await expect(analysis).toBeVisible()
      await analysis.getByRole('button', { name: 'sprint', exact: true }).click()
      await expect(analysis.getByRole('button', { name: 'sprint', exact: true })).toHaveCSS('background-color', 'rgb(46, 113, 69)')
      await navigation.getByRole('button', { name: 'Next turn', exact: true }).click()
      await expect(controls.getByRole('status')).toContainText('Investigators · 2/')
      await expect(summary).toHaveText(/^Replay R1 M2 C 22\d$/)
      await page.locator('.possibility-toggle input').check()
      await expect(analysis.getByRole('button', { name: 'next', exact: true })).toBeVisible()
      await expectBottomNavigation(page)
      await expect(page.getByRole('button', { name: /^(Undo|Redo|Pass|Search|Arrest|Submit|End Turn)$/ })).toHaveCount(0)
      await navigation.getByRole('button', { name: 'Next round', exact: true }).click()
      await expect(controls.getByRole('status')).toContainText('Round 2')
      await navigation.getByRole('button', { name: 'Previous round', exact: true }).click()
      await expect(controls.getByRole('status')).toContainText(`Jack · 1/${turns.length}`)
      await navigation.getByRole('button', { name: 'Next round', exact: true }).click()
      await page.reload()
      await expect(controls.getByRole('status')).toContainText('Round 2')
      await expect(summary).toContainText('Replay R2')
      await expect(analysis.getByRole('button', { name: 'sprint', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await navigation.getByRole('button', { name: 'Previous turn', exact: true }).click()
      await expect(controls.getByRole('status')).toContainText('Round 1')
      await expect(controls.getByRole('status')).toContainText('Investigators')
      await navigation.getByRole('button', { name: 'Next round', exact: true }).click()
      await navigation.getByRole('button', { name: 'Next round', exact: true }).click()
      await expect(navigation.getByRole('button', { name: 'Next round', exact: true })).toBeDisabled()
      const lastRound = turns.findIndex(turn => turn.state.round === 3)
      for (let index = lastRound; index < turns.length - 1; index++) {
        await navigation.getByRole('button', { name: 'Next turn', exact: true }).click()
      }
      await expect(navigation.getByRole('button', { name: 'Next turn', exact: true })).toBeDisabled()
      await expectBottomNavigation(page)
      expect(await page.evaluate(key => {
        const saved = JSON.parse(localStorage.getItem(key)!)
        return saved.history ?? saved.session.history
      }, key)).toEqual(history)
      await reviewScreenshot(page, { path: test.info().outputPath(`${mode}-floating-replay.png`) })
    })
  }

  test('replay navigation stays at the bottom through native zoom and pan', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Native pinch zoom uses Chromium’s touch protocol')
    await restore(page, finishedReplayHistory())
    await page.goto('/')
    await page.getByRole('button', { name: 'Start replay', exact: true }).click()
    const navigation = page.getByRole('group', { name: 'Floating replay controls', exact: true })
    const cdp = await context.newCDPSession(page)
    for (const scale of [2, 3]) {
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: scale })
      await cdp.send('Input.synthesizeScrollGesture', { x: 60, y: 100, xDistance: -70, yDistance: -150, gestureSourceType: 'touch' })
      await page.setViewportSize({ width: 320, height: 600 })
      await expect(navigation).toBeVisible()
      await expectBottomNavigation(page)
      const button = navigation.getByRole('button', { name: 'Next turn', exact: true })
      const point = await button.evaluate(element => {
        const rect = element.getBoundingClientRect()
        return { x: rect.left + rect.width / 2 - window.visualViewport!.offsetLeft,
          y: rect.top + rect.height / 2 - window.visualViewport!.offsetTop }
      })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect(page.getByRole('region', { name: 'Replay controls' }).getByRole('status')).toContainText(`${scale}/`)
      await reviewScreenshot(page, { path: test.info().outputPath(`floating-replay-${scale}x.png`) })
    }
    await cdp.detach()
  })
})

test.describe('desktop floating replay conditions', () => {
  test.use({ hasTouch: false, isMobile: false })

  test('replay uses the usual desktop floating conditions', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1600 })
    await restore(page, finishedReplayHistory())
    await page.goto('/')
    await page.getByRole('button', { name: 'Start replay', exact: true }).click()
    const navigation = page.getByRole('group', { name: 'Floating replay controls', exact: true })
    await expect(navigation).toHaveCount(0)
    await page.setViewportSize({ width: 974, height: 600 })
    await page.locator('.board-frame').evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
    await expect(navigation).toBeVisible()
    await page.setViewportSize({ width: 1440, height: 1600 })
    await expect(navigation).toHaveCount(0)
  })
})
