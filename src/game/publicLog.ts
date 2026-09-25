import type { GameState } from './types'

const isDiscoveryReveal = (entry: string): boolean =>
  /^M\d+: Jack (?:began the hunt at|reached) Discovery Location \d+\.$/.test(entry)

export const currentRoundPublicLog = (publicLog: string[]): string[] => {
  for (let index = publicLog.length - 1; index >= 0; index -= 1) {
    if (isDiscoveryReveal(publicLog[index] ?? '')) return publicLog.slice(index)
  }

  return publicLog
}

export const publicHuntLog = (state: Pick<GameState, 'stage' | 'publicLog'>): string[] =>
  state.stage === 'gameOver' ? state.publicLog : currentRoundPublicLog(state.publicLog)
