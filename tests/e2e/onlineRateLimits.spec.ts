import { expect, test, type Page } from './fixtures'

const api = () => `http://127.0.0.1:${process.env.PLAYWRIGHT_WORKER_PORT}`

test.setTimeout(60_000)

async function quotaWindow() {
  // Miniflare's counters reset on wall-clock minute boundaries. Start bursts
  // with enough room to finish, so rollover cannot make an excess request pass.
  const remaining = 60_000 - Date.now() % 60_000
  if (remaining < 10_000) await new Promise(resolve => setTimeout(resolve, remaining + 1000))
}

test('online rate limits: independent tests retain the five-game creation quota', async ({ request, baseURL }) => {
  await quotaWindow()
  for (let index = 0; index < 5; index++) {
    const response = await request.post(`${api()}/v1/games`, { headers: { Origin: baseURL! }, data: {} })
    expect(response.status()).toBe(201)
  }
  const excess = await request.post(`${api()}/v1/games`, { headers: { Origin: baseURL! }, data: {} })
  expect(excess.status()).toBe(429)
  expect(excess.headers()['retry-after']).toBe('60')
})

async function connections(page: Page, url: string, count: number) {
  return page.evaluate(async ({ url, count }) => {
    let accepted = 0
    for (let index = 0; index < count; index++) {
      const opened = await new Promise<boolean>(resolve => {
        const socket = new WebSocket(url)
        socket.addEventListener('open', () => { socket.close(); resolve(true) }, { once: true })
        socket.addEventListener('error', () => resolve(false), { once: true })
      })
      if (opened) accepted++
    }
    return accepted
  }, { url, count })
}

test('online rate limits: players in one test share the thirty-connection quota', async ({ page, browser, request, baseURL }) => {
  const response = await request.post(`${api()}/v1/games`, { headers: { Origin: baseURL! }, data: {} })
  expect(response.status()).toBe(201)
  const { roomId } = await response.json() as { roomId: string }
  const socketUrl = `${api().replace('http:', 'ws:')}/v1/games/${roomId}/connect`
  const opponentContext = await browser.newContext()
  try {
    const opponent = await opponentContext.newPage()
    await page.goto('/')
    await opponent.goto(baseURL!)
    await quotaWindow()
    expect(await connections(page, socketUrl, 15)).toBe(15)
    expect(await connections(opponent, socketUrl, 15)).toBe(15)
    expect(await connections(page, socketUrl, 1)).toBe(0)
    expect(await connections(opponent, socketUrl, 1)).toBe(0)
  } finally { await opponentContext.close() }
})
