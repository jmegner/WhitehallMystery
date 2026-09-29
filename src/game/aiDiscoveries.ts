import data from '../data/whitehall/aiDiscovery.json'

// Difficulty definition by Tim Jeanes (2018), whitehallmystery.com.
// Use the site's original data: its fractional trip costs include special moves
// and are deliberately different from distances on our corrected street graph.
export const EASY_DISCOVERY_LIMIT = data.easyUpperBound
const locations = data.regions.flat()
const indices = new Map(locations.map((location, index) => [location.id, index]))
const exposure = locations.map(location => 1 / (location.circles * location.squares ** 0.8))
const orders: number[][] = []
for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++) {
  if (a !== b && a !== c && b !== c) orders.push([a, b, c, 6 - a - b - c])
}

function difficultyForIndices(ids: number[]): number {
  let shortest = Infinity
  let longest = 0
  for (const order of orders) {
    const [a, b, c, d] = order.map(index => ids[index]!)
    const cost = data.costs[a!]![b!]! + data.costs[b!]![c!]! + data.costs[c!]![d!]!
    shortest = Math.min(shortest, cost)
    longest = Math.max(longest, cost)
  }
  return ids.reduce((sum, id) => sum + exposure[id]!, 0) * shortest ** 0.75 * longest ** 0.25
}

export function discoveryDifficulty(ids: number[]): number {
  if (ids.length !== 4 || new Set(ids).size !== 4 ||
    data.regions.some(region => !region.some(location => ids.includes(location.id)))) return Infinity
  return difficultyForIndices(ids.map(id => indices.get(id)!))
}

export interface EasyDiscoveryScenario { ids: number[]; weight: number }
let easyScenarios: EasyDiscoveryScenario[] | undefined
export function easyDiscoveryScenarios(): readonly EasyDiscoveryScenario[] {
  if (easyScenarios) return easyScenarios
  easyScenarios = []
  const regions = data.regions.map(region => region.map(location => indices.get(location.id)!))
  for (const a of regions[0]!) for (const b of regions[1]!) for (const c of regions[2]!) for (const d of regions[3]!) {
    const selected = [a, b, c, d]
    if (difficultyForIndices(selected) > EASY_DISCOVERY_LIMIT) continue
    const ids = selected.map(index => locations[index]!.id)
    // Exact probability up to a common normalization: match the Easy
    // randomizer's rejection bias for sets containing location 130.
    easyScenarios.push({ ids, weight: ids.includes(130) ? 3500 / 6725 : 1 })
  }
  return easyScenarios
}

export function chooseEasyDiscoveries(random = Math.random): number[] {
  for (let attempt = 0; attempt < 10000; attempt += 1) {
    const ids = data.regions.map(region => region[Math.min(region.length - 1, Math.max(0, Math.floor(random() * region.length)))]!.id)
    if (discoveryDifficulty(ids) > EASY_DISCOVERY_LIMIT) continue
    // Match the site's Easy sampling bias, which reduces repetition of 130.
    if (ids.includes(130) && random() * (6725 / 3500) > 1) continue
    return ids.sort((a, b) => a - b)
  }
  // Bounded fallback for pathological random sources; still satisfies Easy.
  return [33, 43, 130, 139]
}
