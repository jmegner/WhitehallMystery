import { possibleJackLocations, possibleJackSearchOutcomes, type SearchOutcome } from './inference'
import { adjacentCirclesForCrossing, crossings, investigatorNeighbors, jackTransitions, reachableCrossings, startingCrossings } from './mapData'
import { INVESTIGATOR_ORDER, type GameAction, type GameState } from './types'
import { randomChoice, rankWithRandomTies } from './aiRandom'
import { createInvestigatorWeights, viableJackLocations, type InvestigatorWeights } from './aiInvestigatorWeights'
import { coveringArrests, futureStreetLocations, intersection, investigatorTargets, orderedSearches, preferredArrest, usefulSearch, weightedNextPossibilities, type InvestigatorKnowledge, type Positions } from './investigatorTactics'
export { coveringArrests, nextStreetLocations, orderedSearches, weightedNextPossibilities, type InvestigatorKnowledge } from './investigatorTactics'

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

function targetsAt(state: InvestigatorKnowledge, crossing: string, outcomes: Map<number, SearchOutcome>, possible: Set<number>) {
  return investigatorTargets(adjacent.get(crossing) ?? [], outcomes, possible,
    new Set([...state.clueLocations, ...state.reachedDiscoveries.slice(-1)]), state.checkedThisAction)
}

export function investigatorAction(state: InvestigatorKnowledge, random = Math.random): GameAction[] {
  const weights = createInvestigatorWeights(state)
  const possible = viableJackLocations(possibleJackLocations(state.publicRound), weights)
  const outcomes = possibleJackSearchOutcomes(state.publicRound)
  const colors = INVESTIGATOR_ORDER.slice(state.activeInvestigator)
  const color = colors[0]!
  const crossing = state.investigatorPositions[color] ?? ''
  const targets = targetsAt(state, crossing, outcomes, possible)
  const canArrest = state.checkedThisAction.length === 0
  const arrests = coveringArrests(possible, state.investigatorPositions, canArrest ? colors : colors.slice(1))
  if (arrests && arrests[color] === undefined) return [{ type: 'passInspectorAction' }]
  const arrest = arrests?.[color] ?? preferredArrest(targets, outcomes, possible, state.investigatorPositions, weights, random)
  if (arrest !== undefined) return [{ type: 'setInspectorActionMode', mode: 'arrest' }, { type: 'arrestCircle', circleId: arrest }]
  if (!targets.searches.length) return [{ type: 'passInspectorAction' }]
  const id = orderedSearches(targets.searches, outcomes, possible, state.investigatorPositions, random, weights)[0]!
  return [{ type: 'setInspectorActionMode', mode: 'search' }, { type: 'searchCircle', circleId: id }]
}

interface Scenario { possible: Set<number>; weight: number; resolved: Set<number> }

// A greedy public-belief estimate, with both search outcomes and early stopping
// on a clue. Shared locations/outcome overlap are evaluated jointly. Membership
// counts supply heuristic weights, not claims about Jack's true probabilities.
// Actual actions re-run exact inference after every observed answer.
export function expectedNextPossibilities(possible: Set<number>, positions: Positions,
  actionable: number[][], outcomes: Map<number, SearchOutcome>, colors = INVESTIGATOR_ORDER, weights?: InvestigatorWeights): number {
  // Conditioning on survivable locations prevents a search that only separates
  // doomed hypotheses from viable ones from receiving an information reward.
  possible = viableJackLocations(possible, weights)
  let scenarios: Scenario[] = [{ possible, weight: 1, resolved: new Set() }]
  for (const [index, ids] of actionable.entries()) {
    const finished: Scenario[] = []
    for (const scenario of scenarios) {
      if (coveringArrests(scenario.possible, positions, colors.slice(index, actionable.length))) continue
      let remaining = scenario
      const targets = investigatorTargets(ids, outcomes, scenario.possible, scenario.resolved)
      const arrest = preferredArrest(targets, outcomes, scenario.possible, positions, weights)
      if (arrest !== undefined) {
        const missed = new Set([...scenario.possible].filter(id => id !== arrest))
        if (missed.size) finished.push({ ...scenario, possible: missed, weight: scenario.weight * missed.size / scenario.possible.size })
        continue
      }
      const unchecked = new Set(targets.searches)
      while (unchecked.size && remaining.possible.size) {
        const useful = [...unchecked].filter(id => usefulSearch(outcomes.get(id)!, remaining.possible))
        if (!useful.length) break
        const id = orderedSearches(useful, outcomes, remaining.possible, positions, undefined, weights)[0]!
        unchecked.delete(id)
        const outcome = outcomes.get(id)!
        const yes = intersection(remaining.possible, outcome.ifYes)
        const no = intersection(remaining.possible, outcome.ifNo)
        const total = yes.size + no.size
        if (!total) break
        const resolved = new Set([...remaining.resolved, id])
        if (yes.size) finished.push({ possible: yes, weight: remaining.weight * yes.size / total, resolved })
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
  for (const crossing of crossings) {
    const targets = targetsAt({ ...state, checkedThisAction: [] }, crossing.id, outcomes, possible)
    options.set(crossing.id, [...new Set([...targets.searches, ...targets.arrests])])
  }
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
