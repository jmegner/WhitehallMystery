import { useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react'
import App from '../App'
import { mailTimestamp } from '../game/byMail'
import { currentHistoryState, playerViewForState, type GameHistory, type HistoryCommand } from '../game/history'
import { onlineTurnStart } from '../game/onlineProtocol'
import { OnlineSessionHttpError, OnlineSessionStore, inviteOnlineRejoin, inviteOnlineReplacement, onlineInviteUrl, type OnlineSession } from './onlineSession'
import { opponentRole, type OnlineSeats } from '../game/onlineSeats'
import TurnAlerts from './TurnAlerts'
import OnlineUndoPanel from './OnlineUndoPanel'
import type { InvitationCopyStatus } from './invitationClipboard'
import { onlineUndoTarget } from '../game/onlineUndo'
import { SECRET_INFO_UNDO_WARNING, undoIncludesSecretInfo } from '../game/undoWarning'
import { loadBooleanPreference, saveBooleanPreference } from '../game/persistence'

const INVITATION_OPEN_KEY = 'whitehall-mystery.online.invitation-open'

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
  const [inviteRequest, setInviteRequest] = useState<{ requestId: string; generation?: number } | null>(null)
  const [invitationOpen, setInvitationOpen] = useState(() => {
    try { return loadBooleanPreference(localStorage, INVITATION_OPEN_KEY, true) } catch { return true }
  })
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
    if (!connected || inviting || online.pendingRequestId !== null || !seat) return
    const request = inviteRequest ?? { requestId: crypto.randomUUID(), ...(opponentLeft ? {} : { generation: seat.generation }) }
    if (!inviteRequest && request.generation !== undefined && !window.confirm(
      'Create a rejoin invitation? Your opponent’s old access link will stop working and any connected session will be disconnected. The game and undo history will stay unchanged. Send the new link only to your opponent.',
    )) return
    setInviteRequest(request)
    setInviting(true)
    setCopyFeedback('')
    try {
      const invitation = request.generation === undefined
        ? await inviteOnlineReplacement(session, request.requestId)
        : await inviteOnlineRejoin(session, request.requestId, request.generation)
      onInvitation(invitation)
      setInviteRequest(null)
      setCopyFeedback('Invitation ready. Copy the link and send it only to your partner.')
    } catch (error) {
      if (error instanceof OnlineSessionHttpError && error.status === 409) setInviteRequest(null)
      setCopyFeedback(error instanceof Error ? error.message : 'Could not create an invitation.')
    }
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
  const undoTarget = onlineUndoTarget(online.history, session.role)
  const departed = online.seats && (online.seats.jack.leftAt !== null || online.seats.investigators.leftAt !== null)
  const canRequestUndo = connected && online.pendingRequestId === null && !undoPending && !departed && online.undoSupported && undoTarget !== null
  const requestUndo = () => {
    if (!canRequestUndo || undoTarget === null) return
    if (session.role === 'investigators' && undoIncludesSecretInfo(online.history!, undoTarget) && !window.confirm(SECRET_INFO_UNDO_WARNING)) return
    store.sendUndo({ type: 'request-undo' })
  }
  const hasInvitation = session.opponentInvitation ? session.opponentInvitation.generation === (seat?.generation ?? 0) :
    session.role === 'jack' && !!session.investigatorsToken && (!seat || seat.generation === 0)
  const invitation = hasInvitation ? onlineInviteUrl(session) : ''
  const startedAt = online.createdAt ?? session.startedAt

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
        {startedAt !== undefined && <> · Started <time aria-label="Game start time" dateTime={new Date(startedAt).toISOString()}>{mailTimestamp(startedAt / 1000)}</time></>}
        {online.pendingRequestId ? ' · Saving action…' : ''}
      </p>
      {opponentLeft && <p className="online-departure" role="status">Your opponent ({opponent === 'jack' ? 'Jack' : 'the investigators'}) left the game. Invite a replacement below. This notice clears after that side completes a turn.</p>}
      <TurnAlerts store={store} />
      <OnlineUndoPanel store={store} online={online} canRequestUndo={canRequestUndo} onRequestUndo={requestUndo} />
      <details open={invitationOpen} onToggle={event => {
        const open = event.currentTarget.open
        setInvitationOpen(open)
        try { saveBooleanPreference(localStorage, INVITATION_OPEN_KEY, open) } catch { /* Storage may be unavailable. */ }
      }}>
        <summary>Invite the {opponent === 'jack' ? 'Jack' : 'investigator'} player</summary>
        <p>This link is that player’s private game credential. Send it only to that player.</p>
        {invitation ? <>
          <textarea aria-label={opponent === 'jack' ? 'Online Jack invitation' : 'Online investigator invitation'} readOnly value={invitation} rows={2} onFocus={event => event.target.select()} />
          <button type="button" onClick={() => void copyInvitation()}>Copy invitation link</button>
        </> : <p>{opponentLeft ? 'Create an invitation for a replacement player.' : 'If your opponent lost access, create a rejoin invitation. Their old link will stop working and any connected session will be disconnected. The game and undo history will be kept.'}</p>}
        {(opponentLeft || !invitation) && <button type="button" disabled={!connected || inviting || online.pendingRequestId !== null || !seat} onClick={() => void createInvitation()}>
          {inviting ? 'Creating invitation…' : inviteRequest ? 'Retry creating invitation' : opponentLeft ? invitation ? 'Replace invitation link' : 'Create replacement invitation' : 'Create rejoin invitation'}
        </button>}
        {!invitation && !seat && <p>Creating an invitation here needs the updated multiplayer Worker.</p>}
      </details>
      <p role="status">{online.error || copyFeedback || automaticCopyFeedback}</p>
    </section>
    <App
      online={{
        history: online.history,
        role: session.role,
        turnStart: state.stage === 'gameOver' ? online.history.cursor : onlineTurnStart(online.history, session.role),
        waiting,
        waitingMessage: undoPending ? 'Undo request pending' : undefined,
        requestUndo: playerTurn !== session.role ? { canRequest: canRequestUndo, onRequest: requestUndo } : undefined,
        onCommands: commands,
      }}
      onNewGame={onChooseNewGame}
    />
  </>
}
