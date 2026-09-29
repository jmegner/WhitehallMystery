import { buildInferenceContext, publicMovementPaths } from './inference'
import { adjacentCirclesForCrossing, circles, circlesById, crossings, jackTransitions, reachableCrossings } from './mapData'
import { easyDiscoveryScenarios } from './aiDiscoveries'
import { streetDistances, viableJackLocations, type InvestigatorWeights } from './aiInvestigatorWeights'
import type { InvestigatorKnowledge, Positions } from './investigatorTactics'
import type { PublicMoveEvidence, Quadrant } from './types'

export interface GoalModel { quadrant: Quadrant; potential: ReadonlyMap<number, number> }
export interface BeliefHistory { position: number; goal: number; visited: bigint; probability: number }
export interface InvestigatorBelief { histories: BeliefHistory[]; goals: GoalModel[] }
export const locationBit = (id: number) => 1n << BigInt(id)

const goalCache = new Map<string, GoalModel[]>()
export function investigatorGoalModels(state: InvestigatorKnowledge, weights: InvestigatorWeights): GoalModel[] {
  const reached = [...new Set([...state.reachedDiscoveries, ...state.publicRound ? [state.publicRound.start] : []])]
  const key = `${reached.join(',')}/${[...weights.targets].join(',')}`
  const cached = goalCache.get(key)
  if (cached) return cached
  const prior = new Map<number, number>()
  for (const scenario of easyDiscoveryScenarios()) {
    if (!reached.every(id => scenario.ids.includes(id))) continue
    if (scenario.ids.some(id => !reached.includes(id) && !weights.targets.has(id))) continue
    for (const id of scenario.ids) if (weights.targets.has(id)) prior.set(id, (prior.get(id) ?? 0) + scenario.weight)
  }
  const goals: GoalModel[] = []
  for (const quadrant of ['NW', 'NE', 'SW', 'SE'] as const) {
    const targets = [...weights.targets].filter(id => circlesById.get(id)!.quadrant === quadrant)
    if (!targets.length) continue
    const total = targets.reduce((sum, id) => sum + (prior.get(id) ?? 0), 0)
    // Easy is a prior, never a deduction. Every eligible white location keeps
    // support, including human games whose discoveries were not sampled Easy.
    const probabilities = targets.map(id => ({ id, probability: total ?
      0.9 * (prior.get(id) ?? 0) / total + 0.1 / targets.length : 1 / targets.length }))
    const potential = new Map(circles.map(({ id }) => [id, Math.log2(probabilities.reduce((sum, goal) =>
      sum + goal.probability * 2 ** (-streetDistances.get(id)!.get(goal.id)! / 2), 0))]))
    goals.push({ quadrant, potential })
  }
  if (goalCache.size > 32) goalCache.clear()
  goalCache.set(key, goals)
  return goals
}

const adjacentCounts = new Map(circles.map(({ id }) => [id,
  crossings.filter(crossing => adjacentCirclesForCrossing(crossing.id).includes(id)).length,
]))

export function routePolicy(positions: Positions, goals: GoalModel[]) {
  const occupied = new Set(Object.values(positions))
  const threats = new Map<number, number>()
  for (const start of occupied) {
    const threatened = new Set([...reachableCrossings(start, 2)]
      .filter(id => id === start || !occupied.has(id)).flatMap(adjacentCirclesForCrossing))
    for (const id of threatened) threats.set(id, (threats.get(id) ?? 0) + 1)
  }
  const mobility = new Map(circles.map(({ id }) => [id, [...jackTransitions.get(id)!.values()]
    .filter(paths => paths.some(path => path.every(crossing => !occupied.has(crossing)))).length]))
  return (paths: number[][], goal: number, remaining: number): number[] => {
    const counts = new Map<number, number>()
    for (const path of paths) counts.set(path.at(-1)!, (counts.get(path.at(-1)!) ?? 0) + 1)
    const utilities = [...counts.keys()].map(id => ({ id, value:
      (1.4 + Math.max(0, 6 - remaining) / 3) * (goals[goal]?.potential.get(id) ?? 0) -
      1.5 * (threats.get(id) ?? 0) + 0.3 * Math.log1p(mobility.get(id)!) + 0.08 * adjacentCounts.get(id)!,
    }))
    const best = Math.max(...utilities.map(item => item.value))
    const desirability = new Map(utilities.map(item => [item.id, Math.exp(item.value - best)]))
    const total = [...desirability.values()].reduce((sum, value) => sum + value, 0)
    // Ten percent TOTAL exploration permits deception/backtracking. Coach
    // endpoints with many intermediate paths do not get extra probability.
    return paths.map(path => {
      const id = path.at(-1)!
      return (0.9 * desirability.get(id)! / total + 0.1 / counts.size) / counts.get(id)!
    })
  }
}

interface Link { previous: Node; visited: bigint; mass: number }
interface Node { position: number; goal: number; mask: bigint; mass: number; incoming: Link[] }

// Forward inference retains every (position, observed-clue mask, goal quadrant)
// state. Backward sampling supplies bounded complete trails for correlated
// hypothetical searches; endpoint/goal probability masses remain exact under
// this heuristic policy. No forward particle pruning can erase a rare clue.
export function createInvestigatorBelief(state: InvestigatorKnowledge, weights: InvestigatorWeights): InvestigatorBelief {
  const goals = investigatorGoalModels(state, weights)
  const evidence = state.publicRound
  if (!evidence || !goals.length) return { histories: [], goals }
  const { bitForCircle, negativeUntil, observationsByMove } = buildInferenceContext(evidence)
  if ((negativeUntil.get(evidence.start) ?? -1) >= 0) return { histories: [], goals }
  let frontier: Node[] = goals.map((_, goal) => ({ position: evidence.start, goal,
    mask: bitForCircle.get(evidence.start) ?? 0n, mass: 1 / goals.length, incoming: [] }))
  for (const [index, move] of evidence.moves.entries()) {
    const moveIndex = index + 1
    const policy = routePolicy(move.investigatorPositions, goals)
    const routes = new Map<number, number[][]>()
    const probabilities = new Map<string, number[]>()
    const next = new Map<string, Node>()
    for (const previous of frontier) {
      let paths = routes.get(previous.position)
      if (!paths) { paths = publicMovementPaths(previous.position, move); routes.set(previous.position, paths) }
      const policyKey = `${previous.position}/${previous.goal}`
      let probabilitiesHere = probabilities.get(policyKey)
      if (!probabilitiesHere) { probabilitiesHere = policy(paths, previous.goal, 15 - move.endSlot); probabilities.set(policyKey, probabilitiesHere) }
      for (const [routeIndex, path] of paths.entries()) {
        if (path.some(id => (negativeUntil.get(id) ?? -1) >= moveIndex)) continue
        let mask = previous.mask
        let visited = 0n
        for (const id of path) { mask |= bitForCircle.get(id) ?? 0n; visited |= locationBit(id) }
        const position = path.at(-1)!
        if ((observationsByMove.get(moveIndex) ?? []).some(observation => observation.kind === 'arrest' ?
          position === observation.circleId : observation.found && (mask & bitForCircle.get(observation.circleId)!) === 0n)) continue
        const key = `${position}/${previous.goal}/${mask}`
        let node = next.get(key)
        if (!node) { node = { position, goal: previous.goal, mask, mass: 0, incoming: [] }; next.set(key, node) }
        const mass = previous.mass * probabilitiesHere[routeIndex]!
        node.mass += mass
        node.incoming.push({ previous, visited, mass })
      }
    }
    frontier = [...next.values()]
    const total = frontier.reduce((sum, node) => sum + node.mass, 0)
    if (!total) return { histories: [], goals }
    for (const node of frontier) {
      node.mass /= total
      for (const link of node.incoming) link.mass /= total
    }
  }
  const viable = viableJackLocations(new Set(frontier.map(node => node.position)), weights)
  frontier = frontier.filter(node => viable.has(node.position))
  const total = frontier.reduce((sum, node) => sum + node.mass, 0)
  const histories = new Map<string, BeliefHistory>()
  // Deterministic samples are reproducible across refreshes and unaffected by
  // Jack's private state or the investigator's proposed future positions.
  let seed = 2166136261
  for (const character of JSON.stringify(evidence)) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
  for (const endpoint of frontier) {
    const probability = endpoint.mass / total
    const count = Math.max(1, Math.round(512 * probability))
    for (let sample = 0; sample < count; sample++) {
      let visited = locationBit(evidence.start)
      let node = endpoint
      while (node.incoming.length) {
        let threshold = random() * node.mass
        let selected = node.incoming.at(-1)!
        for (const link of node.incoming) {
          threshold -= link.mass
          if (threshold <= 0) { selected = link; break }
        }
        visited |= selected.visited
        node = selected.previous
      }
      const key = `${endpoint.position}/${endpoint.goal}/${visited}`
      const existing = histories.get(key)
      if (existing) existing.probability += probability / count
      else histories.set(key, { position: endpoint.position, goal: endpoint.goal, visited, probability: probability / count })
    }
  }
  return { histories: [...histories.values()], goals }
}

export function beliefLocations(histories: BeliefHistory[]): Map<number, number> {
  const probabilities = new Map<number, number>()
  for (const history of histories) probabilities.set(history.position, (probabilities.get(history.position) ?? 0) + history.probability)
  return probabilities
}

export function publicMove(type: PublicMoveEvidence['type'], positions: Positions): PublicMoveEvidence {
  return { type, startSlot: 1, endSlot: type === 'coach' ? 2 : 1,
    investigatorPositions: positions as PublicMoveEvidence['investigatorPositions'] }
}
