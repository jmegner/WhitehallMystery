import { expect, test } from '@playwright/test'
import type { OnlineServerMessage, OnlineSnapshot } from '../../src/game/onlineProtocol'
import type { OnlineUndoState } from '../../src/game/onlineUndo'
import { observeInvitationClipboard } from './invitationClipboard'

test.beforeEach(async ({ page }) => { await observeInvitationClipboard(page) })

declare global {
  interface Window {
    onlineProbe: {
      socket: WebSocket | null
      snapshot: OnlineSnapshot | null
      undo: OnlineUndoState | null
      snapshotCount: number
      errors: string[]
    }
    turnAlertProbe: {
      flashes: number[]
      tones: number
      permissionRequests: number
      requestedFromGesture: boolean
      notifications: Array<{ title: string; options?: NotificationOptions }>
    }
  }
}

function observeOnlineSocket() {
  window.onlineProbe = { socket: null, snapshot: null, undo: null, snapshotCount: 0, errors: [] }
  class ObservedWebSocket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      if (new URL(url).hostname !== '127.0.0.1') throw new Error('Online QA must never connect to a deployed Worker.')
      super(url, protocols)
      window.onlineProbe.socket = this
      this.addEventListener('message', event => {
        const message = JSON.parse(String(event.data)) as OnlineServerMessage
        if (message.type === 'snapshot') { window.onlineProbe.snapshot = message.snapshot; window.onlineProbe.undo = message.undo ?? null; window.onlineProbe.snapshotCount += 1 }
        if (message.type === 'error') window.onlineProbe.errors.push(message.code)
      })
    }
  }
  window.WebSocket = ObservedWebSocket
}

function observeTurnAlerts() {
  window.turnAlertProbe = { flashes: [], tones: 0, permissionRequests: 0, requestedFromGesture: false, notifications: [] }
  const animate = Element.prototype.animate
  Element.prototype.animate = function (keyframes, options) {
    if (this.classList.contains('turn-alert-flash')) {
      window.turnAlertProbe.flashes.push(Number(typeof options === 'number' ? options : options?.duration))
    }
    return animate.call(this, keyframes, options)
  }
  const createOscillator = AudioContext.prototype.createOscillator
  AudioContext.prototype.createOscillator = function () {
    const oscillator = createOscillator.call(this)
    const start = oscillator.start
    oscillator.start = (when = 0) => {
      window.turnAlertProbe.tones += 1
      start.call(oscillator, when)
    }
    return oscillator
  }
  // Exercise the browser-facing permission/show path without sending real OS toasts during tests.
  class TestNotification {
    static get permission() { return sessionStorage.getItem('test-notification-permission') ?? 'default' }
    static async requestPermission() {
      window.turnAlertProbe.permissionRequests += 1
      window.turnAlertProbe.requestedFromGesture = navigator.userActivation.isActive
      sessionStorage.setItem('test-notification-permission', 'granted')
      return 'granted'
    }
    constructor(title: string, options?: NotificationOptions) { window.turnAlertProbe.notifications.push({ title, options }) }
    close() {}
  }
  Object.defineProperty(window, 'Notification', { configurable: true, value: TestNotification })
}

test('Online mode synchronizes authenticated Jack and investigator devices', async ({ page: jack, browser, request }) => {
  const investigatorsContext = await browser.newContext()
  await jack.addInitScript(observeTurnAlerts)
  await investigatorsContext.addInitScript(observeTurnAlerts)
  await jack.addInitScript(observeOnlineSocket)
  await investigatorsContext.addInitScript(observeOnlineSocket)
  const investigators = await investigatorsContext.newPage()
  await observeInvitationClipboard(investigators)
  try {
    await jack.goto('/')
    await jack.getByRole('button', { name: 'New game', exact: true }).click()
    await jack.getByRole('button', { name: 'Online', exact: true }).click()
    await jack.getByRole('button', { name: 'Start new game as Jack' }).click()

    await expect(jack.getByLabel('Online game')).toContainText('Online · Jack')
    await expect(jack.getByRole('heading', { name: 'Jack: Plan the Crime' })).toBeVisible()
    const invitation = await jack.getByLabel('Online investigator invitation').inputValue()
    expect(invitation).toMatch(/#online=[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/)
    await expect(jack.getByLabel('Online game')).toContainText('Investigator invitation copied automatically.')
    expect(await jack.evaluate(() => navigator.clipboard.readText())).toBe(invitation)
    expect(await jack.evaluate(() => window.invitationClipboardProbe.gestures)).toEqual([true])
    await jack.evaluate(() => { window.invitationClipboardProbe.text = 'Clipboard before first click' })
    // Keep the pointer down long enough for audio initialization to settle. The
    // copy target must not move out from under the pointer before mouseup.
    await jack.getByRole('button', { name: 'Copy invitation link', exact: true }).click({ delay: 200 })
    expect(await jack.evaluate(() => navigator.clipboard.readText())).toBe(invitation)
    await expect(jack.getByLabel('Online game')).toContainText('Investigator invitation copied.')
    await jack.reload()
    await expect(jack.getByRole('heading', { name: 'Jack: Plan the Crime' })).toBeVisible()
    expect(await jack.evaluate(() => window.invitationClipboardProbe.writes)).toBe(0)
    expect(await jack.evaluate(() => navigator.clipboard.readText())).toBe('Clipboard before creation')
    await expect(jack.getByLabel('Online game')).toContainText('interact with the page to enable sound')
    await jack.evaluate(() => { window.invitationClipboardProbe.text = 'Clipboard before first click after refresh' })
    await jack.getByRole('button', { name: 'Copy invitation link', exact: true }).click({ delay: 200 })
    expect(await jack.evaluate(() => navigator.clipboard.readText())).toBe(invitation)
    await expect(jack.getByLabel('Online game')).toContainText('Investigator invitation copied.')
    await expect(jack.getByLabel('Online game')).not.toContainText('interact with the page to enable sound')
    const api = `http://127.0.0.1:${process.env.PLAYWRIGHT_WORKER_PORT}`
    const roomId = new URL(invitation).hash.match(/online=([a-f0-9]{64})\./)?.[1]
    expect(roomId).toBeTruthy()
    const unauthorizedMessages = await jack.evaluate(({ apiBase, room }) => new Promise<string[]>((resolve) => {
      const url = new URL(`${apiBase}/v1/games/${room}/connect`)
      url.protocol = 'ws:'
      const messages: string[] = []
      const socket = new WebSocket(url)
      const timeout = window.setTimeout(() => { socket.close(); resolve(messages) }, 3000)
      socket.addEventListener('open', () => socket.send(JSON.stringify({
        type: 'authenticate', protocolVersion: 1, token: 'A'.repeat(43),
      })))
      socket.addEventListener('message', event => messages.push(String(event.data)))
      socket.addEventListener('close', () => { window.clearTimeout(timeout); resolve(messages) })
    }), { apiBase: api, room: roomId! })
    expect(unauthorizedMessages.some(message => JSON.parse(message).type === 'snapshot')).toBe(false)
    expect(unauthorizedMessages.some(message => JSON.parse(message).code === 'authentication')).toBe(true)

    await investigators.goto(invitation)
    await expect(investigators.getByLabel('Online game')).toContainText('Online · Investigators')
    await expect(investigators.getByRole('heading', { name: 'Waiting for your partner' })).toBeVisible()
    expect(await investigators.evaluate(() => window.invitationClipboardProbe.writes)).toBe(0)
    await expect(jack.getByLabel('Online game')).toContainText('Investigators: connected')

    const alerts = investigators.getByRole('group', { name: 'When it’s your turn' })
    await expect(alerts.getByLabel('Flash screen')).toBeChecked()
    await expect(alerts.getByLabel('Chime', { exact: true })).toBeChecked()
    await expect(alerts.getByLabel('System notification')).not.toBeChecked()
    expect(await investigators.evaluate(() => window.turnAlertProbe.permissionRequests)).toBe(0)
    await alerts.getByLabel('System notification').check()
    await expect(alerts.getByLabel('System notification')).toBeChecked()
    expect(await investigators.evaluate(() => window.turnAlertProbe.requestedFromGesture)).toBe(true)
    expect(await investigators.evaluate(() => window.turnAlertProbe.flashes)).toEqual([])

    for (const id of [33, 46, 147, 159]) {
      await jack.getByLabel(`Location ${id}, selectable`, { exact: true }).click()
    }
    await jack.getByRole('button', { name: 'Lock in four locations' }).click()
    await expect(investigators.getByRole('heading', { name: 'Deploy the Yellow Investigator' })).toBeVisible()
    await expect(investigators.locator('.jack-peek-toggle, .private-discovery, .jack-marker')).toHaveCount(0)
    await expect.poll(() => investigators.evaluate(() => window.turnAlertProbe.flashes)).toEqual([500])
    expect(await investigators.evaluate(() => window.turnAlertProbe.tones)).toBe(2)
    expect(await investigators.evaluate(() => window.turnAlertProbe.notifications)).toMatchObject([{
      title: 'Whitehall Mystery — Your turn', options: { body: 'It’s your turn as the investigators.', silent: true },
    }])
    await expect(investigators.locator('.turn-alert-flash')).toHaveCSS('opacity', '0')
    expect(await jack.evaluate(() => window.turnAlertProbe.flashes)).toEqual([])

    await investigators.getByLabel('Available deployment crossings').getByRole('button').first().click()
    await expect(investigators.getByRole('heading', { name: 'Deploy the Blue Investigator' })).toBeVisible()
    await expect(jack.locator('.investigator-piece')).toHaveCount(1)
    expect(await investigators.evaluate(() => window.turnAlertProbe.flashes)).toEqual([500])
    await investigators.reload()
    await expect(investigators.getByRole('heading', { name: 'Deploy the Blue Investigator' })).toBeVisible()
    await expect(alerts.getByLabel('System notification')).toBeChecked()
    expect(await investigators.evaluate(() => window.turnAlertProbe.permissionRequests)).toBe(0)
    expect(await investigators.evaluate(() => window.turnAlertProbe.flashes)).toEqual([])
    expect(await investigators.evaluate(() => window.turnAlertProbe.tones)).toBe(0)

    for (const control of ['Flash screen', 'Chime', 'System notification']) await alerts.getByLabel(control, { exact: true }).uncheck()
    for (const color of ['Blue', 'Red']) {
      await expect(investigators.getByRole('heading', { name: `Deploy the ${color} Investigator` })).toBeVisible()
      await investigators.getByLabel('Available deployment crossings').getByRole('button').first().click()
    }
    await expect(jack.getByRole('heading', { name: 'Jack: Choose the Starting Location' })).toBeVisible()
    await expect.poll(() => jack.evaluate(() => window.turnAlertProbe.flashes)).toEqual([500])
    expect(await jack.evaluate(() => window.turnAlertProbe.tones)).toBe(2)
    expect(await jack.evaluate(() => window.turnAlertProbe.notifications)).toHaveLength(0)
    await jack.getByLabel('Secret Discovery Locations').getByRole('button').first().click()
    // The full verified history is trusted between players, but the normal UI
    // must not leak a tentative public start, even after refresh or undo.
    await expect.poll(() => investigators.evaluate(() => window.onlineProbe.snapshot?.history.state.currentJack)).toBe(33)
    await expect(investigators.locator('.public-log')).not.toContainText('began the hunt')
    await investigators.reload()
    await expect(investigators.getByRole('heading', { name: 'Waiting for your partner' })).toBeVisible()
    for (const control of ['Flash screen', 'Chime', 'System notification']) await expect(alerts.getByLabel(control, { exact: true })).not.toBeChecked()
    await expect(investigators.locator('.public-log')).not.toContainText('Discovery Location 33')
    await jack.getByRole('button', { name: 'Undo', exact: true }).click()
    await jack.getByLabel('Secret Discovery Locations').getByRole('button').nth(1).click()
    await expect.poll(() => investigators.evaluate(() => window.onlineProbe.snapshot?.history.state.currentJack)).toBe(46)
    await expect(investigators.locator('.public-log')).not.toContainText('began the hunt')
    await jack.getByLabel('Legal Jack destinations').getByRole('button').first().click()
    await jack.getByRole('button', { name: 'Record move privately' }).click()
    await expect(investigators.getByRole('heading', { name: 'Yellow Investigator: Move' })).toBeVisible()
    await expect(investigators.locator('.public-log')).toContainText('Jack began the hunt at Discovery Location 46.')
    await expect(investigators.locator('.public-log')).not.toContainText('Discovery Location 33')
    expect(await investigators.evaluate(() => window.turnAlertProbe.flashes)).toEqual([])
    expect(await investigators.evaluate(() => window.turnAlertProbe.tones)).toBe(0)
    expect(await investigators.evaluate(() => window.turnAlertProbe.notifications)).toHaveLength(0)

    // Capture the actual full-viewport animation midway through its half-second pulse.
    await investigators.setViewportSize({ width: 390, height: 844 })
    await alerts.getByLabel('Flash screen').check()
    await alerts.getByRole('button', { name: 'Test alerts' }).click()
    const overlayBox = await investigators.locator('.turn-alert-flash').evaluate(element => {
      const animation = element.getAnimations()[0]
      animation.pause()
      animation.currentTime = 100
      const bounds = element.getBoundingClientRect()
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, pointerEvents: getComputedStyle(element).pointerEvents }
    })
    expect(overlayBox).toEqual({ x: 0, y: 0, width: 390, height: 844, pointerEvents: 'none' })
    expect(await investigators.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await investigators.screenshot({ path: 'test-results/online-turn-alert-mobile.png' })
    await alerts.getByLabel('Flash screen').uncheck()

    // Switch to another saved game while the partner advances this online room.
    await jack.evaluate(() => { window.invitationClipboardProbe.text = 'Keep clipboard when resuming' })
    await jack.getByRole('button', { name: 'New game', exact: true }).click()
    await jack.getByRole('button', { name: 'Same device', exact: true }).click()
    await jack.getByLabel('Location 147, selectable', { exact: true }).click()
    await investigators.getByLabel('Legal yellow Investigator destinations').getByRole('button').first().click()
    await expect(investigators.getByRole('heading', { name: 'Blue Investigator: Move' })).toBeVisible()
    await jack.getByRole('button', { name: 'Resume game', exact: true }).click()
    const onlineSaved = jack.locator('.saved-game-list button').filter({ hasText: 'Online · Jack' })
    await expect(onlineSaved).toContainText('Round 1 · Move 1 · Investigators’ turn (last known)')
    await expect(onlineSaved).not.toContainText('unknown')
    await onlineSaved.click()
    await expect(jack.getByLabel('Online investigator invitation')).toHaveValue(invitation)
    expect(await jack.evaluate(() => navigator.clipboard.readText())).toBe('Keep clipboard when resuming')
    await expect.poll(() => jack.evaluate(() => window.onlineProbe.snapshot?.history.state.activeInvestigator)).toBe(1)
    await expect(jack.locator('.public-log')).toHaveText(await investigators.locator('.public-log').textContent() ?? '')
    await jack.getByRole('button', { name: 'Resume game', exact: true }).click()
    await expect(jack.locator('.saved-game-list button').filter({ hasText: 'Online · Jack' })).toHaveCount(1)

    const bodyResponse = await request.post(`${api}/v1/games`, {
      headers: { Origin: jack.url().replace(/\/$/, '') },
      data: { arbitrary: 'data' },
    })
    expect(bodyResponse.status()).toBe(400)
  } finally {
    await investigatorsContext.close()
  }
})

test('failed online creation does not copy placeholder text or create a saved room', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/v1/games', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Test creation failure' }) }))
  await page.goto('/')
  await page.getByRole('button', { name: 'New game', exact: true }).click()
  await page.getByRole('button', { name: 'Online', exact: true }).click()
  await page.getByRole('button', { name: 'Start new game as Jack', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Could not create an online game.')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Clipboard before creation')
  // A refused clipboard write must also handle creation failing later, even
  // when the browser never asks the ClipboardItem for its promised data.
  await page.evaluate(() => { window.invitationClipboardProbe.blockAutomatic = true })
  await page.getByRole('button', { name: 'Start new game as Jack', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Could not create an online game.')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Clipboard before creation')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Resume game', exact: true }).click()
  await expect(page.locator('.saved-game-resume')).toHaveCount(1)
  await expect(page.locator('.saved-game-resume')).toContainText('Same device')
  expect(errors).toEqual([])
})

test('turn alert controls explain blocked and unavailable notification permissions', async ({ page }) => {
  await page.addInitScript(() => {
    class DeniedNotification {
      static permission = 'denied'
      static async requestPermission() { return 'denied' }
    }
    Object.defineProperty(window, 'Notification', { configurable: true, value: DeniedNotification })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'New game', exact: true }).click()
  await page.getByRole('button', { name: 'Online', exact: true }).click()
  await page.getByRole('button', { name: 'Start new game as Jack' }).click()
  const alerts = page.getByRole('group', { name: 'When it’s your turn' })
  await alerts.getByLabel('System notification').click()
  await expect(alerts.getByLabel('System notification')).not.toBeChecked()
  await expect(alerts).toContainText('Notifications are blocked.')
  expect(await page.evaluate(() => localStorage.getItem('whitehall-mystery.turn-alert.notification'))).toBe('false')
  await page.evaluate(() => {
    Object.defineProperty(window, 'Notification', { value: undefined })
    window.dispatchEvent(new Event('focus'))
  })
  await expect(alerts.getByLabel('System notification')).toBeDisabled()
  await expect(alerts).toContainText('System notifications are unavailable')
  await expect(page.getByRole('heading', { name: 'Jack: Plan the Crime' })).toBeVisible()
})

test('online undo is non-modal, survives refresh, alerts both sides, and preserves the full redo history', async ({ page: jack, browser }) => {
  const investigatorsContext = await browser.newContext()
  const investigators = await investigatorsContext.newPage()
  for (const page of [jack, investigators]) {
    await page.addInitScript(observeTurnAlerts)
    await page.addInitScript(observeOnlineSocket)
  }
  try {
    await jack.goto('/')
    await jack.getByRole('button', { name: 'New game', exact: true }).click()
    await jack.getByRole('button', { name: 'Online', exact: true }).click()
    await jack.getByRole('button', { name: 'Start new game as Jack' }).click()
    await investigators.goto(await jack.getByLabel('Online investigator invitation').inputValue())
    for (const page of [jack, investigators]) await page.getByLabel('System notification').check()
    await jack.getByRole('button', { name: 'Rand Side', exact: true }).click()
    await expect(investigators.getByRole('heading', { name: 'Deploy the Yellow Investigator' })).toBeVisible()
    await investigators.getByRole('button', { name: 'Rand Side', exact: true }).click()
    await expect(jack.getByRole('heading', { name: 'Jack: Choose the Starting Location' })).toBeVisible()
    await jack.getByRole('button', { name: 'Rand Side', exact: true }).click()
    await expect(investigators.getByRole('heading', { name: 'Yellow Investigator: Move' })).toBeVisible()
    await investigators.getByLabel('Legal yellow Investigator destinations').getByRole('button').first().click()
    await expect(investigators.getByRole('heading', { name: 'Blue Investigator: Move' })).toBeVisible()
    const before = await investigators.evaluate(() => window.onlineProbe.snapshot!)
    for (const page of [jack, investigators]) await page.evaluate(() => {
      window.turnAlertProbe.flashes = []; window.turnAlertProbe.tones = 0; window.turnAlertProbe.notifications = []
    })

    await jack.getByRole('button', { name: 'Request undo', exact: true }).click()
    const requestCard = investigators.getByRole('region', { name: 'Undo request', exact: true })
    await expect(requestCard).toBeVisible()
    await expect(investigators.getByRole('dialog')).toHaveCount(0)
    await expect(investigators.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
    await expect.poll(() => investigators.evaluate(() => window.turnAlertProbe.notifications.at(-1)?.title)).toBe('Whitehall Mystery — Undo requested')
    expect(await investigators.evaluate(() => window.turnAlertProbe.flashes)).toEqual([500])
    expect(await investigators.evaluate(() => window.turnAlertProbe.tones)).toBe(2)
    await requestCard.getByRole('button', { name: 'Minimize request' }).click()
    await investigators.getByLabel('xings', { exact: true }).check()
    await expect(investigators.getByLabel('xings', { exact: true })).toBeChecked()
    await requestCard.getByRole('button', { name: 'Show undo request' }).click()
    await investigators.setViewportSize({ width: 390, height: 844 })
    const box = await requestCard.boundingBox()
    expect(box!.height).toBeLessThan(844 / 2)
    expect(box!.width).toBeLessThan(390)
    await investigators.screenshot({ path: 'test-results/online-undo-request-mobile.png' })

    await investigators.reload()
    await expect(requestCard).toBeVisible()
    expect(await investigators.evaluate(() => window.turnAlertProbe.flashes)).toEqual([])
    await requestCard.getByRole('button', { name: 'Deny undo' }).click()
    await expect(jack.getByLabel('Online undo')).toContainText('Your undo request was denied.')
    expect(await investigators.evaluate(() => window.onlineProbe.snapshot!.historyHash)).toBe(before.historyHash)
    await expect.poll(() => jack.evaluate(() => window.turnAlertProbe.notifications.at(-1)?.title)).toBe('Whitehall Mystery — Undo denied')

    await jack.getByRole('button', { name: 'Request undo', exact: true }).click()
    await expect(requestCard).toBeVisible()
    const pending = await investigators.evaluate(() => window.onlineProbe.undo!)
    await requestCard.getByRole('button', { name: 'Approve undo' }).click()
    await expect(jack.getByLabel('Online undo')).toContainText('Your undo request was approved.')
    await expect(jack.getByRole('button', { name: 'Record move privately' })).toBeVisible()
    const after = await jack.evaluate(() => window.onlineProbe.snapshot!)
    expect(after.history.cursor).toBe(pending.targetCursor)
    expect(after.history.state).toMatchObject({ stage: 'jackMove' })
    expect(after.history.actions).toEqual(before.history.actions)
    await expect.poll(() => jack.evaluate(() => window.turnAlertProbe.notifications.at(-1)?.title)).toBe('Whitehall Mystery — Undo approved')
    expect(await jack.evaluate(() => window.turnAlertProbe.flashes)).toEqual([500, 500]) // no extra turn alert on approval
    expect(await jack.evaluate(() => window.turnAlertProbe.tones)).toBe(4)
    await jack.reload()
    await expect(jack.getByLabel('Online undo')).toContainText('Your undo request was approved.')
    expect(await jack.evaluate(() => window.turnAlertProbe.flashes)).toEqual([])

    await jack.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect(investigators.getByRole('heading', { name: 'Yellow Investigator: Move' })).toBeVisible()
    for (const color of ['yellow', 'blue', 'red']) {
      await investigators.getByLabel(`Legal ${color} Investigator destinations`).getByRole('button').first().click()
    }
    for (const color of ['Yellow', 'Blue', 'Red']) {
      await expect(investigators.getByRole('heading', { name: `${color} Investigator: Clues and Suspicion` })).toBeVisible()
      await investigators.getByRole('button', { name: 'Pass', exact: true }).click()
    }
    await expect(jack.getByRole('heading', { name: 'Jack: Escape in the Night' })).toBeVisible()
    const investigatorBefore = await jack.evaluate(() => window.onlineProbe.snapshot!)
    await investigators.getByRole('button', { name: 'Request undo', exact: true }).click()
    await jack.getByRole('button', { name: 'Approve undo' }).click()
    await expect(investigators.getByLabel('Online undo')).toContainText('Your undo request was approved.')
    const investigatorAfter = await investigators.evaluate(() => window.onlineProbe.snapshot!)
    expect(investigatorAfter.history.state.stage).toBe('investigatorAction')
    expect(investigatorAfter.history.actions).toEqual(investigatorBefore.history.actions)
    expect(investigatorAfter.history.cursor).toBeLessThan(investigatorBefore.history.cursor)
  } finally {
    await investigatorsContext.close()
  }
})

test('online undo rejects self-approval, stale revisions and moves while pending; cancellation releases play', async ({ page: jack, browser }) => {
  const investigatorsContext = await browser.newContext()
  const investigators = await investigatorsContext.newPage()
  for (const page of [jack, investigators]) await page.addInitScript(observeOnlineSocket)
  try {
    await jack.goto('/')
    await jack.getByRole('button', { name: 'New game', exact: true }).click()
    await jack.getByRole('button', { name: 'Online', exact: true }).click()
    await jack.getByRole('button', { name: 'Start new game as Jack' }).click()
    await investigators.goto(await jack.getByLabel('Online investigator invitation').inputValue())
    await expect(jack.getByRole('button', { name: 'Rand Side', exact: true })).toBeEnabled()
    await jack.evaluate(() => {
      const probe = window.onlineProbe
      probe.socket!.send(JSON.stringify({ type: 'command', protocolVersion: 1, requestId: crypto.randomUUID(),
        expectedRevision: probe.snapshot!.revision, expectedHistoryHash: probe.snapshot!.historyHash,
        commands: [
          ...[33, 46, 147, 159].map(circleId => ({ type: 'apply', action: { type: 'toggleDiscovery', circleId } })),
          { type: 'apply', action: { type: 'confirmDiscoveries' } }, { type: 'undo' },
        ] }))
    })
    await expect(jack.getByLabel('Online game')).toContainText('A command batch cannot continue after your turn ends.')
    expect(await jack.evaluate(() => window.onlineProbe.snapshot!.revision)).toBe(0)
    await jack.getByRole('button', { name: 'Rand Side', exact: true }).click()
    await expect(investigators.getByRole('heading', { name: 'Deploy the Yellow Investigator' })).toBeVisible()
    await jack.getByRole('button', { name: 'Request undo', exact: true }).click()
    await expect(investigators.getByRole('button', { name: 'Approve undo' })).toBeVisible()
    const pending = await jack.evaluate(() => window.onlineProbe.snapshot!)

    const count = await jack.evaluate(() => {
      const probe = window.onlineProbe
      // A retry of the accepted request must not create a second request/revision.
      probe.socket!.send(JSON.stringify({ type: 'request-undo', protocolVersion: 1, requestId: probe.undo!.id,
        expectedRevision: probe.snapshot!.revision - 1, expectedHistoryHash: probe.snapshot!.historyHash }))
      return probe.snapshotCount
    })
    await expect.poll(() => jack.evaluate(() => window.onlineProbe.snapshotCount)).toBeGreaterThan(count)
    expect(await jack.evaluate(() => window.onlineProbe.snapshot)).toEqual(pending)

    await jack.evaluate(() => {
      const probe = window.onlineProbe
      probe.socket!.send(JSON.stringify({ type: 'decide-undo', protocolVersion: 1, requestId: crypto.randomUUID(),
        expectedRevision: probe.snapshot!.revision, expectedHistoryHash: probe.snapshot!.historyHash,
        undoRequestId: probe.undo!.id, decision: 'approve' }))
    })
    await expect(jack.getByLabel('Online game')).toContainText('Only your partner can approve')
    await investigators.evaluate(() => {
      const probe = window.onlineProbe
      probe.socket!.send(JSON.stringify({ type: 'command', protocolVersion: 1, requestId: crypto.randomUUID(),
        expectedRevision: probe.snapshot!.revision, expectedHistoryHash: probe.snapshot!.historyHash, commands: [{ type: 'undo' }] }))
    })
    await expect(investigators.getByLabel('Online game')).toContainText('Resolve the undo request')
    await investigators.evaluate(() => {
      const probe = window.onlineProbe
      probe.socket!.send(JSON.stringify({ type: 'decide-undo', protocolVersion: 1, requestId: crypto.randomUUID(),
        expectedRevision: probe.snapshot!.revision - 1, expectedHistoryHash: probe.snapshot!.historyHash,
        undoRequestId: probe.undo!.id, decision: 'approve' }))
    })
    await expect.poll(() => investigators.evaluate(() => window.onlineProbe.errors)).toContain('conflict')
    expect(await investigators.evaluate(() => window.onlineProbe.snapshot)).toEqual(pending)
    await expect(investigators.getByRole('button', { name: 'Approve undo' })).toBeVisible()
    await jack.getByRole('button', { name: 'Cancel undo request' }).click()
    await expect(investigators.getByRole('button', { name: 'Approve undo' })).toHaveCount(0)
    await expect(investigators.getByRole('heading', { name: 'Deploy the Yellow Investigator' })).toBeVisible()
    expect(await investigators.evaluate(() => window.onlineProbe.snapshot!.historyHash)).toBe(pending.historyHash)
    await investigators.getByLabel('Available deployment crossings').getByRole('button').first().click()
    await expect(investigators.getByRole('heading', { name: 'Deploy the Blue Investigator' })).toBeVisible()
    await investigators.evaluate(() => {
      const probe = window.onlineProbe
      for (let index = 0; index < 25; index++) probe.socket!.send(JSON.stringify({ type: 'request-undo', protocolVersion: 1,
        requestId: crypto.randomUUID(), expectedRevision: probe.snapshot!.revision, expectedHistoryHash: probe.snapshot!.historyHash }))
    })
    await expect.poll(() => investigators.evaluate(() => window.onlineProbe.errors)).toContain('rate-limited')
  } finally {
    await investigatorsContext.close()
  }
})
