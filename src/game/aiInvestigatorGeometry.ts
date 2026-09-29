import { adjacentCirclesForCrossing, crossings, investigatorNeighbors, jackTransitions } from './mapData'

export const crossingDistances = new Map(crossings.map(crossing => {
  const distances = new Map<string, number>([[crossing.id, 0]])
  const queue = [crossing.id]
  for (let i = 0; i < queue.length; i++) {
    for (const next of investigatorNeighbors.get(queue[i]!) ?? []) {
      if (distances.has(next)) continue
      distances.set(next, distances.get(queue[i]!)! + 1)
      queue.push(next)
    }
  }
  return [crossing.id, distances] as const
}))
const adjacent = new Map(crossings.map(crossing => [crossing.id, adjacentCirclesForCrossing(crossing.id)]))
export const distanceToCircle = new Map(crossings.map(start => [start.id, new Map([...jackTransitions.keys()].map(id => [id,
  Math.min(...crossings.filter(crossing => adjacent.get(crossing.id)!.includes(id)).map(crossing => crossingDistances.get(start.id)!.get(crossing.id)!)),
]))]))
