import type { GameHistory } from './history'

export const SECRET_INFO_UNDO_WARNING = 'Are you sure? You just learned secret info and a serious game would not allow this.'

export function undoIncludesSecretInfo(history: GameHistory, targetCursor: number): boolean {
  return targetCursor < history.cursor && history.entries.slice(targetCursor + 1, history.cursor + 1)
    .some(entry => entry.action?.type === 'searchCircle' || entry.action?.type === 'arrestCircle')
}
