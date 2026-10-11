import type { Page } from '@playwright/test'

export async function holdAiWorker(page: Page) {
  // Hold the actual worker entry in both Vite development and production builds.
  await page.route(url => /^\/(?:src\/game\/ai\.worker\.ts|assets\/ai\.worker-[^/]+\.js)$/.test(url.pathname),
    route => route.fulfill({ contentType: 'application/javascript', body: 'self.onmessage = () => {}' }))
}
