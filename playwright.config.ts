import { defineConfig, devices } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { availableParallelism } from 'node:os'

// Each QA run gets its own origin and persisted browser state. Workers inherit it.
const port = process.env.PLAYWRIGHT_PORT ?? String(randomInt(42000, 60000))
const workerPort = process.env.PLAYWRIGHT_WORKER_PORT ?? String(randomInt(30000, 41999))
process.env.PLAYWRIGHT_PORT = port
process.env.PLAYWRIGHT_WORKER_PORT = workerPort
const devServer = process.env.PLAYWRIGHT_DEV_SERVER === '1'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  // Keep capacity for the browsers and the real Worker. Production serving
  // tolerates more parallel tests; development module transforms need room.
  workers: Math.max(1, Math.min(devServer ? 4 : 6, Math.floor(availableParallelism() / 2))),
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    // Recording every SVG/DOM snapshot is expensive. Request traces and review
    // screenshots explicitly with test:e2e:diagnostic when investigating failures.
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      // Explicit local mode disables remote bindings. QA data never shares dev/production rooms.
      command: `npx wrangler dev worker/src/qa.ts --local --config worker/wrangler.jsonc --port ${workerPort} --persist-to .wrangler/qa-${workerPort}`,
      url: `http://127.0.0.1:${workerPort}/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: devServer
        ? `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`
        : 'node scripts/serve-e2e.mjs',
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_MULTIPLAYER_API: `http://127.0.0.1:${workerPort}` },
    },
  ],
})
