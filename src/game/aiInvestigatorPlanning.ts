import { publicMovementPaths, type SearchOutcome } from './inference'
import { INVESTIGATOR_ORDER, type InvestigatorColor, type JackMoveType } from './types'
import { coveringArrests, intersection, soleArrestTarget, type InvestigatorKnowledge, type InvestigatorTargets, type Positions } from './investigatorTactics'
import { createInvestigatorBelief, locationBit, publicMove, routePolicy, type BeliefHistory, type InvestigatorBelief } from './aiInvestigatorBelief'
import type { InvestigatorWeights } from './aiInvestigatorWeights'
import { distanceToCircle } from './aiInvestigatorGeometry'

interface Forecast { next: Map<number, number>; interception: number }
interface Route { position: number; remaining: number; alley: number; boat: number; coach: number; mass: number }
interface Scenario { histories: BeliefHistory[]; possible: Set<number>; resolved: Set<number> }

export class InvestigatorPlanning {
  readonly belief: InvestigatorBelief
  readonly state: InvestigatorKnowledge
  readonly weights: InvestigatorWeights
  readonly outcomes: Map<number, SearchOutcome>
  readonly possible: Set<number>
  constructor(state: InvestigatorKnowledge, weights: InvestigatorWeights,
    outcomes: Map<number, SearchOutcome>, possible: Set<number>) {
    this.state = state
    this.weights = weights
    this.outcomes = outcomes
    this.possible = possible
    this.belief = createInvestigatorBelief(state, weights)
  }

  forPositions(positions: Positions) {
    const { weights, belief, outcomes } = this
    const policy = routePolicy(positions, belief.goals)
    const forecastCache = new Map<string, Forecast>()
    const pathsCache = new Map<string, number[][]>()
    const responseCache = new Map<string, number>()
    const transitionCache = new Map<string, Route[]>()
    const continuationCache = new Map<Route[], number>()
    const starts = Object.values(positions)
    const responseCost = (id: number, turn: number) => {
      const key = `${id}/${turn}`
      const cached = responseCache.get(key)
      if (cached !== undefined) return cached
      const distances = starts.map(start => distanceToCircle.get(start)?.get(id) ?? 30).sort((a, b) => a - b)
      const late = (distance: number) => 1 - 2 ** -Math.max(0, Math.ceil(distance / 2) - turn)
      // Credit the nearest responder most, with smaller rewards for backup.
      const value = late(distances[0] ?? 30) + 0.15 * late(distances[1] ?? 30) + 0.03 * late(distances[2] ?? 30) +
        distances.reduce((sum, distance, index) => sum + distance * [0.012, 0.002, 0.001][index]!, 0)
      responseCache.set(key, value)
      return value
    }
    const pathsFrom = (id: number, type: JackMoveType) => {
      const key = `${id}/${type}`
      let paths = pathsCache.get(key)
      if (!paths) { paths = publicMovementPaths(id, publicMove(type, positions)); pathsCache.set(key, paths) }
      return paths
    }
    const advance = (route: Route, goal: number): Route[] => {
      const key = `${route.position}/${goal}/${route.remaining}/${route.alley}/${route.boat}/${route.coach}`
      const cached = transitionCache.get(key)
      if (cached) return cached
      const options = (type: JackMoveType) => pathsFrom(route.position, type).flatMap(path => {
        if (type !== 'normal' && route[type] < 1) return []
        const remaining = route.remaining - (type === 'coach' ? 2 : 1)
        const position = path.at(-1)!
        const alley = route.alley - Number(type === 'alley'), boat = route.boat - Number(type === 'boat')
        const discovered = type === 'normal' && weights.targets.has(position)
        if (remaining < 0 || (!discovered && weights.minimumDiscoveryMoves(position, alley, boat) > remaining)) return []
        return [{ path, position, remaining: discovered ? 15 : remaining, alley, boat,
          coach: route.coach - Number(type === 'coach') }]
      })
      let replies = options('normal')
      // Street forecast, with finite special rescue routes if every Street reply loses.
      if (!replies.length) replies = (['alley', 'boat', 'coach'] as const).flatMap(options)
      const probabilities = policy(replies.map(reply => reply.path), goal, route.remaining - 1)
      const next = replies.map((reply, index) => ({ ...reply, mass: probabilities[index]! }))
      transitionCache.set(key, next)
      return next
    }
    const forecast = (position: number, goal: number): Forecast => {
      const key = `${position}/${goal}`
      const cached = forecastCache.get(key)
      if (cached) return cached
      const next = new Map<number, number>()
      let interception = weights.pendingDiscoveryAllowed && weights.targets.has(position) ? 0.5 : 0
      const source = { position, mass: 1, ...weights.specialRemaining,
        remaining: weights.pendingDiscoveryAllowed && weights.targets.has(position) ? 15 : weights.remainingMoves }
      for (const route of advance(source, goal)) {
        next.set(route.position, (next.get(route.position) ?? 0) + route.mass)
        const continuations = advance(route, goal)
        let secondRisk = continuationCache.get(continuations)
        if (secondRisk === undefined) {
          secondRisk = continuations.reduce((sum, reply) => sum + reply.mass *
            (weights.locationWeights.get(reply.position) ?? 0) * responseCost(reply.position, 2), 0)
          continuationCache.set(continuations, secondRisk)
        }
        interception += route.mass * (0.6 * (weights.locationWeights.get(route.position) ?? 0) *
          responseCost(route.position, 1) + 0.4 * secondRisk)
      }
      const result = { next, interception }
      forecastCache.set(key, result)
      return result
    }
    const score = (histories: BeliefHistory[]) => {
      const sources = new Map<string, { position: number; goal: number; mass: number }>()
      for (const history of histories) {
        const key = `${history.position}/${history.goal}`
        const existing = sources.get(key)
        if (existing) existing.mass += history.probability
        else sources.set(key, { ...history, mass: history.probability })
      }
      const next = new Map<number, number>()
      let risk = 0, surviving = 0
      for (const source of sources.values()) {
        const predicted = forecast(source.position, source.goal)
        risk += source.mass * predicted.interception
        for (const [id, probability] of predicted.next) {
          const mass = source.mass * probability
          next.set(id, (next.get(id) ?? 0) + mass)
          surviving += mass
        }
      }
      let uncertainty = 0
      for (const [id, mass] of next) if (mass > 0) {
        uncertainty -= (weights.locationWeights.get(id) ?? 0) * mass * Math.log2(mass / surviving) / Math.log2(189)
      }
      // Information and interception share the primary objective. Weighted
      // entropy rewards informative answers; averaging posterior threat alone
      // would give information zero value by the law of total expectation.
      return uncertainty + 1.25 * risk + 0.1 * surviving
    }
    const split = (histories: BeliefHistory[], id: number, arrest = false) => {
      const yes: BeliefHistory[] = [], no: BeliefHistory[] = []
      const bit = locationBit(id)
      for (const history of histories) {
        const found = arrest ? history.position === id : (history.visited & bit) !== 0n
        ;(found ? yes : no).push(history)
      }
      return { yes, no }
    }
    const targets = (ids: number[], scenario: Scenario, searching = false): InvestigatorTargets => ({
      searches: ids.filter(id => {
        const outcome = outcomes.get(id)
        return !scenario.resolved.has(id) && outcome && intersection(scenario.possible, outcome.ifYes).size > 0 &&
          intersection(scenario.possible, outcome.ifNo).size > 0
      }),
      arrests: searching ? [] : ids.filter(id => scenario.possible.has(id)),
    })
    const chooseSearch = (ids: number[], scenario: Scenario) => {
      const ranked = ids.map(id => {
        const { yes, no } = split(scenario.histories, id)
        const count = intersection(scenario.possible, outcomes.get(id)!.ifYes).size
        return { id, certain: count === 1 ? 0 : 1, value: score(yes) + score(no), count }
      })
      return ranked.sort((a, b) => a.certain - b.certain || a.value - b.value || a.count - b.count || a.id - b.id)[0]?.id
    }
    const chooseArrest = (available: InvestigatorTargets, scenario: Scenario) => {
      const sole = soleArrestTarget(available, outcomes)
      if (sole !== undefined || available.searches.length) return sole
      return available.arrests.map(id => ({ id, value: score(split(scenario.histories, id, true).no) }))
        .sort((a, b) => a.value - b.value || a.id - b.id)[0]?.id
    }
    const initial: Scenario = { histories: belief.histories, possible: this.possible,
      resolved: new Set([...this.state.clueLocations, ...this.state.reachedDiscoveries.slice(-1), ...this.state.checkedThisAction]) }
    return {
      score,
      chooseAction: (ids: number[]) => {
        const available = targets(ids, initial, this.state.checkedThisAction.length > 0)
        const arrest = chooseArrest(available, initial)
        return arrest !== undefined ? { type: 'arrest' as const, id: arrest } :
          { type: 'search' as const, id: chooseSearch(available.searches, initial) }
      },
      expectedScore: (actionable: number[][], colors: InvestigatorColor[] = INVESTIGATOR_ORDER) => {
        let scenarios = [initial]
        for (const [index, ids] of actionable.entries()) {
          const finished: Scenario[] = []
          for (const scenario of scenarios) {
            // Guarantee uses the conservative exact support, never samples.
            if (coveringArrests(scenario.possible, positions, colors.slice(index, actionable.length))) continue
            const available = targets(ids, scenario)
            const arrest = chooseArrest(available, scenario)
            if (arrest !== undefined) {
              const no = split(scenario.histories, arrest, true).no
              if (no.length) finished.push({ ...scenario, histories: no,
                possible: new Set([...scenario.possible].filter(id => id !== arrest)) })
              continue
            }
            let remaining = scenario
            const unchecked = new Set(available.searches)
            while (unchecked.size && remaining.histories.length) {
              const id = chooseSearch([...unchecked], remaining)!
              unchecked.delete(id)
              const { yes, no } = split(remaining.histories, id)
              const outcome = outcomes.get(id)!
              const resolved = new Set([...remaining.resolved, id])
              if (yes.length) finished.push({ histories: yes, possible: intersection(remaining.possible, outcome.ifYes), resolved })
              remaining = { histories: no, possible: intersection(remaining.possible, outcome.ifNo), resolved }
            }
            if (remaining.histories.length) finished.push(remaining)
          }
          scenarios = finished
        }
        return scenarios.reduce((sum, scenario) => sum + score(scenario.histories), 0)
      },
    }
  }
}
