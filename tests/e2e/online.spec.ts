import { expect, test } from '@playwright/test'

declare global {
  interface Window {
    turnAlertProbe: {
      flashes: number[]
      tones: number
      permissionRequests: number
      requestedFromGesture: boolean
      notifications: Array<{ title: string; options?: NotificationOptions }>
    }
  }
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
  const investigators = await investigatorsContext.newPage()
  try {
    await jack.goto('/')
    await jack.getByRole('button', { name: 'New game', exact: true }).click()
    await jack.getByRole('button', { name: 'Online', exact: true }).click()
    await jack.getByRole('button', { name: 'Start new game as Jack' }).click()

    await expect(jack.getByLabel('Online game')).toContainText('Online · Jack')
    await expect(jack.getByRole('heading', { name: 'Jack: Plan the Crime' })).toBeVisible()
    const invitation = await jack.getByLabel('Online investigator invitation').inputValue()
    expect(invitation).toMatch(/#online=[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/)
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
    expect(await investigators.evaluate(() => window.turnAlertProbe.flashes)).toEqual([500])
    await investigators.reload()
    await expect(investigators.getByRole('heading', { name: 'Deploy the Blue Investigator' })).toBeVisible()
    await expect(alerts.getByLabel('System notification')).toBeChecked()
    expect(await investigators.evaluate(() => window.turnAlertProbe.permissionRequests)).toBe(0)
    expect(await investigators.evaluate(() => window.turnAlertProbe.flashes)).toEqual([])
    expect(await investigators.evaluate(() => window.turnAlertProbe.tones)).toBe(0)

    for (const control of ['Flash screen', 'Chime', 'System notification']) await alerts.getByLabel(control, { exact: true }).uncheck()
    await investigators.reload()
    await expect(investigators.getByRole('heading', { name: 'Deploy the Blue Investigator' })).toBeVisible()
    for (const control of ['Flash screen', 'Chime', 'System notification']) await expect(alerts.getByLabel(control, { exact: true })).not.toBeChecked()
    for (const color of ['Blue', 'Red']) {
      await expect(investigators.getByRole('heading', { name: `Deploy the ${color} Investigator` })).toBeVisible()
      await investigators.getByLabel('Available deployment crossings').getByRole('button').first().click()
    }
    await expect(jack.getByRole('heading', { name: 'Jack: Choose the Starting Location' })).toBeVisible()
    await expect.poll(() => jack.evaluate(() => window.turnAlertProbe.flashes)).toEqual([500])
    expect(await jack.evaluate(() => window.turnAlertProbe.tones)).toBe(2)
    expect(await jack.evaluate(() => window.turnAlertProbe.notifications)).toHaveLength(0)
    await jack.getByLabel('Secret Discovery Locations').getByRole('button').first().click()
    await jack.getByLabel('Legal Jack destinations').getByRole('button').first().click()
    await jack.getByRole('button', { name: 'Record move privately' }).click()
    await expect(investigators.getByRole('heading', { name: 'Yellow Investigator: Move' })).toBeVisible()
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

    const bodyResponse = await request.post(`${api}/v1/games`, {
      headers: { Origin: jack.url().replace(/\/$/, '') },
      data: { arbitrary: 'data' },
    })
    expect(bodyResponse.status()).toBe(400)
  } finally {
    await investigatorsContext.close()
  }
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
