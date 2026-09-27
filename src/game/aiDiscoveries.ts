import data from '../data/whitehall/aiDiscovery.json'

// Difficulty definition by Tim Jeanes (2018), whitehallmystery.com.
// Use the site's original data: its fractional trip costs include special moves
// and are deliberately different from distances on our corrected street graph.
export const EASY_DISCOVERY_LIMIT = data.easyUpperBound
const locations = data.regions.flat()
const indices = new Map(locations.map((location, index) => [location.id, index]))

export function discoveryDifficulty(ids: number[]): number {
  if (ids.length !== 4 || new Set(ids).size !== 4 ||
    data.regions.some(region => !region.some(location => ids.includes(location.id)))) return Infinity
  let shortest = Infinity
  let longest = 0
  const visit = (remaining: number[], last: number | null, distance: number) => {
    if (!remaining.length) { shortest = Math.min(shortest, distance); longest = Math.max(longest, distance); return }
    for (const id of remaining) visit(remaining.filter(other => other !== id), id,
      distance + (last === null ? 0 : data.costs[indices.get(last)!]![indices.get(id)!]!))
  }
  visit(ids, null, 0)
  const exposure = ids.reduce((sum, id) => {
    const location = locations[indices.get(id)!]!
    return sum + 1 / (location.circles * location.squares ** 0.8)
  }, 0)
  return exposure * shortest ** 0.75 * longest ** 0.25
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
