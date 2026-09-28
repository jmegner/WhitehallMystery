import type { GameState } from './types'

export interface PublicLogSection {
  id: string
  title: string
  round: number | null
  entries: string[]
}

export const publicHuntLog = (state: Pick<GameState, 'publicLog' | 'round'>): PublicLogSection[] => {
  const sections: PublicLogSection[] = []
  for (const entry of state.publicLog) {
    const previous = sections.at(-1)
    const roundStart = /^M0: Round (\d+) begins from \d+\.$/.exec(entry)
    const initialStart = /^M0: Jack began the hunt at Discovery Location \d+\.$/.test(entry)
    // An arrival completes the preceding round; only the next "begins" entry starts a new one.
    const round = roundStart ? Number(roundStart[1]) : initialStart ? 1
      : previous?.round ?? (/^M\d+:/.test(entry) ? state.round : null)
    if (!previous || previous.round !== round) {
      sections.push({
        id: round === null ? 'setup' : `round-${round}`,
        title: round === null ? 'Setup' : `Round ${round}`,
        round,
        entries: [entry],
      })
    } else {
      previous.entries.push(entry)
    }
  }
  return sections
}
