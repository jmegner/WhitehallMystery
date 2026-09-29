// Offline deployment analysis. Keep this out of the runtime AI import graph.
import { easyDiscoveryScenarios, type EasyDiscoveryScenario } from './aiDiscoveries'
import { createInitialGame, legalJackDestinations, legalNormalDestinations } from './gameEngine'
import { adjacentCirclesForCrossing, circles, crossings, jackTransitions, reachableCrossings } from './mapData'
import type { JackMoveType } from './types'
import type { Positions } from './investigatorTactics'
import { JACK_PROGRESS_WEIGHT, JACK_THREAT_WEIGHT, jackPacePenalty, jackSpecialCost } from './aiJackScoring'

const streetDistances = new Map(circles.map(({ id }) => {
  const distances = new Map([[id, 0]])
  const queue = [id]
  for (let index = 0; index < queue.length; index++) {
    const from = queue[index]!
    for (const to of jackTransitions.get(from)!.keys()) {
      if (!distances.has(to)) { distances.set(to, distances.get(from)! + 1); queue.push(to) }
    }
  }
  return [id, distances] as const
}))
const adjacentCounts = new Map(circles.map(({ id }) => [id,
  crossings.filter(crossing => adjacentCirclesForCrossing(crossing.id).includes(id)).length,
]))

interface Opening { type: JackMoveType; path: number[]; base: number; distances: Map<number, number> }

// Score the first move using Jack's safety/mobility/progress preferences. The
// deployment forecast omits his expensive trap lookahead, but includes every
// legal Street, Alley, Boat and Coach opening and discovery restrictions.
function openingOptions(positions: Positions): Map<number, Opening[]> {
  const occupied = new Set(Object.values(positions))
  const threats = new Map<number, number>()
  for (const start of occupied) {
    const targets = new Set([...reachableCrossings(start, 2)]
      .filter(id => id === start || !occupied.has(id)).flatMap(adjacentCirclesForCrossing))
    for (const id of targets) threats.set(id, (threats.get(id) ?? 0) + 1)
  }
  const state = { ...createInitialGame(), stage: 'jackMove' as const, investigatorPositions: positions }
  const bases = new Map(circles.map(({ id }) => {
    const exits = legalNormalDestinations(state, id)
    return [id, -(threats.get(id) ?? 0) * JACK_THREAT_WEIGHT - (exits.length === 0 ? 250 : 0) +
      Math.min(exits.length, 12) * 0.8 + exits.filter(to => !threats.has(to)).length * 1.5 + adjacentCounts.get(id)! * 1.5]
  }))
  return new Map(circles.filter(circle => circle.color === 'white').map(({ id }) => {
    const openings: Opening[] = []
    for (const type of ['normal', 'alley', 'boat', 'coach'] as const) {
      const planning = { ...state, currentJack: id, jackMoveSelection: { type, path: [] } }
      for (const first of legalJackDestinations(planning)) {
        const paths = type === 'coach' ? legalJackDestinations({ ...planning, jackMoveSelection: { type, path: [first] } })
          .map(second => [first, second]) : [[first]]
        for (const path of paths) {
          const destination = path.at(-1)!
          openings.push({ type, path, distances: streetDistances.get(destination)!,
            base: bases.get(destination)! - jackSpecialCost(type, 1, 2) - (type === 'coach' ? JACK_PROGRESS_WEIGHT : 0) })
        }
      }
    }
    return [id, openings]
  }))
}

interface Reply { score: number; forbidden: number[] }
type Replies = Map<number, Map<number, Reply[]>>

function rankedReplies(positions: Positions, goals: number[]): Replies {
  return new Map([...openingOptions(positions)].map(([start, options]) => [start, new Map(goals.map(goal => {
    const replies = options.map(opening => {
      const distance = opening.distances.get(goal)!
      const remaining = opening.type === 'coach' ? 13 : 14
      return { score: opening.base - JACK_PROGRESS_WEIGHT * distance + (distance === 0 ? 35 : 0) -
        jackPacePenalty(distance, remaining),
      forbidden: opening.type === 'normal' ? [] : opening.path }
    }).filter(reply => !reply.forbidden.includes(goal)).sort((a, b) => b.score - a.score)
    // A Street opening is always legal for this discovery set. Everything
    // below the best one is dominated; retain special alternatives above it.
    const street = replies.findIndex(reply => reply.forbidden.length === 0)
    return [goal, street < 0 ? replies : replies.slice(0, street + 1)]
  }))]))
}

function bestFromStart(start: number, ids: number[], replies: Replies): number {
  let best = -1000
  for (const goal of ids) {
    if (goal === start) continue
    for (const reply of replies.get(start)?.get(goal) ?? []) {
      if (reply.forbidden.some(id => ids.includes(id))) continue
      best = Math.max(best, reply.score)
      break
    }
  }
  return best
}

export function deploymentOpeningScores(positions: Positions, ids: number[]): number[] {
  const replies = rankedReplies(positions, ids)
  return ids.map(start => bestFromStart(start, ids, replies))
}

export function deploymentScore(positions: Positions, scenarios: readonly EasyDiscoveryScenario[] = easyDiscoveryScenarios()): number {
  const replies = rankedReplies(positions, [...new Set(scenarios.flatMap(scenario => scenario.ids))])
  let score = 0, weight = 0
  for (const scenario of scenarios) {
    // Maximize BEFORE averaging over secret sets: Jack sees deployment and
    // chooses whichever of his four starts has the strongest opening.
    score += scenario.weight * Math.max(...scenario.ids.map(start => bestFromStart(start, scenario.ids, replies)))
    weight += scenario.weight
  }
  return weight ? score / weight : 0
}

