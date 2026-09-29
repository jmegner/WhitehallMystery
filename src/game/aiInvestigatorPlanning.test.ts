import { expect, test } from 'vitest'
import { planInvestigatorMoves } from './aiInvestigators'
import { InvestigatorPlanning } from './aiInvestigatorPlanning'
import { locationBit } from './aiInvestigatorBelief'
import { createInvestigatorWeights, viableJackLocations } from './aiInvestigatorWeights'
import { createInitialGame, gameReducer, legalInvestigatorDestinations } from './gameEngine'
import { possibleJackLocations, possibleJackSearchOutcomes } from './inference'
import { crossingsById } from './mapData'
import { INVESTIGATOR_ORDER, type GameState, type PublicRoundEvidence } from './types'

// Public evidence from review-2, before the old AI left Red at DG to repeat
// 34/15/33 while Jack's Coach could have carried him toward NE discoveries.
function eastwardCoach(): GameState {
  const observations: PublicRoundEvidence['observations'] = []
  for (const [afterMove, ids] of [[1, [73, 72]], [2, [56, 39, 52, 71, 55, 54, 53]], [3, [41, 33, 15, 34]]] as const) {
    for (const circleId of ids) observations.push({ kind: 'clue', circleId, found: false, afterMove, investigator: 'red' })
  }
  observations.push({ kind: 'clue', circleId: 21, found: true, afterMove: 3, investigator: 'yellow' })
  const priorPositions = [
    { yellow: 'JH', blue: 'FP', red: 'JD' }, { yellow: 'JM', blue: 'FC', red: 'DQ' },
    { yellow: 'JS', blue: 'DT', red: 'DM' }, { yellow: 'CH', blue: 'DL', red: 'DG' },
  ]
  return { ...createInitialGame(), stage: 'investigatorMove', moveSlot: 5, reachedDiscoveries: [35], clueLocations: [21],
    investigatorPositions: priorPositions[3]!, specialRemaining: { alley: 2, boat: 2, coach: 1 }, publicRound: {
      start: 35, observations, moves: priorPositions.map((investigatorPositions, index) => ({
        type: index === 3 ? 'coach' : 'normal', startSlot: index + 1, endSlot: index === 3 ? 5 : index + 1, investigatorPositions,
      })),
    } }
}

test('intercepts eastward routes instead of keeping the whole team checking the rear', () => {
  const state = eastwardCoach()
  const plan = planInvestigatorMoves(state, () => 0.5)
  let moved = state
  for (const color of INVESTIGATOR_ORDER) {
    expect(legalInvestigatorDestinations(moved)).toContain(plan[color])
    moved = gameReducer(moved, { type: 'moveInvestigator', crossingId: plan[color]! })
    expect(crossingsById.get(plan[color]!)!.x).toBeGreaterThan(crossingsById.get(state.investigatorPositions[color]!)!.x)
  }
})

test('scores interception as a primary objective even without any immediate searches', () => {
  const state = eastwardCoach()
  const weights = createInvestigatorWeights(state)!
  const planner = new InvestigatorPlanning(state, weights, possibleJackSearchOutcomes(state.publicRound),
    viableJackLocations(possibleJackLocations(state.publicRound), weights))
  const east = { yellow: 'CJ', blue: 'DD', red: 'CG' }
  const rear = { yellow: 'BW', blue: 'DM', red: 'DG' }
  expect(planner.forPositions(east).expectedScore([])).toBeLessThan(planner.forPositions(rear).expectedScore([]))
})

test('ignores doomed forecast branches but retains a finite special rescue and a pending discovery', () => {
  const state: GameState = { ...createInitialGame(), stage: 'investigatorMove', moveSlot: 13,
    reachedDiscoveries: [117, 129, 5], specialRemaining: { alley: 0, boat: 0, coach: 0 },
    publicRound: { start: 5, observations: [], moves: [{ type: 'normal', startSlot: 13, endSlot: 13,
      investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' } }] } }
  const score = (state: GameState, id: number) => {
    const planner = new InvestigatorPlanning(state, createInvestigatorWeights(state)!, new Map(), new Set([id]))
    return planner.forPositions({}).score([{ position: id, goal: 0, probability: 1, visited: locationBit(id) }])
  }
  expect(score(state, 102)).toBe(0) // Three Street slots needed, only two remain.
  expect(score({ ...state, specialRemaining: { alley: 1, boat: 0, coach: 0 } }, 102)).toBeGreaterThan(0)
  expect(score({ ...state, specialRemaining: { alley: 0, boat: 0, coach: 1 } }, 102)).toBe(0)
  expect(score({ ...state, moveSlot: 15 }, 1)).toBeGreaterThan(0) // Possible NW discovery awaiting reveal.
  expect(score({ ...state, moveSlot: 15, publicRound: { ...state.publicRound!, moves: [
    { ...state.publicRound!.moves[0]!, type: 'alley' },
  ] } }, 1)).toBe(0) // A special arrival cannot end the round.
})
