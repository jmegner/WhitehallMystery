import { useEffect, useState, useSyncExternalStore } from 'react'
import App from '../App'
import { currentHistoryState, playerViewForState, type HistoryCommand } from '../game/history'
import { onlineTurnStart } from '../game/onlineProtocol'
import { OnlineSessionStore, onlineInviteUrl, type OnlineSession } from './onlineSession'
import TurnAlerts from './TurnAlerts'

interface OnlineGameProps {
  session: OnlineSession
  onLeave: () => void
  onChooseNewGame: () => void
}

export default function OnlineGame({ session, onLeave, onChooseNewGame }: OnlineGameProps) {
  const [store] = useState(() => new OnlineSessionStore(session))
  const online = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [copyFeedback, setCopyFeedback] = useState('')

  useEffect(() => store.start(), [store])

  const copyInvitation = async () => {
    try {
      await navigator.clipboard.writeText(onlineInviteUrl(session))
      setCopyFeedback('Investigator invitation copied.')
    } catch {
      setCopyFeedback('Copy is unavailable. Select and copy the invitation link.')
    }
  }

  if (!online.history) {
    return <main className="mail-menu online-menu">
      <h1>Online game</h1>
      <p>{online.status === 'error' ? online.error : 'Connecting securely to the game…'}</p>
      <button className="text-button" type="button" onClick={onLeave}>Leave game</button>
    </main>
  }

  const state = currentHistoryState(online.history)
  const playerTurn = playerViewForState(state)
  const connected = online.status === 'connected'
  const waiting = !connected || online.pendingRequestId !== null || (state.stage !== 'gameOver' && playerTurn !== session.role)
  const commands = (next: HistoryCommand[]) => store.sendCommands(next)
  const invitation = session.investigatorsToken ? onlineInviteUrl(session) : ''

  return <>
    <section className="mail-panel online-panel" aria-label="Online game">
      <div className="mail-heading">
        <strong>Online · {session.role === 'jack' ? 'Jack' : 'Investigators'}</strong>
        <span>{online.status === 'connected' ? 'Connected' : 'Reconnecting…'}</span>
        <button className="text-button" type="button" onClick={() => {
          if (window.confirm('Leave this online game on this device?')) onLeave()
        }}>Leave game</button>
      </div>
      <p>
        Jack: {online.presence.jack ? 'connected' : 'offline'} · Investigators: {online.presence.investigators ? 'connected' : 'offline'}
        {online.pendingRequestId ? ' · Saving action…' : ''}
      </p>
      <TurnAlerts store={store} />
      {invitation && <details open>
        <summary>Invite the investigator player</summary>
        <p>This link is the investigator’s private game credential. Send it only to that player.</p>
        <textarea aria-label="Online investigator invitation" readOnly value={invitation} rows={2} onFocus={event => event.target.select()} />
        <button type="button" onClick={() => void copyInvitation()}>Copy invitation link</button>
      </details>}
      <p role="status">{online.error || copyFeedback}</p>
    </section>
    <App
      online={{
        history: online.history,
        role: session.role,
        turnStart: state.stage === 'gameOver' ? online.history.cursor : onlineTurnStart(online.history, session.role),
        waiting,
        onCommands: commands,
      }}
      onNewGame={onChooseNewGame}
    />
  </>
}
