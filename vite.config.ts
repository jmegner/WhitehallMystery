import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { BuildInfo } from './src/buildInfo'

function readGit(...args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null // Source archives and some local environments have no Git metadata.
  }
}

// https://vite.dev/config/
// Host-specific base paths:
// - Cloudflare Pages and local development: '/'
// - GitHub Pages: '/WhitehallMystery/' via the build:gh CLI override
// - Custom previews: VITE_BASE or BASE
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = env.VITE_BASE || env.BASE || '/'
  // Capture source identity before the GitHub workflow creates its deployment
  // commit. Both hosts and local builds use the same metadata and footer.
  const sourceCommit = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || readGit('rev-parse', 'HEAD')
  const commitHash = sourceCommit && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sourceCommit) ? sourceCommit : null
  const commitDate = commitHash ? readGit('show', '-s', '--format=%cI', commitHash) : null
  const buildInfo: BuildInfo = {
    commitHash,
    committedAt: commitDate ? new Date(commitDate).toISOString() : null,
    builtAt: new Date().toISOString(),
  }

  return {
    plugins: [react()],
    base,
    define: { __BUILD_INFO__: JSON.stringify(buildInfo) },
    build: {
      rollupOptions: {
        input: {
          game: resolve(__dirname, 'index.html'),
          report: resolve(__dirname, 'reports/initial_report/index.html'),
        },
      },
    },
  }
})
