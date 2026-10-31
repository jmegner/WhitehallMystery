import type { JackRoundPath } from './game/history'

export function pastPathVisits(paths: JackRoundPath[]) {
  const locations = new Map<number, Array<{ round: number; move: number }>>()
  for (const { round, locations: trail } of paths) {
    for (let move = 1; move < trail.length; move++) {
      const location = trail[move]!
      const visits = locations.get(location) ?? []
      visits.push({ round, move })
      locations.set(location, visits)
    }
  }
  return [...locations].map(([location, visits]) => {
    visits.sort((a, b) => a.round - b.round || a.move - b.move)
    return { location, visits, label: visits.map(({ round, move }) => paths.length > 1 ? `${round}.${move}` : String(move)).join(',') }
  })
}
