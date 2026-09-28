import { useEffect, useState } from 'react'
import App from './App'
import { needsAiTurn, resumeAiHistory } from './game/aiSession'
import { type GameHistory, type PlayerView } from './game/history'
import type { SavedGameLibrary } from './game/savedGames'

export default function AiGame({ id, history, role, library, onNewGame, onResumeGame, onLeaveNewGame }: {
  id: string; history: GameHistory; role: PlayerView; library: SavedGameLibrary
  onNewGame: () => void; onResumeGame: () => void; onLeaveNewGame: () => void
}) {
  const [failure, setFailure] = useState<{ history: GameHistory; message: string } | null>(null)
  const [retry, setRetry] = useState(0)
  const waiting = needsAiTurn(history, role)
  const paused = waiting && history.cursor < history.entries.length - 1
  const error = failure?.history === history ? failure.message : ''
  // Synchronize with an external worker; cleanup cancels stale work when the
  // user changes games, leaves the board, retries, or StrictMode remounts.
  useEffect(() => {
    if (!waiting || paused) return
    let active = true
    const worker = new Worker(new URL('./game/ai.worker.ts', import.meta.url), { type: 'module' })
    const isCurrent = () => {
      const game = library.get(id)
      return active && game?.mode === 'versus-ai' && game.history === history
    }
    worker.onmessage = (event: MessageEvent<{ history?: GameHistory; error?: string }>) => {
      if (isCurrent()) {
        if (event.data.history) library.saveLocal(id, event.data.history)
        else setFailure({ history, message: event.data.error ?? 'AI turn failed.' })
      }
      worker.terminate()
    }
    worker.onerror = () => {
      if (isCurrent()) setFailure({ history, message: 'Could not run the AI. Retry the turn.' })
      worker.terminate()
    }
    worker.postMessage({ id, history, role })
    return () => { active = false; worker.terminate() }
  }, [history, id, library, role, waiting, paused, retry])

  return <>
    <section className="mail-panel" aria-label="Versus AI game">
      <div className="mail-heading"><strong>Versus AI · You are {role === 'jack' ? 'Jack' : 'the investigator'}</strong>
        <button className="text-button" onClick={onNewGame}>New game</button>
        <button className="text-button" onClick={onResumeGame}>Resume game</button>
        <button className="text-button" onClick={onLeaveNewGame}>Leave+New Game</button>
      </div>
      {paused && <p role="status">AI paused while reviewing earlier actions. <button onClick={() => library.saveLocal(id, resumeAiHistory(history))}>Resume AI turn</button></p>}
      {error && <p role="alert">{error} <button onClick={() => { setFailure(null); setRetry(value => value + 1) }}>Retry AI turn</button></p>}
    </section>
    <App gameId={id} ai={{ history, role, waiting, paused, onChange: next => library.saveLocal(id, next) }} onNewGame={onNewGame} />
  </>
}
