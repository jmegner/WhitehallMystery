import type { JackRoundPath } from './game/history'
import type { JackMoveType } from './game/types'

const MOVE_POSTFIX: Record<JackMoveType, string> = { normal: '', coach: 'C', alley: 'A', boat: 'B' }

export function pastPathVisits(paths: JackRoundPath[]) {
  const locations = new Map<number, Array<{ round: number; move: number; type: JackMoveType }>>()
  for (const { round, locations: trail, moves } of paths) {
    for (let move = 1; move < trail.length; move++) {
      const location = trail[move]!
      const visits = locations.get(location) ?? []
      // A Coach evidence entry covers two numbered stops in the trail.
      const type = moves?.find(entry => entry.startSlot <= move && move <= entry.endSlot)?.type ?? 'normal'
      visits.push({ round, move, type })
      locations.set(location, visits)
    }
  }
  return [...locations].map(([location, visits]) => {
    visits.sort((a, b) => a.round - b.round || a.move - b.move)
    return { location, visits, label: visits.map(({ round, move, type }) =>
      `${paths.length > 1 ? `${round}.` : ''}${move}${MOVE_POSTFIX[type]}`).join(',') }
  })
}
