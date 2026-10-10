import { test as base } from '@playwright/test'
import { randomBytes } from 'node:crypto'

export * from '@playwright/test'

// Local Cloudflare rate limits must be shared by the players in one test, but
// independent tests must not consume one another's creation/connection quota.
// Cloudflare supplies this header in production; only local QA injects it.
export const test = base.extend<{ isolatedClientAddress: void }>({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, provide) => {
    const address = `2001:db8:${randomBytes(12).toString('hex').match(/.{4}/g)!.join(':')}`
    await provide({ ...extraHTTPHeaders, 'CF-Connecting-IP': address })
  },
  isolatedClientAddress: [async ({ browser, extraHTTPHeaders }, provide) => {
    // Multiplayer tests also create opponent contexts directly. Apply the same
    // address to those contexts, including their WebSocket upgrade requests.
    const original = browser.newContext
    browser.newContext = async options => {
      const context = await original.call(browser, {
        ...options,
        extraHTTPHeaders: { ...extraHTTPHeaders, ...options?.extraHTTPHeaders,
          'CF-Connecting-IP': extraHTTPHeaders!['CF-Connecting-IP'] },
      })
      await context.addInitScript(({ address, port }) => {
        const NativeWebSocket = window.WebSocket
        window.WebSocket = class extends NativeWebSocket {
          constructor(input: string | URL, protocols?: string | string[]) {
            const url = new URL(input, window.location.href)
            if (url.hostname === '127.0.0.1' && url.port === port) url.searchParams.set('qa-client-ip', address)
            super(url, protocols)
          }
        }
      }, { address: extraHTTPHeaders!['CF-Connecting-IP'], port: process.env.PLAYWRIGHT_WORKER_PORT! })
      return context
    }
    try { await provide() }
    finally { browser.newContext = original }
  }, { auto: true }],
})
