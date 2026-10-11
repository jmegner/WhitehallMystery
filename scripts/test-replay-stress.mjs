import { spawnSync } from 'node:child_process'

const result = spawnSync(process.execPath, [
  'node_modules/vitest/vitest.mjs', 'run', 'src/game/byMail.test.ts',
  '--testNamePattern=replays complete deterministic game', ...process.argv.slice(2),
], { stdio: 'inherit', env: { ...process.env, WHITEHALL_REPLAY_STRESS: '1' } })
if (result.error) throw result.error
process.exit(result.status ?? 1)
