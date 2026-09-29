// Run explicitly after changing the map, Easy discoveries or Jack's opening
// scoring. Gameplay and builds use the saved results without rerunning this.
// Use --check to verify the saved results without changing them.
import { createServer } from 'vite'
import { readFile, writeFile } from 'node:fs/promises'

const output = new URL('../src/data/whitehall/aiDeploymentScores.json', import.meta.url)
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false } })
try {
  const { deploymentScore } = await server.ssrLoadModule('/src/game/aiDeploymentAnalysis.ts')
  const { startingCrossings } = await server.ssrLoadModule('/src/game/mapData.ts')
  const ids = startingCrossings.map(crossing => crossing.id)
  const scores = {}
  for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) for (let c = b + 1; c < ids.length; c++) {
    const positions = { yellow: ids[a], blue: ids[b], red: ids[c] }
    scores[Object.values(positions).sort().join(',')] = deploymentScore(positions)
  }
  const text = JSON.stringify(scores, null, 2) + '\n'
  if (process.argv.includes('--check')) {
    const saved = JSON.parse(await readFile(output, 'utf8'))
    if (JSON.stringify(saved) !== JSON.stringify(scores)) throw new Error('Deployment scores changed. Run node scripts/analyze-investigator-deployment.mjs to regenerate them.')
  } else await writeFile(output, text)
  const best = Math.min(...Object.values(scores))
  console.log(JSON.stringify({ layouts: Object.keys(scores).length, best,
    winners: Object.keys(scores).filter(key => Math.abs(scores[key] - best) < 1e-9) }))
} finally { await server.close() }
