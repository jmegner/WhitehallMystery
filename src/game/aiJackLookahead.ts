import { legalJackDestinations } from './gameEngine'
import { adjacentCirclesForCrossing, jackTransitions, reachableCrossings } from './mapData'
import { INVESTIGATOR_ORDER, type GameState } from './types'

type Positions = GameState['investigatorPositions']
export interface JackEscapeForecast {
  minimumStreetExits: number
  minimumLegalExits: number
  minimumSafeExits: number
  trapPositions: Positions | null
}
const countBits = (mask: bigint) => {
  let count = 0
  for (; mask; mask &= mask - 1n) count += 1
  return count
}
const reachable = new Map<string, Set<string>>()
const threatened = new Map<string, Set<number>>()
function reach(start: string): Set<string> {
  if (!reachable.has(start)) reachable.set(start, reachableCrossings(start, 2))
  return reachable.get(start)!
}
function threats(start: string): Set<number> {
  if (!threatened.has(start)) threatened.set(start, new Set([...reach(start)].flatMap(adjacentCirclesForCrossing)))
  return threatened.get(start)!
}

// The input is Jack's *next* turn: the candidate move has already consumed its
// token/slots and a newly reached discovery has reset the round. Investigators
// have not moved yet. Forecast one legal coordinated repositioning, then count
// Jack's viable escapes, including specials and the following arrest range.
export function jackEscapeForecast(state: GameState): JackEscapeForecast {
  const from = state.currentJack
  if (from === null) return { minimumStreetExits: 0, minimumLegalExits: 0, minimumSafeExits: 0, trapPositions: null }
  const targets = new Set(state.discoveryLocations.filter(id => !state.reachedDiscoveries.includes(id)))
  const viable = (id: number, cost: number) => state.moveSlot + cost < 15 || targets.has(id)
  const street = [...(jackTransitions.get(from) ?? [])].filter(([id]) => viable(id, 1))
  const specials = new Set<number>()
  for (const type of ['alley', 'boat', 'coach'] as const) {
    const planning = { ...state, jackMoveSelection: { type, path: [] } }
    for (const first of legalJackDestinations(planning)) {
      if (type === 'coach') {
        for (const last of legalJackDestinations({ ...planning, jackMoveSelection: { type, path: [first] } })) {
          if (viable(last, 2)) specials.add(last)
        }
      } else if (viable(first, 1)) specials.add(first)
    }
  }
  const ids = [...new Set([...street.map(([id]) => id), ...specials])]
  const bits = new Map(ids.map((id, index) => [id, 1n << BigInt(index)]))
  const specialMask = [...specials].reduce((mask, id) => mask | bits.get(id)!, 0n)
  const pathBlocks = new Map<string, bigint>()
  let pathIndex = 0
  const routes = street.map(([id, paths]) => {
    let alternatives = 0n
    for (const path of paths) {
      const bit = 1n << BigInt(pathIndex++)
      alternatives |= bit
      for (const crossing of path) pathBlocks.set(crossing, (pathBlocks.get(crossing) ?? 0n) | bit)
    }
    return { destination: bits.get(id)!, alternatives }
  })
  const colors = INVESTIGATOR_ORDER.filter(color => state.investigatorPositions[color])
  const options = colors.map(color => {
    const start = state.investigatorPositions[color]!
    const choices = [...reach(start)].map(id => {
      const blocks = pathBlocks.get(id) ?? 0n
      const danger = ids.reduce((mask, location) => threats(id).has(location) ? mask | bits.get(location)! : mask, 0n)
      return { id, blocks, danger, pressure: countBits(blocks) * 4 + countBits(danger) }
    }).sort((a, b) => b.pressure - a.pressure || a.id.localeCompare(b.id))
    // Keep the strongest pressure options plus staying put. Any crossing that
    // actually blocks a route is retained even outside this bounded shortlist.
    const retained = new Set(choices.slice(0, 6).map(choice => choice.id))
    return choices.filter(choice => retained.has(choice.id) || choice.id === start || choice.blocks !== 0n)
  })
  const result: JackEscapeForecast = { minimumStreetExits: Infinity, minimumLegalExits: Infinity, minimumSafeExits: Infinity, trapPositions: null }
  const visit = (index: number, positions: Positions, blocks: bigint, danger: bigint) => {
    if (index === colors.length) {
      let streetMask = 0n
      for (const route of routes) if ((route.alternatives & blocks) !== route.alternatives) streetMask |= route.destination
      const escapes = streetMask | specialMask
      const legalCount = countBits(escapes)
      result.minimumStreetExits = Math.min(result.minimumStreetExits, countBits(streetMask))
      result.minimumLegalExits = Math.min(result.minimumLegalExits, legalCount)
      result.minimumSafeExits = Math.min(result.minimumSafeExits, countBits(escapes & ~danger))
      if (!legalCount && !result.trapPositions) result.trapPositions = positions
      return
    }
    const color = colors[index]!
    for (const choice of options[index]!) {
      // Match the engine's movement order: a piece may enter a crossing vacated
      // earlier in this turn, but cannot share another piece's current crossing.
      if (colors.some(other => other !== color && positions[other] === choice.id)) continue
      visit(index + 1, { ...positions, [color]: choice.id }, blocks | choice.blocks, danger | choice.danger)
    }
  }
  visit(0, state.investigatorPositions, 0n, 0n)
  return result
}
