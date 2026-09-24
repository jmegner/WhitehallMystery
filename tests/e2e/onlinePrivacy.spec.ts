import { expect, test, type Page } from '@playwright/test'
import { gameReducer, legalJackDestinations } from '../../src/game/gameEngine'
import type { HistoryCommand } from '../../src/game/history'
import type { OnlineServerMessage, OnlineSnapshot } from '../../src/game/onlineProtocol'
import type { GameAction } from '../../src/game/types'
import { observeInvitationClipboard } from './invitationClipboard'

declare global {
  interface Window {
    privacyProbe: { socket: WebSocket | null; snapshot: OnlineSnapshot | null; errors: string[] }
  }
}

async function observe(page: Page) {
  await observeInvitationClipboard(page)
  await page.addInitScript(() => {
    window.privacyProbe = { socket: null, snapshot: null, errors: [] }
    class ObservedWebSocket extends WebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        if (new URL(url).hostname !== '127.0.0.1') throw new Error('Privacy QA must use the local Worker.')
        super(url, protocols)
        window.privacyProbe.socket = this
        this.addEventListener('message', event => {
          const message = JSON.parse(String(event.data)) as OnlineServerMessage
          if (message.type === 'snapshot') window.privacyProbe.snapshot = message.snapshot
          if (message.type === 'error') window.privacyProbe.errors.push(message.code)
        })
      }
    }
    window.WebSocket = ObservedWebSocket
  })
}

const snapshot = (page: Page) => page.evaluate(() => window.privacyProbe.snapshot!)
async function settled(page: Page, revision: number) {
  // Wait for the app's replay/hash verification and persistence, not merely
  // receipt of the raw WebSocket frame; then let React commit its display.
  await expect.poll(() => page.evaluate(() => {
    const saved = localStorage.getItem('whitehall-mystery.saved-game.v1.' + localStorage.getItem('whitehall-mystery.active-game.v1'))
    return saved ? JSON.parse(saved).revision : null
  })).toBe(revision)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
  expect(await page.evaluate(() => window.privacyProbe.errors)).toEqual([])
}

// Send real, authenticated, legal command batches for fixture setup. This avoids
// burning the local anti-abuse command budget just to reach the second turn.
async function sendActions(page: Page, actions: GameAction[]) {
  const revision = await page.evaluate(commands => {
    const probe = window.privacyProbe
    const before = probe.snapshot!
    probe.socket!.send(JSON.stringify({ type: 'command', protocolVersion: 1, requestId: crypto.randomUUID(),
      expectedRevision: before.revision, expectedHistoryHash: before.historyHash, commands }))
    return before.revision + 1
  }, actions.map(action => ({ type: 'apply', action } satisfies HistoryCommand)))
  await settled(page, revision)
}

async function secondJackTurn(jack: Page, investigators: Page) {
  await observe(jack)
  await observe(investigators)
  await jack.goto('/')
  await jack.getByRole('button', { name: 'New game', exact: true }).click()
  await jack.getByRole('button', { name: 'Online', exact: true }).click()
  await jack.getByRole('button', { name: 'Start new game as Jack', exact: true }).click()
  await investigators.goto(await jack.getByLabel('Online investigator invitation').inputValue())
  await settled(jack, 0)
  await settled(investigators, 0)
  await sendActions(jack, [
    ...[33, 46, 147, 159].map(circleId => ({ type: 'toggleDiscovery' as const, circleId })), { type: 'confirmDiscoveries' },
  ])
  await settled(investigators, 1)
  await sendActions(investigators, [
    ...['FP', 'HP', 'HZ'].map(crossingId => ({ type: 'placeInvestigator' as const, crossingId })), { type: 'continueHandoff' },
  ])
  await settled(jack, 2)
  const chooseStart = { type: 'chooseJackStart' as const, circleId: 33 }
  const circleId = legalJackDestinations(gameReducer((await snapshot(jack)).history.state, chooseStart))[0]!
  await sendActions(jack, [chooseStart, { type: 'selectJackDestination', circleId }, { type: 'confirmJackMove' }])
  await settled(investigators, 3)
  await sendActions(investigators, [
    ...['FP', 'HP', 'HZ'].map(crossingId => ({ type: 'moveInvestigator' as const, crossingId })),
    ...Array.from({ length: 3 }, () => ({ type: 'passInspectorAction' as const })), { type: 'continueHandoff' },
  ])
  await settled(jack, 4)
  await expect(jack.getByRole('heading', { name: 'Jack: Escape in the Night' })).toBeVisible()
  await investigators.getByLabel('maybes', { exact: true }).check()
}

const privateMarkers = '.selected-circle, .private-route, .private-route-summary, .private-discovery-marker, .jack-marker, .past-path-line, .track-location'
const renderedApp = (page: Page) => page.locator('.app-shell').evaluate(element => {
  const copy = element.cloneNode(true) as HTMLElement
  const inputs = element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
  copy.querySelectorAll('input[type="checkbox"]').forEach((input, index) => {
    // React's initial checked attribute can differ after refresh, even though
    // the live checkbox property (what the player sees) is identical.
    input.toggleAttribute('checked', inputs[index]!.checked)
  })
  return copy.innerHTML.replaceAll('><', '>\n<')
})

test('online privacy: draft Street and Coach choices never change the investigator display, including undo, redo and refresh', async ({ page: jack, browser }) => {
  const context = await browser.newContext()
  const investigators = await context.newPage()
  try {
    await secondJackTurn(jack, investigators)
    await expect(investigators.locator(privateMarkers)).toHaveCount(0)
    const before = await renderedApp(investigators)
    const unchanged = async () => {
      await settled(investigators, (await snapshot(jack)).revision)
      await expect(investigators.locator(privateMarkers)).toHaveCount(0)
      expect(await renderedApp(investigators)).toBe(before)
    }
    await jack.getByLabel('Legal Jack destinations').getByRole('button').first().click()
    await expect(jack.locator('.selected-circle')).toHaveCount(1)
    await unchanged()
    await jack.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(jack.locator('.selected-circle')).toHaveCount(0)
    await unchanged()
    await jack.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect(jack.locator('.selected-circle')).toHaveCount(1)
    await unchanged()
    await jack.getByRole('button', { name: 'Coach (2)', exact: true }).click()
    await expect(jack.locator('.selected-circle')).toHaveCount(0)
    await unchanged()
    for (let count = 1; count <= 2; count++) {
      await jack.getByLabel('Legal Jack destinations').getByRole('button').first().click()
      await expect(jack.locator('.selected-circle')).toHaveCount(count)
      await unchanged()
    }
    expect((await snapshot(investigators)).history.state.jackMoveSelection.path).toHaveLength(2) // Full trusted history still arrives.
    await investigators.reload()
    await unchanged()
    await jack.getByRole('button', { name: 'Record move privately' }).click()
    await expect(investigators.getByRole('heading', { name: 'Yellow Investigator: Move' })).toBeVisible()
    await expect(investigators.locator('.special-badge.coach')).toHaveCount(2)
    await expect(investigators.locator(privateMarkers)).toHaveCount(0)
    await expect(investigators.locator('.public-log')).not.toContainText('via Coach to')
  } finally { await context.close() }
})

test('online privacy: a new investigator turn starts with plain maybes until the pointer moves again', async ({ page: jack, browser }) => {
  const context = await browser.newContext()
  const investigators = await context.newPage()
  try {
    await secondJackTurn(jack, investigators)
    const target = investigators.locator('.inference-hover-target').first()
    await target.hover()
    await expect(investigators.locator('.possible-outcome-marker').first()).toBeVisible()
    // Leave the investigator pointer stationary on the board while Jack acts.
    await jack.getByLabel('Legal Jack destinations').getByRole('button').first().click()
    await expect(jack.getByRole('button', { name: 'Record move privately' })).toBeEnabled()
    await settled(investigators, (await snapshot(jack)).revision)
    await expect(investigators.locator('.possible-outcome-marker').first()).toBeVisible() // Private drafts don't reset/leak through hover state.
    await jack.getByRole('button', { name: 'Record move privately' }).click()
    await expect(investigators.getByRole('heading', { name: 'Yellow Investigator: Move' })).toBeVisible()
    await expect(investigators.locator('.possible-outcome-marker')).toHaveCount(0)
    await expect(investigators.locator('.possible-marker').first()).toBeVisible()
    // Entry/layout events without mouse movement must not enable a preview.
    await target.dispatchEvent('mouseover')
    await expect(investigators.locator('.possible-outcome-marker')).toHaveCount(0)
    await target.hover()
    await expect(investigators.locator('.possible-outcome-marker').first()).toBeVisible()
    // Public evidence changes also clear a preview during the same turn.
    await sendActions(investigators, [{ type: 'moveInvestigator', crossingId: 'FP' }])
    await expect(investigators.locator('.possible-outcome-marker')).toHaveCount(0)
    await target.hover()
    await expect(investigators.locator('.possible-outcome-marker').first()).toBeVisible()
    await investigators.mouse.move(0, 0)
    await expect(investigators.locator('.possible-outcome-marker')).toHaveCount(0)
    await investigators.screenshot({ path: 'test-results/online-public-maybes.png', fullPage: true })
  } finally { await context.close() }
})
