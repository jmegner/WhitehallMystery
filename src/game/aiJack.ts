import { gameReducer, legalJackDestinations, legalNormalDestinations } from './gameEngine'
import { adjacentCirclesForCrossing, circlesById, crossings, jackTransitions, reachableCrossings } from './mapData'
import type { GameAction, GameState, JackMoveType } from './types'
import { randomChoice } from './aiRandom'
import { jackEscapeForecast } from './aiJackLookahead'

export interface JackPlan { type: JackMoveType; path: number[]; score: number }
export const JACK_TIE_MARGIN = 0.5

function distancesTo(targets: number[]): Map<number, number> {
  const distances = new Map(targets.map(id => [id, 0]))
  const queue = [...targets]
  for (let i = 0; i < queue.length; i += 1) {
    const from = queue[i]!
    for (const to of jackTransitions.get(from)?.keys() ?? []) {
      if (distances.has(to)) continue
      distances.set(to, distances.get(from)! + 1)
      queue.push(to)
    }
  }
  return distances
}

function bestJackMoves(state: GameState): JackPlan[] {
  const targets = state.discoveryLocations.filter(id => !state.reachedDiscoveries.includes(id))
  const distances = distancesTo(targets)
  const threats = new Map<number, number>()
  for (const start of Object.values(state.investigatorPositions)) {
    const accessible = new Set([...reachableCrossings(start, 2)]
      .filter(id => id === start || !Object.values(state.investigatorPositions).includes(id))
      .flatMap(adjacentCirclesForCrossing))
    for (const id of accessible) threats.set(id, (threats.get(id) ?? 0) + 1)
  }
  const candidates: JackPlan[] = []
  const consider = (type: JackMoveType, path: number[]) => {
    const destination = path.at(-1)!
    const cost = type === 'coach' ? 2 : 1
    const distance = distances.get(destination) ?? 100
    const remaining = 15 - state.moveSlot - cost
    const exits = legalNormalDestinations(state, destination)
    const safeExits = exits.filter(id => !threats.has(id)).length
    const adjacentCrossings = crossings.filter(crossing => adjacentCirclesForCrossing(crossing.id).includes(destination)).length
    const visits = state.roundTrail.slice(-6).filter(id => id === destination).length
    const urgency = Math.max(0, 7 - remaining)
    // Safety dominates ordinary progress; a retreat is always a candidate.
    // At the deadline, making the discovery beats guaranteed timeout.
    const score = -(threats.get(destination) ?? 0) * 100
      - (exits.length === 0 ? 250 : 0) + Math.min(exits.length, 12) * 0.8
      + safeExits * 1.5 + adjacentCrossings * 1.5
      - distance * (7 + urgency * 4) + (distance === 0 ? 35 : 0)
      - visits * 5 - (type === 'normal' ? 0 : 10 + cost * 2)
      - (distance > remaining ? 600 + (distance - remaining) * 50 : 0)
    candidates.push({ type, path, score })
  }
  for (const type of ['normal', 'alley', 'boat', 'coach'] as const) {
    const planning = { ...state, jackMoveSelection: { type, path: [] } }
    for (const first of legalJackDestinations(planning)) {
      if (type !== 'coach') consider(type, [first])
      else for (const second of legalJackDestinations({ ...planning, jackMoveSelection: { type, path: [first] } })) consider(type, [first, second])
    }
  }
  let bestScore = -Infinity
  const rated: JackPlan[] = []
  const penalties = new Map<string, number>()
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    // Lookahead only subtracts risk, so lower base scores cannot overtake this
    // bound. Avoid expensive forecasts for moves already clearly inferior.
    if (candidate.score < bestScore - JACK_TIE_MARGIN) break
    const destination = candidate.path.at(-1)!
    const key = `${candidate.type}:${destination}`
    let penalty = penalties.get(key)
    if (penalty === undefined) {
      const discovered = targets.includes(destination)
      const wins = discovered && targets.length === 1
      if (wins) penalty = 0
      else {
        const specialRemaining = { ...state.specialRemaining }
        if (candidate.type !== 'normal') specialRemaining[candidate.type] -= 1
        const next: GameState = { ...state, currentJack: destination, specialRemaining,
          moveSlot: discovered ? 0 : state.moveSlot + (candidate.type === 'coach' ? 2 : 1),
          reachedDiscoveries: discovered ? [...state.reachedDiscoveries, destination] : state.reachedDiscoveries,
          jackMoveSelection: { type: 'normal', path: [] } }
        const forecast = jackEscapeForecast(next)
        penalty = forecast.minimumLegalExits === 0 ? 80 : forecast.minimumSafeExits === 0 ? 24
          : 3 * Math.max(0, 2 - forecast.minimumSafeExits) + 2 * Math.max(0, 2 - forecast.minimumStreetExits)
      }
      penalties.set(key, penalty)
    }
    const plan = { ...candidate, score: candidate.score - penalty }
    bestScore = Math.max(bestScore, plan.score)
    rated.push(plan)
  }
  return rated.filter(plan => plan.score >= bestScore - JACK_TIE_MARGIN).sort((a, b) => b.score - a.score)
}

export function chooseJackMove(state: GameState, random = Math.random): JackPlan | null {
  return randomChoice(bestJackMoves(state), random) ?? null
}

export function chooseJackStart(state: GameState, random = Math.random): number {
  const starts: Array<{ id: number; score: number }> = []
  for (const id of state.discoveryLocations) {
    if (!circlesById.has(id)) continue
    const started = gameReducer(state, { type: 'chooseJackStart', circleId: id })
    const plan = bestJackMoves(started)[0]
    if (plan) starts.push({ id, score: plan.score })
  }
  const best = Math.max(...starts.map(start => start.score))
  return randomChoice(starts.filter(start => best - start.score < 1e-9), random)?.id ?? state.discoveryLocations[0]!
}

export function jackMoveActions(state: GameState, random = Math.random): GameAction[] {
  const plan = chooseJackMove(state, random)
  if (!plan) return []
  return [
    // Undo can resume halfway through a Coach route. Clear that draft before
    // selecting a new route, even when the AI chooses Coach again.
    ...(state.jackMoveSelection.type === 'coach' && state.jackMoveSelection.path.length > 0
      ? [{ type: 'setJackMoveType' as const, moveType: 'normal' as const }] : []),
    { type: 'setJackMoveType', moveType: plan.type },
    ...plan.path.map(circleId => ({ type: 'selectJackDestination' as const, circleId })),
    { type: 'confirmJackMove' },
  ]
}
