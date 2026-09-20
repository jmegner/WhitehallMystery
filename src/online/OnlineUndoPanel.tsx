import { createPortal } from 'react-dom'
import { useState } from 'react'
import { onlineUndoTarget } from '../game/onlineUndo'
import type { OnlineSessionStore, OnlineStoreState } from './onlineSession'
import './OnlineUndoPanel.css'

export default function OnlineUndoPanel({ store, online }: { store: OnlineSessionStore; online: OnlineStoreState }) {
  const [minimizedRequest, setMinimizedRequest] = useState<string | null>(null)
  const { undo, history } = online
  const role = store.session.role
  const pending = undo?.status === 'pending'
  const requester = undo?.requestedBy === role
  const busy = online.status !== 'connected' || online.pendingRequestId !== null
  const canRequest = online.undoSupported && history && onlineUndoTarget(history, role) !== null
  const name = undo?.requestedBy === 'jack' ? 'Jack' : 'The investigator player'

  return <section className="online-undo" aria-label="Online undo">
    {pending ? <>
      <p role="status">{requester ? 'Undo requested. Waiting for your partner’s decision.' : `${name} requested an undo.`} Moves are paused; you can still inspect the board and log.</p>
      {requester && <button type="button" disabled={busy} onClick={() => store.sendUndo({ type: 'cancel-undo', undoRequestId: undo.id })}>Cancel undo request</button>}
      {!requester && createPortal(<section className="online-undo-request" aria-label="Undo request">
        {minimizedRequest === undo.id ? <button type="button" onClick={() => setMinimizedRequest(null)}>Show undo request</button> : <>
          <h2>Undo requested</h2>
          <p>{name} wants to return to just before ending their last turn. Approving also undoes all moves made since then; redo history is kept.</p>
          <p>You can inspect the board and log before deciding.</p>
          <div className="online-undo-actions">
            <button type="button" disabled={busy} onClick={() => store.sendUndo({ type: 'decide-undo', undoRequestId: undo.id, decision: 'approve' })}>Approve undo</button>
            <button type="button" disabled={busy} onClick={() => store.sendUndo({ type: 'decide-undo', undoRequestId: undo.id, decision: 'deny' })}>Deny undo</button>
            <button type="button" onClick={() => setMinimizedRequest(undo.id)}>Minimize request</button>
          </div>
        </>}
      </section>, document.body)}
    </> : <>
      {undo && undo.resolvedRevision === online.snapshot?.revision && <p role="status">{undo.status === 'approved'
        ? requester ? 'Your undo request was approved. Your last turn was reopened; use Undo to go back further or change your final action.' : 'Undo approved. Your partner’s last turn was reopened.'
        : undo.status === 'denied'
          ? requester ? 'Your undo request was denied. The game is unchanged.' : 'Undo denied. The game is unchanged.'
          : 'Undo request cancelled. The game is unchanged.'}</p>}
      <button type="button" disabled={busy || !canRequest} onClick={() => store.sendUndo({ type: 'request-undo' })}>Request undo</button>
      <small>{online.undoSupported ? 'After your turn, ask your partner to reopen its final action.' : 'Undo requests need an updated multiplayer Worker.'}</small>
    </>}
  </section>
}
