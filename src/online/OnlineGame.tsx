import { useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react'
import App from '../App'
import { currentHistoryState, playerViewForState, type GameHistory, type HistoryCommand } from '../game/history'
import { onlineTurnStart } from '../game/onlineProtocol'
import { OnlineSessionStore, inviteOnlineReplacement, onlineInviteUrl, type OnlineSession } from './onlineSession'
import { opponentRole, type OnlineSeats } from '../game/onlineSeats'
import TurnAlerts from './TurnAlerts'
import OnlineUndoPanel from './OnlineUndoPanel'
import type { InvitationCopyStatus } from './invitationClipboard'

interface OnlineGameProps {
  session: OnlineSession
  invitationCopyStatus?: InvitationCopyStatus
  onChooseNewGame: () => void
  onResumeGame: () => void
  onLeaveNewGame: () => void
  onProgress: (history: GameHistory, createdAt: number | null, seats: OnlineSeats | null, revision: number, name: string | undefined) => void
  onInvitation: (invitation: NonNullable<OnlineSession['opponentInvitation']>) => void
}

export default function OnlineGame({ session, invitationCopyStatus, onChooseNewGame, onResumeGame, onLeaveNewGame, onProgress, onInvitation }: OnlineGameProps) {
  const [store] = useState(() => new OnlineSessionStore(session))
  const online = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [copyFeedback, setCopyFeedback] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteId, setInviteId] = useState(() => crypto.randomUUID())
  const automaticCopyFeedback = invitationCopyStatus === 'copying' ? 'Game created. Copying your partner’s invitation link…'
    : invitationCopyStatus === 'copied' ? `Game created. ${session.role === 'jack' ? 'Investigator' : 'Jack'} invitation copied automatically. Send it to your partner.`
      : invitationCopyStatus === 'unavailable' ? 'Game created, but automatic copying was unavailable. Use Copy invitation link, or select and copy the link.' : ''

  const reportProgress = useEffectEvent(onProgress)
  useEffect(() => {
    let previous = store.getSnapshot().snapshot
    const unsubscribe = store.subscribe(() => {
      const next = store.getSnapshot()
      if (next.history && next.snapshot !== previous) {
        previous = next.snapshot
        reportProgress(next.history, next.createdAt, next.seats, next.snapshot!.revision, next.name)
      }
    })
    const stop = store.start()
    return () => { unsubscribe(); stop() }
  }, [store])

  const navigation = <>
    <button className="text-button" type="button" disabled={inviting || online.pendingRequestId !== null} onClick={onChooseNewGame}>New game</button>
    <button className="text-button" type="button" disabled={inviting || online.pendingRequestId !== null} onClick={onResumeGame}>Resume game</button>
    <button className="text-button" type="button" disabled={inviting || online.pendingRequestId !== null} onClick={onLeaveNewGame}>Leave+New Game</button>
  </>

  const copyInvitation = async () => {
    try {
      await navigator.clipboard.writeText(onlineInviteUrl(session))
      setCopyFeedback(session.role === 'jack' ? 'Investigator invitation copied.' : 'Jack invitation copied.')
    } catch {
      setCopyFeedback('Copy is unavailable. Select and copy the invitation link.')
    }
  }

  const createInvitation = async () => {
    setInviting(true)
    setCopyFeedback('')
    try {
      onInvitation(await inviteOnlineReplacement(session, inviteId))
      setInviteId(crypto.randomUUID())
      setCopyFeedback('Replacement invitation ready. Copy the link and send it to your new partner.')
    } catch (error) { setCopyFeedback(error instanceof Error ? error.message : 'Could not create a replacement invitation.') }
    finally { setInviting(false) }
  }

  if (!online.history) {
    return <main className="mail-menu online-menu">
      <h1>Online game</h1>
      <p>{online.status === 'error' ? online.error : 'Connecting securely to the game…'}</p>
      {automaticCopyFeedback && <p role="status">{automaticCopyFeedback}</p>}
      {navigation}
    </main>
  }

  const state = currentHistoryState(online.history)
  const playerTurn = playerViewForState(state)
  const connected = online.status === 'connected'
  const undoPending = online.undo?.status === 'pending'
  const waiting = !connected || online.pendingRequestId !== null || undoPending || (state.stage !== 'gameOver' && playerTurn !== session.role)
  const commands = (next: HistoryCommand[]) => store.sendCommands(next)
  const opponent = opponentRole(session.role)
  const seat = online.seats?.[opponent]
  const opponentLeft = seat ? seat.leftAt !== null : false
  const hasInvitation = session.opponentInvitation ? session.opponentInvitation.generation === (seat?.generation ?? 0) :
    session.role === 'jack' && !!session.investigatorsToken && (!seat || seat.generation === 0)
  const invitation = hasInvitation ? onlineInviteUrl(session) : ''

  return <>
    <section className="mail-panel online-panel" aria-label="Online game">
      <div className="mail-heading">
        <strong>Online · {session.role === 'jack' ? 'Jack' : 'Investigators'}</strong>
        <span>{online.status === 'connected' ? 'Connected' : 'Reconnecting…'}</span>
        {navigation}
      </div>
      {online.name && <h2 className="online-game-name">{online.name}</h2>}
      <p>
        Jack: {online.presence.jack ? 'connected' : 'offline'} · Investigators: {online.presence.investigators ? 'connected' : 'offline'}
        {online.pendingRequestId ? ' · Saving action…' : ''}
      </p>
      {opponentLeft && <p className="online-departure" role="status">Your opponent ({opponent === 'jack' ? 'Jack' : 'the investigators'}) left the game. Invite a replacement below. This notice clears after that side completes a turn.</p>}
      {opponentLeft && <button type="button" disabled={!connected || inviting || online.pendingRequestId !== null} onClick={() => void createInvitation()}>
        {inviting ? 'Creating invitation…' : invitation ? 'Replace invitation link' : 'Create replacement invitation'}
      </button>}
      <TurnAlerts store={store} />
      <OnlineUndoPanel store={store} online={online} />
      {invitation && <details open>
        <summary>Invite the {opponent === 'jack' ? 'Jack' : 'investigator'} player</summary>
        <p>This link is that player’s private game credential. Send it only to that player.</p>
        <textarea aria-label={opponent === 'jack' ? 'Online Jack invitation' : 'Online investigator invitation'} readOnly value={invitation} rows={2} onFocus={event => event.target.select()} />
        <button type="button" onClick={() => void copyInvitation()}>Copy invitation link</button>
      </details>}
      <p role="status">{online.error || copyFeedback || automaticCopyFeedback}</p>
    </section>
    <App
      online={{
        history: online.history,
        role: session.role,
        turnStart: state.stage === 'gameOver' ? online.history.cursor : onlineTurnStart(online.history, session.role),
        waiting,
        waitingMessage: undoPending ? 'Undo request pending' : undefined,
        onCommands: commands,
      }}
      onNewGame={onChooseNewGame}
    />
  </>
}
