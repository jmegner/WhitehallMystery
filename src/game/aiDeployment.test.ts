import { describe, expect, test } from 'vitest'
import { discoveryDifficulty, easyDiscoveryScenarios, EASY_DISCOVERY_LIMIT } from './aiDiscoveries'
import { planInvestigatorDeployment } from './aiDeployment'
import { deploymentOpeningScores, deploymentScore } from './aiDeploymentAnalysis'
import { createInitialGame } from './gameEngine'
import { planInvestigatorMoves } from './aiInvestigators'
import { aiTurnRandom } from './aiRandom'
import { circlesById, startingCrossings } from './mapData'

describe('investigator deployment against Easy Jack', () => {
  test('covers the full Easy distribution with the original location-130 sampling bias', () => {
    const scenarios = easyDiscoveryScenarios()
    expect(scenarios).toHaveLength(34997)
    expect(new Set(scenarios.map(scenario => scenario.ids.join(','))).size).toBe(scenarios.length)
    for (const { ids, weight } of scenarios) {
      expect(new Set(ids.map(id => circlesById.get(id)!.quadrant)).size).toBe(4)
      expect(discoveryDifficulty(ids)).toBeLessThanOrEqual(EASY_DISCOVERY_LIMIT)
      expect(weight).toBe(ids.includes(130) ? 3500 / 6725 : 1)
    }
  })

  test('lets Jack choose his best start within each secret set before taking the weighted average', () => {
    const positions = { yellow: 'FP', blue: 'JD', red: 'JH' }
    const scenarios = [{ ids: [33, 43, 130, 139], weight: 0.5 }, { ids: [35, 78, 139, 142], weight: 1 }]
    const starts = scenarios.map(scenario => deploymentOpeningScores(positions, scenario.ids))
    const expected = (Math.max(...starts[0]!) * 0.5 + Math.max(...starts[1]!)) / 1.5
    expect(deploymentScore(positions, scenarios)).toBeCloseTo(expected)
    expect(expected).toBeGreaterThan(starts.reduce((sum, scores, i) => sum +
      scores.reduce((a, b) => a + b, 0) / 4 * scenarios[i]!.weight, 0) / 1.5)
  })

  test('selects the best complete layout and does not consult the actual secret discoveries', () => {
    const state = { ...createInitialGame(), stage: 'investigatorSetup' as const }
    const plan = planInvestigatorMoves(state, aiTurnRandom('deployment', state))
    expect(Object.values(plan).sort()).toEqual(['HP', 'JD', 'JH'])
    const changed = { ...state, discoveryLocations: [1, 5, 173, 188], currentJack: 188, roundTrail: [188] }
    expect(planInvestigatorMoves(changed, aiTurnRandom('deployment', changed))).toEqual(plan)
    expect(deploymentScore(plan)).toBeLessThan(deploymentScore({ yellow: 'HZ', blue: 'JC', red: 'JD' }))
  }, 15000)

  test('preserves partial deployment and places the remaining pieces on distinct legal starts', () => {
    const plan = planInvestigatorDeployment({ activeInvestigator: 1, investigatorPositions: { yellow: 'HP' } }, () => 0)
    expect(plan.yellow).toBe('HP')
    expect(new Set(Object.values(plan)).size).toBe(3)
    for (const id of Object.values(plan)) expect(startingCrossings.some(crossing => crossing.id === id)).toBe(true)
  })

  test('keeps all six color assignments tied in the same random order', () => {
    const state = { activeInvestigator: 0, investigatorPositions: {} }
    const plans = Array.from({ length: 6 }, (_, index) => {
      let calls = 0
      const plan = planInvestigatorDeployment(state, () => { calls++; return (index + 0.5) / 6 })
      expect(calls).toBe(1)
      return [plan.yellow, plan.blue, plan.red]
    })
    expect(plans).toEqual([
      ['HP', 'JD', 'JH'], ['HP', 'JH', 'JD'],
      ['JD', 'HP', 'JH'], ['JD', 'JH', 'HP'],
      ['JH', 'HP', 'JD'], ['JH', 'JD', 'HP'],
    ])
  })

  test.each([
    { yellow: 'FP', blue: 'HP', red: 'JC' },
    { yellow: 'HP', blue: 'HZ', red: 'JH' },
    { yellow: 'JC', blue: 'FP', red: 'JD' },
    { yellow: 'HZ', blue: 'JD', red: 'JH' },
  ])('finishes a saved partial deployment at $yellow/$blue with $red', ({ yellow, blue, red }) => {
    const plan = planInvestigatorDeployment({ activeInvestigator: 2, investigatorPositions: { yellow, blue } },
      () => { throw new Error('A unique completion should not consume randomness') })
    expect(plan).toEqual({ yellow, blue, red })
  })
})
