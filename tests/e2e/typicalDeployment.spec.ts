import { expect, test, type Page } from '@playwright/test'
import { createInitialGame } from '../../src/game/gameEngine'
import { createGameHistory, currentHistoryState, type GameHistory } from '../../src/game/history'
import { decodeMail } from '../../src/game/byMail'
import { INVESTIGATOR_ORDER, type GameState } from '../../src/game/types'
import { reviewScreenshot } from './reviewScreenshot'

const positions = { yellow: 'HP', blue: 'JD', red: 'JH' }
const title = 'Place all three investigators at the AI’s usual starting crossings'
const typical = (page: Page) => page.locator('.control-panel').getByRole('button', { name: 'Typical', exact: true })
const floating = (page: Page) => page.getByRole('group', { name: 'Floating map controls', exact: true })
const historyControls = (page: Page) => page.getByLabel('Action history controls', { exact: true })

async function saved(page: Page): Promise<GameHistory> {
  return page.evaluate(() => JSON.parse(localStorage.getItem(`whitehall-mystery.saved-game.v1.${localStorage.getItem('whitehall-mystery.active-game.v1')}`)!).history)
}
async function restore(page: Page, mode: 'same-device' | 'versus-ai' = 'same-device') {
  const state: GameState = { ...createInitialGame(), stage: 'investigatorSetup', discoveryLocations: [33, 46, 147, 159],
    notice: 'Place the yellow Investigator on a highlighted starting crossing.' }
  await page.addInitScript(({ mode, history }) => {
    const id = 'typical-deployment'
    if (localStorage.getItem(`whitehall-mystery.saved-game.v1.${id}`)) return
    localStorage.setItem('whitehall-mystery.saved-games-migrated.v1', 'true')
    localStorage.setItem('whitehall-mystery.active-game.v1', id)
    localStorage.setItem('whitehall-mystery.ai-wait-end', 'true')
    localStorage.setItem(`whitehall-mystery.saved-game.v1.${id}`, JSON.stringify({ id, mode, role: 'investigators', history,
      startedAt: Date.now(), savedAt: Date.now() }))
  }, { mode, history: createGameHistory(state) })
  await page.goto('/')
}
async function expectPieces(page: Page) {
  await expect(page.locator('.investigator-piece')).toHaveCount(3)
  for (const color of INVESTIGATOR_ORDER) {
    await expect(page.locator(`.investigator-piece.${color}`)).toHaveAttribute('data-board-hover', `investigator:${color}:${positions[color]}`)
  }
}
async function startJack(page: Page, mode: 'Online' | 'By Mail') {
  await page.goto('/')
  await page.getByRole('button', { name: 'New game', exact: true }).click()
  await page.getByRole('button', { name: mode, exact: true }).click()
  await page.getByRole('button', { name: 'Start new game as Jack' }).click()
  const invitation = mode === 'Online' ? await page.getByLabel('Online investigator invitation').inputValue() : ''
  for (const location of [33, 46, 147, 159]) await page.getByLabel(`Location ${location}, selectable`, { exact: true }).click()
  await page.getByRole('button', { name: 'Lock in four locations' }).click()
  return invitation || await page.getByLabel('Outgoing game text').inputValue()
}

test('Typical is only offered before deployment and uses ordinary placements that survive undo, redo and refresh', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await restore(page)
  await expect(typical(page)).toBeVisible()
  await expect(typical(page)).toHaveAttribute('title', title)
  await page.getByLabel('Available deployment crossings').getByRole('button', { name: 'FP', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Typical', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Typical', exact: true })).toHaveCount(0)
  await historyControls(page).getByRole('button', { name: /^Undo!?$/ }).click()
  await expect(typical(page)).toBeVisible()
  await typical(page).click()
  const placed = await saved(page)
  expect(currentHistoryState(placed)).toMatchObject({ stage: 'handoffJackStart', investigatorPositions: positions, currentJack: null })
  expect(placed.entries.slice(-3).map(entry => entry.action)).toEqual(INVESTIGATOR_ORDER.map(color => ({ type: 'placeInvestigator', crossingId: positions[color] })))
  await expect(page.getByRole('button', { name: 'Typical', exact: true })).toHaveCount(0)
  for (let remaining = 2; remaining >= 0; remaining--) {
    await historyControls(page).getByRole('button', { name: /^Undo!?$/ }).click()
    expect(Object.keys(currentHistoryState(await saved(page)).investigatorPositions)).toHaveLength(remaining)
    await expect(typical(page)).toHaveCount(remaining === 0 ? 1 : 0)
  }
  for (let placed = 0; placed < 3; placed++) await historyControls(page).getByRole('button', { name: 'Redo', exact: true }).click()
  await page.reload()
  expect(currentHistoryState(await saved(page))).toMatchObject({ stage: 'handoffJackStart', investigatorPositions: positions })
  await expect(page.locator('.jack-marker, .private-discovery-marker')).toHaveCount(0)
})

test.describe('zoomed Typical deployment', () => {
  test.use({ viewport: { width: 390, height: 600 }, isMobile: true, hasTouch: true })
  for (const scale of [2, 3]) {
    test(`Typical deploys all investigators with one touch at ${scale}x zoom`, async ({ page, context }) => {
      await restore(page)
      await page.evaluate(() => document.fonts.ready)
      await expect(typical(page)).toHaveCount(1)
      await expect(floating(page).getByRole('button', { name: 'Typical', exact: true })).toBeVisible()
      const cdp = await context.newCDPSession(page)
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: scale })
      const button = floating(page).getByRole('button', { name: 'Typical', exact: true })
      await expect(floating(page)).toHaveCSS('position', 'fixed')
      await expect(button).toHaveAttribute('title', title)
      await expect(floating(page).getByRole('button')).toHaveCount(1)
      await expect.poll(() => button.evaluate(element => {
        const rect = element.getBoundingClientRect()
        const viewport = window.visualViewport!
        return rect.left >= viewport.offsetLeft && rect.right <= viewport.offsetLeft + viewport.width &&
          rect.top >= viewport.offsetTop && rect.bottom <= viewport.offsetTop + viewport.height && rect.height * viewport.scale >= 43
      })).toBe(true)
      await reviewScreenshot(page, { path: test.info().outputPath(`typical-${scale}x.png`) })
      const point = await button.evaluate(element => {
        const rect = element.getBoundingClientRect()
        return { x: rect.left + rect.width / 2 - window.visualViewport!.offsetLeft,
          y: rect.top + rect.height / 2 - window.visualViewport!.offsetTop }
      })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
      expect(currentHistoryState(await saved(page)).investigatorPositions).toEqual({})
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect(page.getByRole('dialog', { name: 'Pass the device to Jack', exact: true })).toBeVisible()
      expect(currentHistoryState(await saved(page))).toMatchObject({ stage: 'handoffJackStart', investigatorPositions: positions, currentJack: null })
      await expect(page.locator('.jack-marker, .private-discovery-marker')).toHaveCount(0)
      await page.reload()
      expect(currentHistoryState(await saved(page)).investigatorPositions).toEqual(positions)
      await cdp.detach()
    })
  }
})

test('Typical respects WaitEnd before AI Jack can choose a start', async ({ page }) => {
  await restore(page, 'versus-ai')
  await typical(page).click()
  expect(currentHistoryState(await saved(page))).toMatchObject({ stage: 'investigatorSetupResult', investigatorPositions: positions, currentJack: null })
  await expectPieces(page)
  await expect(page.getByRole('button', { name: 'End turn', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Typical', exact: true })).toHaveCount(0)
  await page.reload()
  expect(currentHistoryState(await saved(page))).toMatchObject({ stage: 'investigatorSetupResult', investigatorPositions: positions, currentJack: null })
})

test('Typical synchronizes online deployment and keeps its confirmation step', async ({ page: jack, browser }) => {
  const context = await browser.newContext()
  const investigators = await context.newPage()
  try {
    const invitation = await startJack(jack, 'Online')
    await investigators.goto(invitation)
    await expect(typical(investigators)).toBeVisible()
    await expect(jack.getByRole('button', { name: 'Typical', exact: true })).toHaveCount(0)
    await typical(investigators).click()
    const confirm = investigators.getByRole('button', { name: 'Confirm deployment', exact: true })
    await expect(confirm).toBeVisible()
    await expectPieces(investigators)
    await expectPieces(jack)
    await expect(jack.getByRole('heading', { name: 'Waiting for your partner' })).toBeVisible()
    await expect(investigators.getByRole('button', { name: 'Typical', exact: true })).toHaveCount(0)
    await investigators.reload()
    await expect(confirm).toBeVisible()
    await confirm.click()
    await expect(jack.getByRole('heading', { name: 'Jack: Choose the Starting Location' })).toBeVisible()
  } finally { await context.close() }
})

test('Typical produces valid By Mail deployment text with the usual three crossings', async ({ page: jack, browser, baseURL }) => {
  const context = await browser.newContext()
  const investigators = await context.newPage()
  try {
    const invitation = await startJack(jack, 'By Mail')
    await investigators.goto(`${baseURL}#mail=${invitation}`)
    await investigators.getByRole('button', { name: 'Join existing game', exact: true }).click()
    await typical(investigators).click()
    await expect(investigators.getByRole('heading', { name: 'Waiting for Jack', exact: true })).toBeVisible()
    const reply = await investigators.getByLabel('Outgoing game text').inputValue()
    expect(reply).toMatch(/^02-/)
    expect(currentHistoryState(decodeMail(reply).history).investigatorPositions).toEqual(positions)
    await investigators.reload()
    await expect(investigators.getByLabel('Outgoing game text')).toHaveValue(reply)
  } finally { await context.close() }
})
