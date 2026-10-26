import { expect, test, type Page } from '@playwright/test'
import { createInitialGame } from '../../src/game/gameEngine'
import { createGameHistory, currentHistoryState, type GameHistory } from '../../src/game/history'
import type { GameState } from '../../src/game/types'
import { reviewScreenshot } from './reviewScreenshot'

const id = 'zoomed-handoff'
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Pass the device to Jack', exact: true })
async function history(page: Page): Promise<GameHistory> {
  return page.evaluate(id => JSON.parse(localStorage.getItem(`whitehall-mystery.saved-game.v1.${id}`)!).history, id)
}
async function expectViewportHandoff(page: Page) {
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).getByRole('button')).toHaveCount(2)
  await expect.poll(() => dialog(page).evaluate(element => {
    const viewport = window.visualViewport!
    const bounds = element.getBoundingClientRect()
    return Math.abs((bounds.left - viewport.offsetLeft) * viewport.scale) < 2 &&
      Math.abs((bounds.top - viewport.offsetTop) * viewport.scale) < 2 &&
      Math.abs((bounds.width - viewport.width) * viewport.scale) < 2 &&
      Math.abs((bounds.height - viewport.height) * viewport.scale) < 2 &&
      [...element.querySelectorAll('button')].every(button => {
        const rect = button.getBoundingClientRect()
        return rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top &&
          rect.bottom <= bounds.bottom && rect.height * viewport.scale >= 47 && button.scrollWidth <= button.clientWidth
      })
  })).toBe(true)
}

for (const stage of ['investigatorSetupResult', 'investigatorTurnResult'] as const) {
  test(`zoomed mobile handoff after ${stage} fills the viewport and supports undo, refresh, and reveal`, async ({ page, context }) => {
    const state: GameState = { ...createInitialGame(), stage,
      discoveryLocations: [33, 46, 147, 159], investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' },
      ...(stage === 'investigatorTurnResult' ? { currentJack: 85, moveSlot: 1, reachedDiscoveries: [33], roundTrail: [33, 85],
        publicRound: { start: 33, observations: [], moves: [{ type: 'normal', startSlot: 1, endSlot: 1,
          investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' } }] } } : {}),
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(({ initialHistory, id }) => {
      if (localStorage.getItem(`whitehall-mystery.saved-game.v1.${id}`)) return
      localStorage.setItem('whitehall-mystery.saved-games-migrated.v1', 'true')
      localStorage.setItem('whitehall-mystery.active-game.v1', id)
      localStorage.setItem(`whitehall-mystery.saved-game.v1.${id}`, JSON.stringify({ id, mode: 'same-device',
        history: initialHistory, startedAt: Date.now(), savedAt: Date.now() }))
    }, { initialHistory: createGameHistory(state), id })
    await page.goto('/')
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 })
    await page.locator('.board-frame').evaluate(element => element.scrollIntoView({ block: 'center' }))
    await page.getByRole('img', { name: 'Whitehall game board' }).dispatchEvent('click')
    await expectViewportHandoff(page)
    await expect(page.locator('.game-board, .jack-marker, .private-discovery-marker')).toHaveCount(0)
    const handoff = await history(page)
    await dialog(page).getByRole('heading').click()
    await page.keyboard.press('Escape')
    expect(await history(page)).toEqual(handoff)
    await expectViewportHandoff(page)
    await cdp.send('Input.synthesizeScrollGesture', { x: 180, y: 250, xDistance: -80, yDistance: -80, gestureSourceType: 'touch' })
    await expectViewportHandoff(page)
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 3 })
    await expectViewportHandoff(page)
    await page.setViewportSize({ width: 844, height: 390 })
    await expectViewportHandoff(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await expectViewportHandoff(page)
    await page.reload()
    await expectViewportHandoff(page)
    expect(await history(page)).toEqual(handoff)
    await reviewScreenshot(page, { path: test.info().outputPath(`${stage}-compact-handoff.png`) })
    await dialog(page).getByRole('button', { name: 'Undo', exact: true }).click()
    expect(currentHistoryState(await history(page))).toEqual(state)
    await expect(dialog(page)).toHaveCount(0)
    await page.getByRole('img', { name: 'Whitehall game board' }).dispatchEvent('click')
    await expectViewportHandoff(page)
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
    await expect(dialog(page)).toHaveCount(0)
    await expect(page.locator('.handoff-card')).toBeVisible()
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 })
    await expectViewportHandoff(page)
    await dialog(page).getByRole('button', { name: 'I am Jack, reveal my view', exact: true }).click()
    await expect(dialog(page)).toHaveCount(0)
    expect(currentHistoryState(await history(page)).stage).toBe(stage === 'investigatorSetupResult' ? 'jackChooseStart' : 'jackMove')
    await expect(page.locator('.game-board')).toBeVisible()
    await cdp.detach()
  })
}
