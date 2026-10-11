import { build, preview } from 'vite'

const port = Number(process.env.PLAYWRIGHT_PORT)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PLAYWRIGHT_PORT must name the fresh port allocated by Playwright.')
}

// The multiplayer endpoint is compiled into the client. Build for this run's
// local Worker, in an isolated directory, without overwriting deployment output.
const outDir = `node_modules/.cache/whitehall-e2e/${port}`
await build({ base: '/', build: { outDir }, clearScreen: false })
await preview({
  base: '/', build: { outDir }, clearScreen: false,
  preview: { host: '127.0.0.1', port, strictPort: true },
})
