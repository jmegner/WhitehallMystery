import deploymentScores from '../data/whitehall/aiDeploymentScores.json'
import { startingCrossings } from './mapData'
import { randomChoice } from './aiRandom'
import { INVESTIGATOR_ORDER, type GameState } from './types'
import type { Positions } from './investigatorTactics'

// Precomputed by scripts/analyze-investigator-deployment.mjs. The winning full
// layout is HP/JD/JH; retain all 20 layouts for resumed partial deployments.
// Keep the original enumeration and random tie break so seeded games assign
// the three colors exactly as before, without analyzing Jack's openings.
const scores: Readonly<Record<string, number>> = deploymentScores
export function planInvestigatorDeployment(state: Pick<GameState, 'investigatorPositions' | 'activeInvestigator'>,
  random = Math.random): Positions {
  let best = Infinity
  let finalists: Positions[] = []
  const visit = (positions: Positions, index: number) => {
    if (index === INVESTIGATOR_ORDER.length) {
      const key = Object.values(positions).sort().join(',')
      const score = scores[key]
      if (score === undefined) return
      if (score < best - 1e-9) { best = score; finalists = [] }
      if (Math.abs(score - best) < 1e-9) finalists.push(positions)
      return
    }
    for (const crossing of startingCrossings) {
      if (!Object.values(positions).includes(crossing.id)) visit({ ...positions, [INVESTIGATOR_ORDER[index]!]: crossing.id }, index + 1)
    }
  }
  visit(state.investigatorPositions, state.activeInvestigator)
  return randomChoice(finalists, random) ?? state.investigatorPositions
}
