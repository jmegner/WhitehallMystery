import type { SearchOutcome } from './inference'
import { adjacentCirclesForCrossing, alleyDestinations, boatDestinations, circlesById, jackTransitions } from './mapData'
import { INVESTIGATOR_ORDER, type GameState, type InvestigatorColor } from './types'
import { rankWithRandomTies } from './aiRandom'
import { viableJackLocations, type InvestigatorWeights } from './aiInvestigatorWeights'

// Shared tactics use public knowledge only, never Jack's secret trail or position.
export type InvestigatorKnowledge = Pick<GameState, 'stage' | 'activeInvestigator' | 'investigatorPositions' |
  'publicRound' | 'clueLocations' | 'reachedDiscoveries' | 'checkedThisAction' | 'inspectorActionMode' | 'moveSlot' | 'specialRemaining'>
export type Positions = Partial<Record<InvestigatorColor, string>>
export const intersection = (a: Set<number>, b: Set<number>) => new Set([...a].filter(id => b.has(id)))

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
export function futureStreetLocations(possible: Set<number>, positions: Positions, weights?: InvestigatorWeights, turns = 1): Set<number> {
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
      if (used.has(color) || !adjacentCirclesForCrossing(positions[color] ?? '').includes(ids[index]!)) continue
      const rest = assign(index + 1, new Set([...used, color]))
      if (rest) return { ...rest, [color]: ids[index]! }
    }
    return null
  }
  return assign(0, new Set())
}

// Each search's yes/no branches partition the public hypotheses (their current
// positions can overlap). Reuse these results instead of running inference twice.
export function possibleLocationsFromOutcomes(outcomes: Map<number, SearchOutcome>): Set<number> {
  const possible = new Set<number>()
  for (const outcome of outcomes.values()) {
    for (const id of outcome.ifYes) possible.add(id)
    for (const id of outcome.ifNo) possible.add(id)
  }
  return possible
}

export function usefulSearch(outcome: SearchOutcome, possible: Set<number>): boolean {
  const yes = intersection(possible, outcome.ifYes).size
  const no = intersection(possible, outcome.ifNo).size
  return yes > 0 && no > 0 && (yes < possible.size || no < possible.size)
}

export interface InvestigatorTargets { searches: number[]; arrests: number[] }

export function investigatorTargets(ids: number[], outcomes: Map<number, SearchOutcome>, possible: Set<number>,
  resolved: ReadonlySet<number> = new Set(), checked: number[] = []): InvestigatorTargets {
  return {
    searches: ids.filter(id => {
      const outcome = outcomes.get(id)
      return !resolved.has(id) && !checked.includes(id) && outcome !== undefined && usefulSearch(outcome, possible)
    }),
    // A clue proves a visit, not a departure. It must not suppress an arrest.
    arrests: checked.length ? [] : ids.filter(id => possible.has(id)),
  }
}

export function soleArrestTarget(targets: InvestigatorTargets, outcomes: Map<number, SearchOutcome>): number | undefined {
  const fruitful = new Set([...targets.searches, ...targets.arrests])
  if (fruitful.size !== 1 || targets.arrests.length !== 1) return undefined
  const id = targets.arrests[0]!
  return !targets.searches.includes(id) || outcomes.get(id)?.positiveMeansJackIsThereNow ? id : undefined
}

export function preferredArrest(targets: InvestigatorTargets, outcomes: Map<number, SearchOutcome>, possible: Set<number>,
  positions: Positions, weights?: InvestigatorWeights, random?: () => number): number | undefined {
  const sole = soleArrestTarget(targets, outcomes)
  if (sole !== undefined || targets.searches.length) return sole
  // When only arrests can help, choose the miss that leaves the least room for
  // Jack next turn. Unlike a clue, an arrest miss rules out only its target now.
  const scores = new Map(targets.arrests.map(id => [id,
    weightedNextPossibilities(new Set([...possible].filter(other => other !== id)), positions, weights),
  ]))
  const compare = (a: number, b: number) => scores.get(a)! - scores.get(b)!
  return (random ? rankWithRandomTies(targets.arrests, compare, random)
    : [...targets.arrests].sort((a, b) => compare(a, b) || a - b))[0]
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

