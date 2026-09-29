import { alleyDestinations, boatDestinations, circles, jackTransitions } from './mapData'
import type { GameState } from './types'

// Optimistic distance in move-track slots, with finite Alley/Boat supplies and
// a Street arrival. Coach crosses two street edges for two slots, so cannot
// shorten this bound. Future investigator blocks are intentionally unknown.
// Jack knows which special destinations are forbidden; investigators do not.
export function minimumDiscoveryMoves(targets: ReadonlySet<number>, special: GameState['specialRemaining'],
  forbidSpecialTargets = false): Map<number, number>[][] {
  const layers: Map<number, number>[][] = []
  for (let alley = 0; alley <= special.alley; alley += 1) {
    const row: Map<number, number>[] = []
    layers.push(row)
    for (let boat = 0; boat <= special.boat; boat += 1) {
      const distances = new Map(circles.map(({ id }) => {
        let best = [...jackTransitions.get(id)!.keys()].some(to => targets.has(to)) ? 1 : Infinity
        if (alley > 0) for (const to of alleyDestinations.get(id)!) {
          if (!forbidSpecialTargets || !targets.has(to)) best = Math.min(best, 1 + layers[alley - 1]![boat]!.get(to)!)
        }
        if (boat > 0) for (const to of boatDestinations.get(id)!) {
          if (!forbidSpecialTargets || !targets.has(to)) best = Math.min(best, 1 + row[boat - 1]!.get(to)!)
        }
        return [id, best] as const
      }))
      const queue = circles.filter(({ id }) => Number.isFinite(distances.get(id))).map(({ id }) => id)
      for (let index = 0; index < queue.length; index += 1) {
        const from = queue[index]!
        for (const to of jackTransitions.get(from)!.keys()) {
          const candidate = distances.get(from)! + 1
          if (candidate >= distances.get(to)!) continue
          distances.set(to, candidate)
          queue.push(to)
        }
      }
      row.push(distances)
    }
  }
  return layers
}
