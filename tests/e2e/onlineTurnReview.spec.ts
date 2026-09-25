import { expect, test, type Page } from '@playwright/test'
import { createInitialGame, deploymentChoices, legalNormalDestinations } from '../../src/game/gameEngine'
import { createGameHistory, currentHistoryState, gameHistoryReducer, type GameHistory } from '../../src/game/history'
import { encodeMail, normalizeMailHistory } from '../../src/game/byMail'
import type { GameAction } from '../../src/game/types'
import type { OnlineSnapshot, OnlineServerMessage } from '../../src/game/onlineProtocol'
import { answerUndo } from './undoWarning'

declare global { interface Window { reviewSnapshot: OnlineSnapshot | null } }

async function watchSnapshots(page: Page) {
  await page.addInitScript(() => {
    window.reviewSnapshot = null
    class ObservedWebSocket extends WebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        if (new URL(url).hostname !== '127.0.0.1') throw new Error('QA cannot connect to production.')
        super(url, protocols)
        this.addEventListener('message', event => {
          const message = JSON.parse(String(event.data)) as OnlineServerMessage
          if (message.type === 'snapshot') window.reviewSnapshot = message.snapshot
        })
      }
    }
    window.WebSocket = ObservedWebSocket
  })
}
const snapshot = (page: Page) => page.evaluate(() => window.reviewSnapshot!)

async function moveInvestigators(page: Page) {
  for (const color of ['yellow', 'blue', 'red']) {
    await page.getByLabel(`Legal ${color} Investigator destinations`).getByRole('button').first().click()
  }
}

// Isolated local Worker invocation: these real two-device tests don't consume
// production quotas or share the other suites' simulated per-IP creation quota.
test('online turn review: moving Red then auto-passing all three needs confirmation, preserved by refresh and redo', async ({ page: jack, browser }) => {
  const context = await browser.newContext()
  const investigators = await context.newPage()
  try {
    await watchSnapshots(jack)
    await watchSnapshots(investigators)
    await jack.goto('/')
    await jack.getByRole('button', { name: 'New game', exact: true }).click()
    await jack.getByRole('button', { name: 'Online', exact: true }).click()
    await jack.getByRole('button', { name: 'Start new game as Jack' }).click()
    await investigators.goto(await jack.getByLabel('Online investigator invitation').inputValue())
    for (const circleId of [33, 46, 147, 159]) await jack.getByLabel(`Location ${circleId}, selectable`, { exact: true }).click()
    await jack.getByRole('button', { name: 'Lock in four locations' }).click()
    for (let i = 0; i < 3; i++) await investigators.getByLabel('Available deployment crossings').getByRole('button').first().click()
    await expect(investigators.getByRole('button', { name: 'Confirm deployment' })).toBeVisible()
    await expect(jack.getByRole('heading', { name: 'Waiting for your partner' })).toBeVisible()
    await expect(jack.locator('.investigator-piece')).toHaveCount(3)
    // Clicking the board cannot accidentally confirm the last placement.
    await investigators.getByLabel('Whitehall game board').click({ position: { x: 10, y: 10 } })
    await expect(investigators.getByRole('button', { name: 'Confirm deployment' })).toBeVisible()
    for (const name of ['Rand', 'Rand Side']) await expect(investigators.getByRole('button', { name, exact: true })).toBeEnabled()
    const deploymentReview = await snapshot(investigators)
    await investigators.getByRole('button', { name: 'Rand', exact: true }).click()
    await expect(jack.getByRole('heading', { name: 'Jack: Choose the Starting Location' })).toBeVisible()
    await expect.poll(() => snapshot(investigators)).toEqual(await snapshot(jack))
    expect((await snapshot(investigators)).history.actions.slice(deploymentReview.history.cursor)).toEqual([
      { type: 'continueHandoff' }, { type: 'continueHandoff' },
    ])
    for (const name of ['Rand', 'Rand Side']) await expect(investigators.getByRole('button', { name, exact: true })).toBeDisabled()
    await expect(investigators.locator('.board-frame')).toHaveCSS('border-top-color', 'rgb(0, 0, 0)')
    await expect(investigators.locator('.active-investigator-ring, .edge-guide-line')).toHaveCount(0)
    await investigators.locator('.investigator-piece').first().hover({ force: true })
    await expect(investigators.locator('.investigator-hover-turn-count, .investigator-route-turn-count, .investigator-route-preview-line')).toHaveCount(0)
    await jack.getByLabel('Secret Discovery Locations').getByRole('button').first().click()
    await jack.getByLabel('Legal Jack destinations').getByRole('button').first().click()
    await jack.getByRole('button', { name: 'Record move privately' }).click()
    await expect(investigators.locator('.active-investigator-ring')).toHaveCount(1)
    await expect(investigators.locator('.investigator-piece').first()).toHaveCSS('animation-name', 'investigator-color-glow')
    await investigators.getByLabel('inv auto', { exact: true }).check()
    await moveInvestigators(investigators)
    await expect(investigators.getByRole('button', { name: 'End investigator turn' })).toBeVisible()
    await expect(jack.getByRole('heading', { name: 'Waiting for your partner' })).toBeVisible()
    await expect.poll(() => snapshot(investigators)).toEqual(await snapshot(jack))
    const before = await snapshot(investigators)
    expect(before.history.state.stage).toBe('investigatorTurnResult')
    expect(before.history.actions.slice(-3)).toEqual([
      { type: 'passInspectorAction' }, { type: 'passInspectorAction' }, { type: 'passInspectorAction', review: true },
    ])
    await investigators.reload()
    await expect(investigators.getByLabel('inv auto', { exact: true })).toBeChecked()
    await expect(investigators.getByRole('button', { name: 'End investigator turn' })).toBeVisible()
    expect((await snapshot(investigators)).historyHash).toBe(before.historyHash)
    // Still our turn: no opponent approval is needed, and redo must preserve
    // the confirmation instead of silently handing play to Jack.
    await investigators.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(investigators.getByRole('heading', { name: 'Red Investigator: Clues and Suspicion' })).toBeVisible()
    await expect(jack.getByRole('button', { name: 'Approve undo' })).toHaveCount(0)
    await expect(investigators.getByRole('button', { name: 'Redo Side', exact: true })).toBeEnabled()
    await investigators.getByRole('button', { name: 'Redo Side', exact: true }).click()
    await expect(investigators.getByRole('button', { name: 'End investigator turn' })).toBeVisible()
    expect((await snapshot(investigators)).historyHash).toBe(before.historyHash)
    for (const name of ['Rand', 'Rand Side']) await expect(investigators.getByRole('button', { name, exact: true })).toBeEnabled()
    await investigators.getByRole('button', { name: 'End investigator turn' }).click()
    await expect(jack.getByRole('heading', { name: 'Jack: Escape in the Night' })).toBeVisible()
    await expect.poll(() => snapshot(investigators)).toEqual(await snapshot(jack))
    expect((await snapshot(investigators)).history.actions.slice(before.history.cursor)).toEqual([
      { type: 'continueHandoff' }, { type: 'continueHandoff' },
    ])
    for (const name of ['Rand', 'Rand Side']) await expect(investigators.getByRole('button', { name, exact: true })).toBeDisabled()
    await expect(investigators.locator('.board-frame')).toHaveCSS('border-top-color', 'rgb(0, 0, 0)')
    await expect(investigators.locator('.active-investigator-ring, .edge-guide-line, .active-investigator-edge-arrows, .jack-location-edge-arrows')).toHaveCount(0)
    for (const piece of await investigators.locator('.investigator-piece').all()) {
      await expect(piece).toHaveCSS('animation-name', 'none')
      await expect(piece).toHaveCSS('filter', 'none')
    }
    await expect(investigators.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
    await expect(investigators.getByRole('button', { name: 'Undo Side', exact: true })).toBeDisabled()
    await investigators.screenshot({ path: 'test-results/online-waiting-for-jack.png', fullPage: true })
  } finally { await context.close() }
})

test('online turn review: Rand Side completes turns and pending reviews without another confirmation', async ({ page: jack, browser }) => {
  const context = await browser.newContext()
  const investigators = await context.newPage()
  try {
    await watchSnapshots(jack)
    await watchSnapshots(investigators)
    // Choose legal random moves and passes, avoiding accidental arrests that
    // would end the game before all handoff paths have been exercised.
    await investigators.addInitScript(() => { Math.random = () => 0.95 })
    await jack.goto('/')
    await jack.getByRole('button', { name: 'New game', exact: true }).click()
    await jack.getByRole('button', { name: 'Online', exact: true }).click()
    await jack.getByRole('button', { name: 'Start new game as Jack' }).click()
    await investigators.goto(await jack.getByLabel('Online investigator invitation').inputValue())
    for (const circleId of [33, 46, 147, 159]) await jack.getByLabel(`Location ${circleId}, selectable`, { exact: true }).click()
    await jack.getByRole('button', { name: 'Rand Side', exact: true }).click()
    await expect(investigators.getByRole('heading', { name: 'Deploy the Yellow Investigator' })).toBeVisible()

    const finishReview = async (reviewLabel: string, nextStage: string) => {
      await expect(investigators.getByRole('button', { name: reviewLabel, exact: true })).toBeVisible()
      for (const name of ['Rand', 'Rand Side']) await expect(investigators.getByRole('button', { name, exact: true })).toBeEnabled()
      const before = await snapshot(investigators)
      await investigators.getByRole('button', { name: 'Rand Side', exact: true }).click()
      await expect.poll(async () => (await snapshot(jack)).history.state.stage).toBe(nextStage)
      await expect.poll(() => snapshot(investigators)).toEqual(await snapshot(jack))
      const after = await snapshot(investigators)
      expect(after.revision).toBe(before.revision + 1)
      expect(after.history.actions.slice(before.history.cursor)).toEqual([
        { type: 'continueHandoff' }, { type: 'continueHandoff' },
      ]) // Confirm results and normalize handoff; no Jack actions.
      await expect(investigators.getByRole('button', { name: reviewLabel, exact: true })).toHaveCount(0)
      for (const name of ['Rand', 'Rand Side']) await expect(investigators.getByRole('button', { name, exact: true })).toBeDisabled()
    }
    for (let i = 0; i < 3; i++) await investigators.getByLabel('Available deployment crossings').getByRole('button').first().click()
    await finishReview('Confirm deployment', 'jackChooseStart')
    await jack.getByLabel('Secret Discovery Locations').getByRole('button').first().click()

    const finishJackMove = async () => {
      await jack.getByLabel('Legal Jack destinations').getByRole('button').first().click()
      await jack.getByRole('button', { name: 'Rand Side', exact: true }).click()
      await expect(investigators.getByRole('heading', { name: 'Yellow Investigator: Move' })).toBeVisible()
      await expect(jack.getByRole('button', { name: 'Record move privately' })).toHaveCount(0)
    }
    await finishJackMove()
    await investigators.getByLabel('inv auto', { exact: true }).uncheck()
    const before = await snapshot(investigators)
    await investigators.getByRole('button', { name: 'Rand Side', exact: true }).click()
    await expect(jack.getByRole('heading', { name: 'Jack: Escape in the Night' })).toBeVisible()
    await expect.poll(() => snapshot(investigators)).toEqual(await snapshot(jack))
    const completed = await snapshot(investigators)
    expect(completed.revision).toBe(before.revision + 1)
    expect(completed.history.actions.slice(before.history.cursor).map(action => action.type)).toEqual([
      'moveInvestigator', 'moveInvestigator', 'moveInvestigator',
      'passInspectorAction', 'passInspectorAction', 'passInspectorAction',
      'continueHandoff', 'continueHandoff',
    ])
    await expect(investigators.getByRole('button', { name: 'End investigator turn' })).toHaveCount(0)
    await investigators.reload()
    await expect(investigators.getByRole('heading', { name: 'Waiting for your partner' })).toBeVisible()
    expect((await snapshot(investigators)).historyHash).toBe(completed.historyHash)

    await finishJackMove()
    // Auto actions use one command batch, keeping this two-turn scenario below
    // the local per-IP burst limit without weakening the production limiter.
    await investigators.getByLabel('inv auto', { exact: true }).check()
    await moveInvestigators(investigators)
    await finishReview('End investigator turn', 'jackMove')
    await expect(jack.getByRole('heading', { name: 'Jack: Escape in the Night' })).toBeVisible()
    await expect.poll(() => snapshot(investigators)).toEqual(await snapshot(jack))
    await expect(investigators.getByRole('button', { name: 'End investigator turn' })).toHaveCount(0)
  } finally { await context.close() }
})

// A legitimate replayed fixture lets the Mail UI exercise warnings without a
// backend, including the separate sharing-screen Undo handlers.
function mailMove() {
  let history = createGameHistory(createInitialGame())
  const apply = (action: GameAction) => { history = normalizeMailHistory(gameHistoryReducer(history, { type: 'apply', action })) }
  for (const circleId of [33, 46, 147, 159]) apply({ type: 'toggleDiscovery', circleId })
  apply({ type: 'confirmDiscoveries' })
  for (let i = 0; i < 3; i++) apply({ type: 'placeInvestigator', crossingId: deploymentChoices(currentHistoryState(history))[0]! })
  apply({ type: 'chooseJackStart', circleId: 33 })
  apply({ type: 'selectJackDestination', circleId: legalNormalDestinations(currentHistoryState(history))[0]! })
  apply({ type: 'confirmJackMove' })
  return { history, text: encodeMail(1234567890, 'investigators', history) }
}

test('online turn review: Mail warns before undoing searches and arrests, including Undo Side from sharing', async ({ page }) => {
  const { text } = mailMove()
  await page.goto(`/#mail=${text}`)
  await page.getByRole('button', { name: 'Join existing game', exact: true }).click()
  await moveInvestigators(page)
  const readHistory = () => page.evaluate(() => (JSON.parse(localStorage.getItem('whitehall-mystery.saved-game.v1.' + localStorage.getItem('whitehall-mystery.active-game.v1'))!).session.history as GameHistory))
  const before = await readHistory()
  await page.getByLabel('Locations adjacent to the yellow Investigator').getByRole('button').first().click()
  const searched = await readHistory()
  await answerUndo(page, 'Undo', false)
  expect(await readHistory()).toEqual(searched)
  await answerUndo(page, 'Undo', true)
  expect((await readHistory()).cursor).toBe(before.cursor)
  await page.getByRole('button', { name: 'Execute arrest', exact: true }).click()
  await page.getByLabel('Locations adjacent to the yellow Investigator').getByRole('button').first().click()
  const arrested = await readHistory()
  await answerUndo(page, 'Undo', false)
  expect(await readHistory()).toEqual(arrested)
  await answerUndo(page, 'Undo', true)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  for (const color of ['Blue', 'Red']) {
    await expect(page.getByRole('heading', { name: `${color} Investigator: Clues and Suspicion` })).toBeVisible()
    await page.getByRole('button', { name: 'Pass', exact: true }).click()
  }
  await expect(page.getByRole('heading', { name: 'Waiting for Jack' })).toBeVisible()
  const finished = await readHistory()
  await answerUndo(page, 'Undo side', false)
  expect(await readHistory()).toEqual(finished)
  await answerUndo(page, 'Undo side', true)
  await expect(page.getByRole('heading', { name: 'Yellow Investigator: Move' })).toBeVisible()
})

test('online turn review: investigators can cancel warned undos and request a warned undo using the normal button', async ({ page: jack, browser }) => {
  const context = await browser.newContext()
  const investigators = await context.newPage()
  try {
    await watchSnapshots(jack)
    await watchSnapshots(investigators)
    await jack.goto('/')
    await jack.getByRole('button', { name: 'New game', exact: true }).click()
    await jack.getByRole('button', { name: 'Online', exact: true }).click()
    await jack.getByRole('button', { name: 'Start new game as Jack' }).click()
    await investigators.goto(await jack.getByLabel('Online investigator invitation').inputValue())
    await jack.getByRole('button', { name: 'Rand Side', exact: true }).click()
    await expect(investigators.getByRole('heading', { name: 'Deploy the Yellow Investigator' })).toBeVisible()
    await investigators.getByRole('button', { name: 'Rand Side', exact: true }).click()
    await expect(jack.getByRole('heading', { name: 'Jack: Choose the Starting Location' })).toBeVisible()
    await jack.getByRole('button', { name: 'Rand Side', exact: true }).click()
    await moveInvestigators(investigators)
    await investigators.getByLabel('Locations adjacent to the yellow Investigator').getByRole('button').first().click()
    await expect(investigators.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
    const searched = await snapshot(investigators)
    await answerUndo(investigators, 'Undo', false)
    expect(await snapshot(investigators)).toEqual(searched)
    await answerUndo(investigators, 'Undo', true)
    for (const color of ['Yellow', 'Blue']) {
      await expect(investigators.getByRole('heading', { name: `${color} Investigator: Clues and Suspicion` })).toBeVisible()
      await investigators.getByRole('button', { name: 'Pass', exact: true }).click()
    }
    await investigators.getByRole('button', { name: 'Execute arrest', exact: true }).click()
    await expect(investigators.getByRole('button', { name: 'Execute arrest', exact: true })).toHaveClass('danger-button')
    const jackLocation = (await snapshot(investigators)).history.state.currentJack
    const targets = investigators.getByLabel('Locations adjacent to the red Investigator').getByRole('button')
    const miss = (await targets.allTextContents()).find(id => Number(id) !== jackLocation)!
    await targets.filter({ hasText: new RegExp(`^${miss}$`) }).click()
    await expect(jack.getByRole('heading', { name: 'Jack: Escape in the Night' })).toBeVisible()
    await expect(investigators.getByRole('button', { name: 'End investigator turn' })).toHaveCount(0)
    const before = await snapshot(jack)
    await answerUndo(investigators, 'Request undo', false)
    await answerUndo(investigators, 'Undo', false)
    expect(await snapshot(investigators)).toEqual(before)
    await answerUndo(investigators, 'Undo', true)
    await expect(investigators.getByLabel('Online undo')).toContainText('Undo requested.')
    await expect(investigators.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
    await jack.getByRole('button', { name: 'Approve undo' }).click()
    await expect(investigators.getByLabel('Online undo')).toContainText('Your undo request was approved.')
    const after = await snapshot(investigators)
    expect(after.history.state.stage).toBe('investigatorAction')
    expect(after.history.actions).toEqual(before.history.actions)
    expect(after.history.cursor).toBeLessThan(before.history.cursor)
  } finally { await context.close() }
})
