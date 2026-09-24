import { useEffect, useState } from 'react'
import { SavedGameLibrary, savedGameMode, savedGameStatus, savedGameTime, type SavedGame } from './game/savedGames'
import { readOnlineGame, renameOnlineGame } from './online/onlineSession'
import { confirmLeaveGame, leaveSavedGame } from './game/leaveGame'
import { isGameName, MAX_GAME_NAME_LENGTH } from './game/gameName'

export default function SavedGamesMenu({ library, activeId, onResume, onNewGame, onCancel }: {
  library: SavedGameLibrary; activeId: string; onResume: (id: string) => void; onNewGame: () => void; onCancel: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [refresh, setRefresh] = useState(0)
  const [leaveIds] = useState(() => new Map<string, string>())

  // Read-only HTTP status checks do not claim the player's WebSocket or mark
  // presence. In particular, the chooser must not evict another open game tab.
  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    const check = async () => {
      for (const game of library.getSnapshot().games) {
        if (controller.signal.aborted) return
        if (game.mode !== 'online') continue
        try {
          const status = await readOnlineGame(game.session, controller.signal)
          if (controller.signal.aborted) return
          library.updateOnline(game.id, status.history, status.createdAt, status.seats, status.snapshot.revision, status.name)
          setErrors(previous => ({ ...previous, [game.id]: '' }))
        } catch (error) {
          if (controller.signal.aborted) return
          setErrors(previous => ({ ...previous, [game.id]: error instanceof Error ? error.message : 'Status unavailable.' }))
        }
      }
      if (!controller.signal.aborted) timer = window.setTimeout(() => void check(), 30000)
    }
    void check()
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [library, refresh])

  const leave = async (game: SavedGame) => {
    if (!confirmLeaveGame(game)) return
    setBusy(game.id)
    setFeedback('')
    try {
      let requestId = leaveIds.get(game.id)
      if (!requestId) { requestId = crypto.randomUUID(); leaveIds.set(game.id, requestId) }
      setFeedback(await leaveSavedGame(library, game, requestId))
    } catch (error) {
      setFeedback(`${error instanceof Error ? error.message : 'Could not leave the game.'} The saved entry has been kept; retry Leave when connected.`)
    } finally { setBusy(null) }
  }
  const games = [...library.getSnapshot().games].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0) || b.savedAt - a.savedAt)
  return <main className="mail-menu saved-game-menu">
    <h1>Resume game</h1>
    <p>Games saved in this browser. Start times use your local time zone. Online status refreshes here every 30 seconds; only an open game receives turn alerts.</p>
    <div className="button-row">
      <button type="button" onClick={onNewGame} disabled={busy !== null}>New game</button>
      {games.some(game => game.mode === 'online') && <button type="button" onClick={() => setRefresh(value => value + 1)} disabled={busy !== null}>Refresh status</button>}
    </div>
    {!games.length && <p>No saved games. Start a new game when you’re ready.</p>}
    <ul className="saved-game-list">
      {games.map(game => <li key={game.id}>
        <button className="saved-game-resume" type="button" disabled={busy !== null} aria-current={game.id === activeId ? 'true' : undefined} onClick={() => onResume(game.id)}>
          {game.name && <strong className="saved-game-name">{game.name}</strong>}
          <strong>{savedGameTime(game)}</strong>
          <span>{savedGameMode(game)}{game.mode !== 'same-device' && ` · ${game.session.role === 'jack' ? 'Jack' : 'Investigators'}`}{game.id === activeId && ' · Current game'}</span>
          <span>{savedGameStatus(game)}{game.mode === 'online' && ' (last known)'}</span>
        </button>
        <button className="saved-game-leave" type="button" disabled={busy !== null} onClick={() => void leave(game)}>{busy === game.id ? 'Leaving…' : 'Leave'}</button>
        <GameNameEditor game={game} library={library} disabled={busy !== null} onBusy={value => setBusy(value ? `rename:${game.id}` : null)} />
        {errors[game.id] && <p className="saved-game-status-error" role="status">Status could not refresh: {errors[game.id]}</p>}
      </li>)}
    </ul>
    {activeId && <button type="button" className="text-button" disabled={busy !== null} onClick={onCancel}>Cancel</button>}
    <p role="status">{feedback}</p>
  </main>
}

function GameNameEditor({ game, library, disabled, onBusy }: {
  game: SavedGame; library: SavedGameLibrary; disabled: boolean; onBusy: (busy: boolean) => void
}) {
  const [edit, setEdit] = useState<{ name: string; expectedName: string; requestId: string } | null>(null)
  const [error, setError] = useState('')
  const save = async () => {
    if (!edit || disabled) return
    const name = edit.name.trim()
    if (!isGameName(name)) { setError('Use a single-line game name of up to 80 characters.'); return }
    onBusy(true)
    setError('')
    try {
      if (game.mode === 'online') {
        const status = await renameOnlineGame(game.session, name, edit.expectedName, edit.requestId)
        library.updateOnline(game.id, status.history, status.createdAt, status.seats, status.snapshot.revision, status.name)
      } else if (!library.renameLocal(game.id, name)) throw new Error('Could not save the name in browser storage.')
      setEdit(null)
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not rename the game.') }
    finally { onBusy(false) }
  }
  return <div className="saved-game-name-editor">
    {edit ? <form onSubmit={event => { event.preventDefault(); void save() }}>
      <label>Game name (optional)
        <input className="game-name-input" value={edit.name} maxLength={MAX_GAME_NAME_LENGTH} disabled={disabled}
          onChange={event => setEdit({ ...edit, name: event.target.value, requestId: crypto.randomUUID() })} />
      </label>
      <p className="game-name-hint">{game.mode === 'online' ? 'Shared with both players.' : 'A label in this browser only.'} Leave blank to remove the name.</p>
      <div className="button-row">
        <button type="submit" disabled={disabled}>Save name</button>
        <button type="button" disabled={disabled} onClick={() => { setEdit(null); setError('') }}>Cancel name edit</button>
      </div>
    </form> : <button type="button" className="text-button" disabled={disabled}
      onClick={() => { setEdit({ name: game.name ?? '', expectedName: game.name ?? '', requestId: crypto.randomUUID() }); setError('') }}>Edit name</button>}
    {error && <p role="alert">{error}</p>}
  </div>
}
