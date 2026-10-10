import { availableParallelism } from 'node:os'
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default defineConfig(env => mergeConfig(viteConfig(env), {
  test: {
    // AI planning and whole-game replay tests are CPU-bound. Leave capacity for
    // the host and cap concurrency even when it reports many logical cores.
    maxWorkers: Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2))),
  },
}))
