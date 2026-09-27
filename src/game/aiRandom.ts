import type { GameState } from './types'

// Stable for a saved game/turn, varied across games. Only public information
// enters the seed, so investigator decisions cannot depend on Jack's secrets.
export function aiTurnRandom(gameId: string, state: GameState): () => number {
  const key = JSON.stringify([gameId, state.stage, state.round, state.moveSlot, state.activeInvestigator,
    state.investigatorPositions, state.publicRound, state.checkedThisAction, state.publicLog])
  let seed = 2166136261
  for (let i = 0; i < key.length; i += 1) seed = Math.imul(seed ^ key.charCodeAt(i), 16777619) >>> 0
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let value = Math.imul(seed ^ (seed >>> 15), seed | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function randomChoice<T>(values: T[], random: () => number): T | undefined {
  if (values.length < 2) return values[0]
  return values[Math.min(values.length - 1, Math.floor(random() * values.length))]
}

// Shuffle whole tie groups after sorting, never inside a sort comparator.
export function rankWithRandomTies<T>(values: T[], compare: (a: T, b: T) => number, random: () => number): T[] {
  const ranked = [...values].sort(compare)
  for (let first = 0; first < ranked.length;) {
    let end = first + 1
    while (end < ranked.length && Math.abs(compare(ranked[first]!, ranked[end]!)) < 1e-9) end += 1
    for (let i = end - 1; i > first; i -= 1) {
      const j = first + Math.min(i - first, Math.floor(random() * (i - first + 1)))
      ;[ranked[i], ranked[j]] = [ranked[j]!, ranked[i]!]
    }
    first = end
  }
  return ranked
}
