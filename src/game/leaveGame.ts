import { leaveOnlineGame, OnlineSessionHttpError } from '../online/onlineSession'
import { savedGameMode, type SavedGame, type SavedGameLibrary } from './savedGames'

export function confirmLeaveGame(game: SavedGame, newGame = false): boolean {
  const detail = game.mode === 'online' ? 'Your partner will be notified and your credential revoked. A new invitation will be needed to return.' :
    game.mode === 'by-mail' ? 'This browser’s saved progress and draft will be removed. Keep game text if you may want to rejoin.' : 'This browser’s saved progress and undo history will be removed.'
  return window.confirm(`Leave this ${savedGameMode(game)} game${newGame ? ' and choose a new game' : ''}? ${detail}`)
}

export async function leaveSavedGame(library: SavedGameLibrary, game: SavedGame, requestId: string): Promise<string> {
  let notice = ''
  if (game.mode === 'online') {
    try { await leaveOnlineGame(game.session, requestId) }
    catch (error) {
      // Expired/revoked credentials no longer have a usable seat to abandon.
      if (!(error instanceof OnlineSessionHttpError) || error.status !== 401) throw error
      notice = 'Removed locally. The game expired or this credential is no longer valid.'
    }
  }
  if (!library.leave(game.id)) throw new Error('Could not remove the saved entry from browser storage.')
  return notice
}
