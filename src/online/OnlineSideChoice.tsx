import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { PlayerView } from '../game/history'
import { onlineInviteUrl, resolveOnlineSide, type OnlineSession } from './onlineSession'
import type { InvitationCopyStatus } from './invitationClipboard'

export default function OnlineSideChoice({ session, invitationCopyStatus, onResolved, onNewGame, onResumeGame, onLeaveNewGame }: {
  session: OnlineSession
  invitationCopyStatus?: InvitationCopyStatus
  onResolved: (session: OnlineSession) => void
  onNewGame: () => void
  onResumeGame: () => void
  onLeaveNewGame: () => void
}) {
  const connection = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')
  const [copyFeedback, setCopyFeedback] = useState('')
  const resolved = useEffectEvent(onResolved)

  // Synchronize the saved invitation with the server's one-time side assignment.
  useEffect(() => {
    const controller = new AbortController()
    connection.current = controller
    let timer: number | undefined
    const check = async () => {
      try {
        const next = await resolveOnlineSide(session, undefined, controller.signal)
        if (controller.signal.aborted) return
        if (next) { resolved(next); return }
        setError('')
      } catch (error) {
        if (controller.signal.aborted) return
        setError(error instanceof Error ? error.message : 'Could not check the side choice.')
      }
      setChecking(false)
      timer = window.setTimeout(() => void check(), 3000)
    }
    void check()
    return () => { controller.abort(); window.clearTimeout(timer); connection.current = null }
  }, [session])

  const choose = async (role: PlayerView) => {
    const controller = connection.current
    if (!controller || controller.signal.aborted) return
    setBusy(true)
    setError('')
    try {
      const next = await resolveOnlineSide(session, role, controller.signal)
      if (next && !controller.signal.aborted) onResolved(next)
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Could not choose that side.')
    } finally { setBusy(false) }
  }
  const creator = session.sideChoice === 'creator'
  const invitation = creator ? onlineInviteUrl(session) : ''
  const copy = async () => {
    try { await navigator.clipboard.writeText(invitation); setCopyFeedback('Invitation copied. Send it to your opponent.') }
    catch { setCopyFeedback('Copy is unavailable. Select and copy the invitation link.') }
  }
  const automaticCopy = invitationCopyStatus === 'copying' ? 'Copying your opponent’s invitation link…'
    : invitationCopyStatus === 'copied' ? 'Invitation copied automatically. Send it to your opponent.'
      : invitationCopyStatus === 'unavailable' ? 'Automatic copying was unavailable. Use Copy invitation link, or select and copy the link.' : ''

  return <main className="mail-menu online-menu" aria-label="Online side choice">
    <h1>{creator ? 'Waiting for opponent to choose a side' : 'Choose your side'}</h1>
    {creator ? <>
      <p>Your opponent can choose Jack or Investigators. You will play the other side.</p>
      <label htmlFor="online-side-invitation">Online side-choice invitation</label>
      <textarea id="online-side-invitation" readOnly value={invitation} rows={2} onFocus={event => event.target.select()} />
      <button type="button" title="Copy the invitation that lets your opponent choose their side" onClick={() => void copy()}>Copy invitation link</button>
      <p role="status">{copyFeedback || automaticCopy}</p>
    </> : <>
      <p>Choose Jack or control all three investigators. Your opponent will play the other side.</p>
      <button className="primary-button" type="button" title="Play Jack and let your opponent control the investigators" disabled={busy || checking} onClick={() => void choose('jack')}>Play as Jack</button>
      <button className="primary-button" type="button" title="Control all three investigators and let your opponent play Jack" disabled={busy || checking} onClick={() => void choose('investigators')}>Play as Investigators</button>
      {busy && <p role="status">Saving your side…</p>}
    </>}
    <button className="text-button" type="button" title="Start another game; this game stays saved" disabled={busy} onClick={onNewGame}>New game</button>
    <button className="text-button" type="button" title="View games saved in this browser" disabled={busy} onClick={onResumeGame}>Resume game</button>
    <button className="text-button" type="button" title="Leave this game and choose a new game" disabled={busy} onClick={onLeaveNewGame}>Leave+New Game</button>
    {error && <p role="alert">{error}</p>}
  </main>
}
