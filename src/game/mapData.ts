import alleyGroupsRaw from '../data/whitehall/alley_groups.jsonl?raw'
import circlesRaw from '../data/whitehall/circles.jsonl?raw'
import connectionsRaw from '../data/whitehall/connections.jsonl?raw'
import squaresRaw from '../data/whitehall/squares.jsonl?raw'
import waterGroupsRaw from '../data/whitehall/water_groups.jsonl?raw'
import type { CircleColor, CircleNode, CrossingNode, Quadrant } from './types'

interface RawCircle {
  id: number
  x: number
  y: number
  color: CircleColor
}

interface RawCrossing {
  id: string
  x: number
  y: number
  starting: boolean
}

const parseJsonLines = <T,>(raw: string, name: string): T[] =>
  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as T
      } catch {
        throw new Error(`Invalid JSON in ${name} on line ${index + 1}`)
      }
    })

export const quadrantForPoint = (x: number, y: number): Quadrant =>
  `${y < 600 ? 'N' : 'S'}${x < 600 ? 'W' : 'E'}` as Quadrant

const rawCircles = parseJsonLines<RawCircle>(circlesRaw, 'circles.jsonl')
const rawCrossings = parseJsonLines<RawCrossing>(squaresRaw, 'squares.jsonl')
const rawConnections = parseJsonLines<[string, string]>(connectionsRaw, 'connections.jsonl')
export const alleyGroups = parseJsonLines<Array<number | string>>(alleyGroupsRaw, 'alley_groups.jsonl').map((group) =>
  group.map(Number),
)
export const waterGroups = parseJsonLines<Array<number | string>>(waterGroupsRaw, 'water_groups.jsonl').map((group) =>
  group.map(Number),
)

export const circles: CircleNode[] = rawCircles
  .map((circle) => ({ ...circle, quadrant: quadrantForPoint(circle.x, circle.y) }))
  .sort((a, b) => a.id - b.id)

export const crossings: CrossingNode[] = rawCrossings.slice().sort((a, b) => a.id.localeCompare(b.id))

export const circlesById = new Map(circles.map((circle) => [circle.id, circle]))
export const crossingsById = new Map(crossings.map((crossing) => [crossing.id, crossing]))
export const startingCrossings = crossings.filter((crossing) => crossing.starting)

const crossingToCircles = new Map<string, number[]>(crossings.map((crossing) => [crossing.id, []]))
const circleToCrossings = new Map<number, string[]>(circles.map((circle) => [circle.id, []]))
const directCrossingEdges: Array<[string, string]> = []

for (const [first, second] of rawConnections) {
  const firstCircle = /^\d+$/.test(first)
  const secondCircle = /^\d+$/.test(second)

  if (firstCircle !== secondCircle) {
    const circleId = Number(firstCircle ? first : second)
    const crossingId = firstCircle ? second : first
    if (!circlesById.has(circleId) || !crossingsById.has(crossingId)) {
      throw new Error(`Unknown connection endpoint: ${first}, ${second}`)
    }
    crossingToCircles.get(crossingId)?.push(circleId)
    circleToCrossings.get(circleId)?.push(crossingId)
  } else if (!firstCircle && !secondCircle) {
    if (!crossingsById.has(first) || !crossingsById.has(second)) {
      throw new Error(`Unknown crossing connection: ${first}, ${second}`)
    }
    directCrossingEdges.push([first, second])
  } else {
    throw new Error(`Numbered circles cannot connect directly: ${first}, ${second}`)
  }
}

const directCrossingNeighbors = new Map<string, Set<string>>(
  crossings.map((crossing) => [crossing.id, new Set<string>()]),
)

for (const [first, second] of directCrossingEdges) {
  directCrossingNeighbors.get(first)?.add(second)
  directCrossingNeighbors.get(second)?.add(first)
}

export const jackTransitions = new Map<number, Map<number, string[][]>>(
  circles.map((circle) => [circle.id, new Map<number, string[][]>()]),
)

const addJackPath = (from: number, to: number, path: string[]) => {
  const destinations = jackTransitions.get(from)
  const paths = destinations?.get(to) ?? []
  if (!paths.some((existing) => existing.length === path.length && existing.every((id, index) => id === path[index]))) {
    paths.push(path)
  }
  destinations?.set(to, paths)
}

const traceJackPaths = (from: number, crossingId: string, path: string[], visited: Set<string>) => {
  for (const to of crossingToCircles.get(crossingId) ?? []) {
    if (to !== from) addJackPath(from, to, path)
  }
  for (const next of directCrossingNeighbors.get(crossingId) ?? []) {
    if (visited.has(next)) continue
    traceJackPaths(from, next, [...path, next], new Set([...visited, next]))
  }
}

for (const circle of circles) {
  for (const crossingId of circleToCrossings.get(circle.id) ?? []) {
    traceJackPaths(circle.id, crossingId, [crossingId], new Set([crossingId]))
  }
}

export const investigatorNeighbors = new Map<string, Set<string>>(
  crossings.map((crossing) => [crossing.id, new Set<string>()]),
)

export const investigatorTransitions = new Map<string, Map<string, number[][]>>(
  crossings.map((crossing) => [crossing.id, new Map<string, number[][]>()]),
)

const connectCrossings = (first: string, second: string, throughLocations: number[] = []) => {
  if (first === second) return
  investigatorNeighbors.get(first)?.add(second)
  investigatorNeighbors.get(second)?.add(first)
  for (const [from, to, path] of [
    [first, second, throughLocations],
    [second, first, [...throughLocations].reverse()],
  ] as const) {
    const paths = investigatorTransitions.get(from)?.get(to) ?? []
    if (!paths.some((existing) => existing.length === path.length && existing.every((id, index) => id === path[index]))) {
      paths.push([...path])
    }
    investigatorTransitions.get(from)?.set(to, paths)
  }
}

for (const [first, second] of directCrossingEdges) connectCrossings(first, second)

for (const [circleId, adjacentCrossings] of circleToCrossings) {
  for (let first = 0; first < adjacentCrossings.length; first += 1) {
    for (let second = first + 1; second < adjacentCrossings.length; second += 1) {
      const firstId = adjacentCrossings[first]
      const secondId = adjacentCrossings[second]
      if (firstId && secondId) connectCrossings(firstId, secondId, [circleId])
    }
  }
}

const buildGroupedDestinations = (groups: number[][]) => {
  const destinations = new Map<number, Set<number>>(circles.map((circle) => [circle.id, new Set<number>()]))
  for (const group of groups) {
    for (const from of group) {
      if (!circlesById.has(from)) throw new Error(`Unknown grouped circle: ${from}`)
      for (const to of group) {
        if (from !== to) destinations.get(from)?.add(to)
      }
    }
  }
  return destinations
}

export const alleyDestinations = buildGroupedDestinations(alleyGroups)
export const boatDestinations = buildGroupedDestinations(waterGroups)

for (const group of alleyGroups) {
  if (group.some((id) => circlesById.get(id)?.color === 'blue')) {
    throw new Error('Alley groups cannot contain blue circles')
  }
}

for (const group of waterGroups) {
  if (group.some((id) => circlesById.get(id)?.color !== 'blue')) {
    throw new Error('Water groups must contain only blue circles')
  }
}

if (circles.length !== 189 || crossings.length !== 174 || startingCrossings.length !== 6) {
  throw new Error('Whitehall map data has unexpected node counts')
}

export const adjacentCirclesForCrossing = (crossingId: string): number[] =>
  (crossingToCircles.get(crossingId) ?? []).slice().sort((a, b) => a - b)

export const reachableCrossings = (start: string, maximumDistance = 2): Set<string> => {
  const distances = new Map<string, number>([[start, 0]])
  const queue = [start]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    const distance = distances.get(current) ?? 0
    if (distance >= maximumDistance) continue
    for (const neighbor of investigatorNeighbors.get(current) ?? []) {
      if (distances.has(neighbor)) continue
      distances.set(neighbor, distance + 1)
      queue.push(neighbor)
    }
  }
  return new Set(distances.keys())
}
