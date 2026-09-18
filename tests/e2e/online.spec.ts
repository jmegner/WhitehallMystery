import { expect, test } from '@playwright/test'

test('Online mode synchronizes authenticated Jack and investigator devices', async ({ page: jack, browser, request }) => {
  const investigatorsContext = await browser.newContext()
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

    for (const id of [33, 46, 147, 159]) {
      await jack.getByLabel(`Location ${id}, selectable`, { exact: true }).click()
    }
    await jack.getByRole('button', { name: 'Lock in four locations' }).click()
    await expect(investigators.getByRole('heading', { name: 'Deploy the Yellow Investigator' })).toBeVisible()
    await expect(investigators.locator('.jack-peek-toggle, .private-discovery, .jack-marker')).toHaveCount(0)

    await investigators.getByLabel('Available deployment crossings').getByRole('button').first().click()
    await expect(investigators.getByRole('heading', { name: 'Deploy the Blue Investigator' })).toBeVisible()
    await investigators.reload()
    await expect(investigators.getByRole('heading', { name: 'Deploy the Blue Investigator' })).toBeVisible()

    const bodyResponse = await request.post(`${api}/v1/games`, {
      headers: { Origin: jack.url().replace(/\/$/, '') },
      data: { arbitrary: 'data' },
    })
    expect(bodyResponse.status()).toBe(400)
  } finally {
    await investigatorsContext.close()
  }
})
