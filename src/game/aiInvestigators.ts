import { possibleJackLocations, possibleJackSearchOutcomes, type SearchOutcome } from './inference'
import { adjacentCirclesForCrossing, alleyDestinations, boatDestinations, circlesById, crossings, investigatorNeighbors, jackTransitions, reachableCrossings, startingCrossings } from './mapData'
import { INVESTIGATOR_ORDER, type GameAction, type GameState, type InvestigatorColor } from './types'
import { randomChoice, rankWithRandomTies } from './aiRandom'
import { createInvestigatorWeights, viableJackLocations, type InvestigatorWeights } from './aiInvestigatorWeights'

// Deliberately excludes Jack's secret position, trail, discoveries and selections.
export type InvestigatorKnowledge = Pick<GameState, 'stage' | 'activeInvestigator' | 'investigatorPositions' |
  'publicRound' | 'clueLocations' | 'reachedDiscoveries' | 'checkedThisAction' | 'inspectorActionMode' | 'moveSlot' | 'specialRemaining'>
type Positions = Partial<Record<InvestigatorColor, string>>
const adjacent = new Map(crossings.map(crossing => [crossing.id, adjacentCirclesForCrossing(crossing.id)]))
const crossingDistances = new Map(crossings.map(crossing => {
  const distances = new Map<string, number>([[crossing.id, 0]])
  const queue = [crossing.id]
  for (let i = 0; i < queue.length; i += 1) {
    for (const next of investigatorNeighbors.get(queue[i]!) ?? []) {
      if (distances.has(next)) continue
      distances.set(next, distances.get(queue[i]!)! + 1)
      queue.push(next)
    }
  }
  return [crossing.id, distances] as const
}))
const distanceToCircle = new Map(crossings.map(start => [start.id, new Map([...jackTransitions.keys()].map(id => [id,
  Math.min(...crossings.filter(crossing => adjacent.get(crossing.id)!.includes(id)).map(crossing => crossingDistances.get(start.id)!.get(crossing.id)!)),
]))]))
const intersection = (a: Set<number>, b: Set<number>) => new Set([...a].filter(id => b.has(id)))

export function nextStreetLocations(possible: Set<number>, positions: Positions): Set<number> {
  const blocked = new Set(Object.values(positions))
  const next = new Set<number>()
  for (const from of possible) {
    for (const [to, paths] of jackTransitions.get(from) ?? []) {
      if (paths.some(path => path.every(crossing => !blocked.has(crossing)))) next.add(to)
    }
  }
  return next
}

// Each location is counted once. If routes leave different amounts of time,
// retain the most optimistic one. Landing on a possible discovery may reset the
// round before the following move, so it must never look like a timeout trap.
function futureStreetLocations(possible: Set<number>, positions: Positions, weights?: InvestigatorWeights, turns = 1): Set<number> {
  if (!weights) {
    let frontier = possible
    for (let turn = 0; turn < turns; turn += 1) frontier = nextStreetLocations(frontier, positions)
    return frontier
  }
  const blocked = new Set(Object.values(positions))
  type Route = { id: number; remaining: number; alley: number; boat: number; coach: number }
  let frontier: Route[] = [...viableJackLocations(possible, weights)].map(id => ({ id,
    remaining: weights.pendingDiscoveryAllowed && weights.targets.has(id) ? 15 : weights.remainingMoves,
    ...weights.specialRemaining,
  }))
  for (let turn = 0; turn < turns; turn += 1) {
    const next = new Map<string, Route>()
    for (const route of frontier) {
      const add = (to: number, special?: 'alley' | 'boat' | 'coach'): boolean => {
        const candidate = { ...route, id: to, remaining: route.remaining - (special === 'coach' ? 2 : 1) }
        if (special) candidate[special] -= 1
        if (candidate.remaining < 0) return false
        const discovered = !special && weights.targets.has(to)
        if (!discovered && weights.minimumDiscoveryMoves(to, candidate.alley, candidate.boat) > candidate.remaining) return false
        if (discovered) candidate.remaining = 15
        const key = `${to}/${candidate.alley}/${candidate.boat}/${candidate.coach}`
        if (candidate.remaining > (next.get(key)?.remaining ?? -1)) next.set(key, candidate)
        return true
      }
      let streetSurvives = false
      for (const [to, paths] of jackTransitions.get(route.id) ?? []) {
        if (paths.some(path => path.every(crossing => !blocked.has(crossing)))) streetSurvives = add(to) || streetSurvives
      }
      // Forecast Street moves normally. If every Street reply loses, retain
      // legal special escapes rather than scoring a rescuable branch as zero.
      if (!streetSurvives) {
        if (route.alley > 0) for (const to of alleyDestinations.get(route.id)!) add(to, 'alley')
        if (route.boat > 0) for (const to of boatDestinations.get(route.id)!) add(to, 'boat')
        if (route.coach > 0 && route.remaining >= 2) {
          for (const first of jackTransitions.get(route.id)!.keys()) {
            if (circlesById.get(first)!.color === 'blue') continue
            for (const to of jackTransitions.get(first)!.keys()) {
              if (to !== route.id && circlesById.get(to)!.color !== 'blue') add(to, 'coach')
            }
          }
        }
      }
    }
    frontier = [...next.values()]
  }
  return new Set(frontier.map(route => route.id))
}

export function weightedNextPossibilities(possible: Set<number>, positions: Positions, weights?: InvestigatorWeights): number {
  let score = 0
  for (const id of futureStreetLocations(possible, positions, weights)) score += weights?.locationWeights.get(id) ?? 1
  return score
}

// Find a matching, not just coverage: each piece can arrest only once.
export function coveringArrests(possible: Set<number>, positions: Positions, colors = INVESTIGATOR_ORDER): Partial<Record<InvestigatorColor, number>> | null {
  if (!possible.size || possible.size > colors.length) return null
  const ids = [...possible]
  const assign = (index: number, used: Set<InvestigatorColor>): Partial<Record<InvestigatorColor, number>> | null => {
    if (index === ids.length) return {}
    for (const color of colors) {
      if (used.has(color) || !adjacent.get(positions[color] ?? '')?.includes(ids[index]!)) continue
      const rest = assign(index + 1, new Set([...used, color]))
      if (rest) return { ...rest, [color]: ids[index]! }
    }
    return null
  }
  return assign(0, new Set())
}

function usefulOutcome(id: number, outcome: SearchOutcome, possible: Set<number>): boolean {
  const yes = intersection(possible, outcome.ifYes).size
  const no = intersection(possible, outcome.ifNo).size
  return (outcome.positiveMeansJackIsThereNow && possible.has(id)) ||
    (yes > 0 && no > 0 && (yes < possible.size || no < possible.size))
}

function fruitful(state: InvestigatorKnowledge, crossing: string, outcomes: Map<number, SearchOutcome>, possible: Set<number>) {
  const resolved = new Set([...state.clueLocations, state.reachedDiscoveries.at(-1)])
  return (adjacent.get(crossing) ?? []).filter(id => {
    const outcome = outcomes.get(id)
    return !resolved.has(id) && !state.checkedThisAction.includes(id) && outcome && outcome.ifYes.size > 0 && outcome.ifNo.size > 0 && usefulOutcome(id, outcome, possible)
  })
}

export function orderedSearches(ids: number[], outcomes: Map<number, SearchOutcome>, possible: Set<number>, positions: Positions, random?: () => number, weights?: InvestigatorWeights): number[] {
  const compare = (a: number, b: number) => {
    const left = outcomes.get(a)!, right = outcomes.get(b)!
    const yesDifference = intersection(possible, left.ifYes).size - intersection(possible, right.ifYes).size
    if (yesDifference) return yesDifference
    return weightedNextPossibilities(intersection(possible, left.ifNo), positions, weights) - weightedNextPossibilities(intersection(possible, right.ifNo), positions, weights)
  }
  // Hypothetical scoring stays deterministic; only a real action breaks ties.
  return random ? rankWithRandomTies(ids, compare, random) : [...ids].sort((a, b) => compare(a, b) || a - b)
}

export function investigatorAction(state: InvestigatorKnowledge, random = Math.random): GameAction[] {
  const weights = createInvestigatorWeights(state)
  const possible = viableJackLocations(possibleJackLocations(state.publicRound), weights)
  const outcomes = possibleJackSearchOutcomes(state.publicRound)
  const colors = INVESTIGATOR_ORDER.slice(state.activeInvestigator)
  const color = colors[0]!
  const crossing = state.investigatorPositions[color] ?? ''
  const ids = fruitful(state, crossing, outcomes, possible)
  const canArrest = state.checkedThisAction.length === 0
  const arrests = canArrest ? coveringArrests(possible, state.investigatorPositions, colors) : null
  const arrest = arrests?.[color] ?? (canArrest && ids.length === 1 && outcomes.get(ids[0]!)?.positiveMeansJackIsThereNow ? ids[0] : undefined)
  if (arrest !== undefined) return [{ type: 'setInspectorActionMode', mode: 'arrest' }, { type: 'arrestCircle', circleId: arrest }]
  if (arrests || !ids.length) return [{ type: 'passInspectorAction' }]
  const id = orderedSearches(ids, outcomes, possible, state.investigatorPositions, random, weights)[0]!
  return [{ type: 'setInspectorActionMode', mode: 'search' }, { type: 'searchCircle', circleId: id }]
}

interface Scenario { possible: Set<number>; weight: number; resolved: Set<number> }

// A greedy public-belief estimate, with both search outcomes and early stopping
// on a clue. Shared locations/outcome overlap are evaluated jointly. Membership
// counts supply heuristic weights, not claims about Jack's true probabilities.
// Actual actions re-run exact inference after every observed answer.
export function expectedNextPossibilities(possible: Set<number>, positions: Positions,
  searchable: number[][], outcomes: Map<number, SearchOutcome>, colors = INVESTIGATOR_ORDER, weights?: InvestigatorWeights): number {
  // Conditioning on survivable locations prevents a search that only separates
  // doomed hypotheses from viable ones from receiving an information reward.
  possible = viableJackLocations(possible, weights)
  let scenarios: Scenario[] = [{ possible, weight: 1, resolved: new Set() }]
  for (const [index, ids] of searchable.entries()) {
    const finished: Scenario[] = []
    for (const scenario of scenarios) {
      if (coveringArrests(scenario.possible, positions, colors.slice(index, searchable.length))) continue
      let remaining = scenario
      const unchecked = new Set(ids.filter(id => !scenario.resolved.has(id) && usefulOutcome(id, outcomes.get(id)!, scenario.possible)))
      const soleTarget = unchecked.size === 1
      while (unchecked.size && remaining.possible.size) {
        const id = orderedSearches([...unchecked], outcomes, remaining.possible, positions, undefined, weights)[0]!
        unchecked.delete(id)
        const outcome = outcomes.get(id)!
        const yes = intersection(remaining.possible, outcome.ifYes)
        const no = intersection(remaining.possible, outcome.ifNo)
        const total = yes.size + no.size
        if (!total) break
        // A sole current-or-never target is arrested; a hit has no next turn.
        const arrest = soleTarget && outcome.positiveMeansJackIsThereNow
        const resolved = new Set([...remaining.resolved, id])
        if (yes.size && !arrest) finished.push({ possible: yes, weight: remaining.weight * yes.size / total, resolved })
        remaining = { possible: no, weight: remaining.weight * no.size / total, resolved }
      }
      if (remaining.possible.size && remaining.weight) finished.push(remaining)
    }
    scenarios = finished
  }
  return scenarios.reduce((score, scenario) => score + scenario.weight * weightedNextPossibilities(scenario.possible, positions, weights), 0)
}

export function pursuitScore(possible: Set<number>, positions: Positions, weights?: InvestigatorWeights, colors = INVESTIGATOR_ORDER): number {
  const starts = colors.map(color => positions[color]).filter((id): id is string => id !== undefined)
  let score = 0
  for (let turn = 1; turn <= 2; turn += 1) {
    const frontier = futureStreetLocations(possible, positions, weights, turn)
    for (const id of frontier) {
      const costs = starts.map(start => {
        const distance = distanceToCircle.get(start)?.get(id) ?? Infinity
        return Math.max(0, Math.ceil(distance / 2) - turn) + distance / 100
      })
      // Keep the team's nearest response strongest, but reward every piece's
      // approach. Otherwise a nearby teammate masks a distant investigator's
      // progress entirely, leaving it idle while that teammate does all the work.
      score += (weights?.locationWeights.get(id) ?? 1) *
        (Math.min(...costs) + costs.reduce((sum, cost) => sum + cost, 0) / 4)
    }
  }
  return score
}

function legalDestinations(state: InvestigatorKnowledge, positions: Positions, index: number): string[] {
  const color = INVESTIGATOR_ORDER[index]!
  if (state.stage === 'investigatorSetup') return startingCrossings.map(c => c.id).filter(id => !Object.values(positions).includes(id))
  const start = positions[color]
  return start ? [...reachableCrossings(start, 2)].filter(id => !INVESTIGATOR_ORDER.some(other => other !== color && positions[other] === id)) : []
}

export function planInvestigatorMoves(state: InvestigatorKnowledge, random = Math.random): Positions {
  const setup = state.stage === 'investigatorSetup'
  const weights = setup ? undefined : createInvestigatorWeights(state)
  const possible = setup ? new Set(jackTransitions.keys()) : viableJackLocations(possibleJackLocations(state.publicRound), weights)
  const outcomes = setup ? new Map<number, SearchOutcome>() : possibleJackSearchOutcomes(state.publicRound)
  const options = new Map<string, number[]>()
  for (const crossing of crossings) options.set(crossing.id, fruitful({ ...state, checkedThisAction: [] }, crossing.id, outcomes, possible))
  let bestScore = Infinity
  let bestPursuit = Infinity
  let finalists: Array<{ positions: Positions; pursuit: number }> = []
  let guaranteed: Positions | null = null
  // Exhaustive small-target matching happens before pruning movement choices.
  const findArrests = (positions: Positions, index: number): boolean => {
    if (index === 3) {
      if (coveringArrests(possible, positions)) { guaranteed = positions; return true }
      return false
    }
    const color = INVESTIGATOR_ORDER[index]!
    for (const id of rankWithRandomTies(legalDestinations(state, positions, index), () => 0, random)) {
      if (findArrests({ ...positions, [color]: id }, index + 1)) return true
    }
    return false
  }
  if (!setup && possible.size > 0 && possible.size <= 3 && findArrests(state.investigatorPositions, state.activeInvestigator)) return guaranteed!

  const search = (positions: Positions, index: number) => {
    if (index === 3) {
      const score = setup ? 0 : expectedNextPossibilities(possible, positions, INVESTIGATOR_ORDER.map(color => options.get(positions[color]!)!), outcomes, INVESTIGATOR_ORDER, weights)
      if (score > bestScore + 1e-9) return
      const pursuit = pursuitScore(possible, positions, weights)
      if (score < bestScore - 1e-9) { bestScore = score; bestPursuit = Infinity; finalists = [] }
      bestPursuit = Math.min(bestPursuit, pursuit)
      finalists.push({ positions, pursuit })
      return
    }
    const color = INVESTIGATOR_ORDER[index]!
    const candidates = legalDestinations(state, positions, index).map(id => {
      const next = { ...positions, [color]: id }
      return { id, score: setup ? 0 : expectedNextPossibilities(possible, next, [options.get(id)!], outcomes, [color], weights), pursuit: pursuitScore(possible, next, weights, [color]) }
    })
    const ranked = rankWithRandomTies(candidates, (a, b) => a.score - b.score || a.pursuit - b.pursuit, random)
    // A bounded joint greedy search keeps browser latency predictable.
    for (const { id } of ranked.slice(0, 6)) search({ ...positions, [color]: id }, index + 1)
  }
  search(state.investigatorPositions, state.activeInvestigator)
  // Even a small approach improvement matters when a piece cannot act yet.
  // Randomize only equal pursuit scores after preserving the next-turn metric.
  return randomChoice(finalists.filter(plan => plan.pursuit <= bestPursuit + 1e-9), random)?.positions ?? state.investigatorPositions
}

export function investigatorMoveActions(state: GameState, random = Math.random): GameAction[] {
  const plan = planInvestigatorMoves(state, random)
  return INVESTIGATOR_ORDER.slice(state.activeInvestigator).map(color => ({
    type: state.stage === 'investigatorSetup' ? 'placeInvestigator' : 'moveInvestigator', crossingId: plan[color]!,
  }))
}
