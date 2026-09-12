import { useState } from 'react'
import App from './App'
import { MailQrShare, MailQrReader } from './MailQr'
import { acceptMail, decodeMail, encodeMail, MAIL_STORAGE_KEY, mailTimestamp, mailUrl, otherPlayer, mailTurnStart, isMailBoundary, mailTurns, mailTurnTimestamp, reviewMailCorrection, mailHistoryReducer, normalizeMailHistory } from './game/byMail'
import { createGameHistory, currentHistoryState, playerViewForState, gameHistoryReducer, type GameHistory, type PlayerView } from './game/history'
import { createInitialGame } from './game/gameEngine'
import { loadStoredHistory } from './game/persistence'
import type { GameAction } from './game/types'

interface MailSession {
  id: number
  role: PlayerView
  history: GameHistory
  outgoing: string
  turnStart: number
  baselineEndedAt: number | null
  completedText?: string
}
const ACTIVE_SHARING_KEY = 'whitehall-mystery.mail-active-sharing'
const BOARD_VIEW_KEY = 'whitehall-mystery.mail-show-board'
const DRAFT_KEY = 'whitehall-mystery.mail-draft'
function readStorage(key: string) { try { return localStorage.getItem(key) } catch { return null } }
function writeStorage(key: string, value: string) { try { localStorage.setItem(key, value) } catch { /* Private browsing. */ } }
function loadSession(): MailSession | null {
  try {
    const saved = JSON.parse(readStorage(MAIL_STORAGE_KEY) ?? 'null') as (Omit<MailSession, 'history'> & { actions: GameAction[]; cursor?: number }) | null
    if (!saved || !Number.isInteger(saved.id) || !['jack', 'investigators'].includes(saved.role)) return null
    if (!Array.isArray(saved.actions) || saved.actions.length > 3000) return null
    const replayed = saved.actions.reduce((history, action) => gameHistoryReducer(history, { type: 'apply', action }), createGameHistory(createInitialGame()))
    if (saved.cursor !== undefined) replayed.cursor = saved.cursor
    const history = loadStoredHistory({ getItem: () => JSON.stringify({ version: 2, history: replayed }), setItem: () => {} })
    if (!history || (saved.outgoing && decodeMail(saved.outgoing).id !== saved.id)) return null
    const turnStart = saved.turnStart ?? mailTurnStart(history, saved.role)
    if (!Number.isInteger(turnStart) || turnStart < 0 || turnStart > history.cursor) return null
    return { ...saved, history, turnStart, baselineEndedAt: saved.baselineEndedAt ?? null }
  } catch { return null }
}
const urlMessage = () => new URLSearchParams(window.location.hash.slice(1)).get('mail') ?? ''

export default function GameApp() {
  const [session, setSession] = useState(loadSession)
  const [menu, setMenu] = useState<'choose' | 'mail' | null>(() => urlMessage() ? 'mail' : null)
  const [draft, setDraft] = useState(() => urlMessage() || readStorage(DRAFT_KEY) || '')
  const [showBoard, setShowBoard] = useState(() => readStorage(BOARD_VIEW_KEY) === 'true')
  const [activeSharing, setActiveSharing] = useState(() => readStorage(ACTIVE_SHARING_KEY) === 'true')
  const [correction, setCorrection] = useState<ReturnType<typeof reviewMailCorrection> | null>(null)
  const [feedback, setFeedback] = useState('')
  const [shareFeedback, setShareFeedback] = useState<{ message: string; copied: boolean; sequence: number } | null>(null)
  const [generation, setGeneration] = useState(0)
  const save = (next: MailSession | null) => {
    writeStorage(MAIL_STORAGE_KEY, JSON.stringify(next ? {
      id: next.id, role: next.role, outgoing: next.outgoing, turnStart: next.turnStart, baselineEndedAt: next.baselineEndedAt, completedText: next.completedText, cursor: next.history.cursor,
      actions: next.history.entries.slice(1).map(entry => entry.action),
    } : null))
    setSession(next)
  }
  const setSharing = (value: boolean) => { setActiveSharing(value); writeStorage(ACTIVE_SHARING_KEY, String(value)) }
  const updateDraft = (value: string) => { setCorrection(null); setDraft(value); writeStorage(DRAFT_KEY, value); setFeedback(''); setShareFeedback(null) }
  const openMenu = () => { setMenu('choose'); setFeedback('') }
  const state = session ? currentHistoryState(session.history) : null
  const waiting = !!session && state?.stage !== 'gameOver' && playerViewForState(state!) !== session.role
  const loadIncoming = (next: ReturnType<typeof decodeMail>, message: string) => {
    save({ ...next, turnStart: next.history.cursor, baselineEndedAt: next.endedAt, outgoing: encodeMail(next.id, otherPlayer(next.role), next.history, next.endedAt) })
    updateDraft('')
    setMenu(null)
    setSharing(false)
    setFeedback(message)
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
  const receiveCorrection = () => {
    if (!session) return
    try {
      const reviewed = reviewMailCorrection(draft, session)
      if (reviewed.requiresConfirmation) setCorrection(reviewed)
      else loadIncoming(reviewed.incoming, 'Correction loaded. Your work based on the previous version has been discarded.')
    } catch (error) { setCorrection(null); setFeedback(error instanceof Error ? error.message : 'Could not load this correction.') }
  }
  const receive = (joining: boolean) => {
    try {
      const next = !joining && session ? acceptMail(draft, session) : decodeMail(draft)
      const updateNotice = 'updateNotice' in next ? next.updateNotice : null
      loadIncoming(next, updateNotice ? `Game loaded. ${updateNotice}` : 'Game loaded.')
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Could not load this message.') }
  }
  const reportShare = (message: string, copied = false) => {
    setShareFeedback(previous => ({ message, copied, sequence: (previous?.sequence ?? 0) + 1 }))
  }
  const copy = async (text: string, kind: 'text' | 'link') => {
    try { await navigator.clipboard.writeText(text); reportShare(`Game ${kind} copied.`, true) }
    catch { reportShare('Copy is unavailable. Select and copy the game text above.') }
  }
  const share = async (url: boolean) => {
    if (!session?.outgoing) return
    const text = url ? mailUrl(session.outgoing) : session.outgoing
    try {
      if (navigator.share) await navigator.share({ title: 'Whitehall Mystery — By Mail', text })
      else await copy(text, url ? 'link' : 'text')
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) reportShare('Sharing is unavailable. Use Copy text or Copy link.')
    }
  }
  const importControls = (joining: boolean) => <>
    {joining && <MailQrReader onRead={updateDraft} />}
    <label htmlFor="mail-input">Game text or link from your partner</label>
    <textarea id="mail-input" value={draft} onChange={event => updateDraft(event.target.value)} rows={3} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
    <button type="button" className="primary-button" disabled={!draft.trim() || (!joining && !waiting)} onClick={() => receive(joining)}>{joining ? 'Join existing game' : 'Load partner’s reply'}</button>
    {!joining && <button type="button" onClick={receiveCorrection}>Load partner’s correction</button>}
  </>
  if (menu) return <main className="mail-menu">
    <h1>{menu === 'choose' ? 'New game' : 'By Mail'}</h1>
    {menu === 'choose' ? <>
      <p>Choose how to play this two-player game.</p>
      <button className="primary-button" onClick={() => { save(null); setGeneration(generation + 1); writeStorage('whitehall-mystery.game.v1', ''); setMenu(null) }}>Same device</button>
      <button className="primary-button" onClick={() => setMenu('mail')}>By Mail</button>
    </> : <>
      <p>Take turns on separate devices. Send the game text or a link through SMS, WhatsApp, or any messenger. Each message includes the history needed to rejoin on another device.</p>
      <button className="primary-button" onClick={() => {
        const id = Math.floor(Date.now() / 1000)
        save({ id, role: 'jack', history: createGameHistory(createInitialGame()), outgoing: '', turnStart: 0, baselineEndedAt: null })
        setMenu(null); setSharing(false); setFeedback(''); updateDraft('')
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
      }}>Start new game as Jack</button>
      <p>To play the investigators, ask Jack to start the game and send you the first message. To rejoin, paste the latest message addressed to your side.</p>
      {importControls(true)}
    </>}
    <button className="text-button" onClick={() => { setMenu(null); setFeedback('') }}>Cancel</button>
    <p role="status">{feedback}</p>
  </main>
  if (!session) return <App key={generation} onNewGame={openMenu} />
  const update = (history: GameHistory) => {
    const nextState = currentHistoryState(history)
    const finished = nextState.stage === 'gameOver' || playerViewForState(nextState) !== session.role
    const baseline = { ...history, cursor: session.turnStart }
    const previousText = session.completedText || session.outgoing
    const previousMessage = previousText ? decodeMail(previousText) : null
    const sameCompletedTurn = finished && previousMessage &&
      JSON.stringify(mailTurns(previousMessage.history)) === JSON.stringify(mailTurns(history))
    const endedAt = sameCompletedTurn ? previousMessage.endedAt : Math.floor(Date.now() / 1000)
    const outgoing = finished ? encodeMail(session.id, otherPlayer(session.role), history, endedAt)
      : isMailBoundary(baseline) ? encodeMail(session.id, otherPlayer(session.role), baseline, session.baselineEndedAt) : ''
    setCorrection(null)
    if (finished) setSharing(nextState.stage === 'gameOver')
    save({ ...session, history, outgoing, completedText: finished ? outgoing : session.completedText || session.outgoing })
  }
  const message = session.outgoing ? decodeMail(session.outgoing) : null
  const completedTurnNumber = message ? mailTurns(message.history).length : 0
  const turnInProgress = !waiting && state?.stage !== 'gameOver'
  const sharingVisible = waiting ? !showBoard : activeSharing
  const undoFromSharing = (side: boolean) => {
    update(normalizeMailHistory(mailHistoryReducer(session.history, { type: side ? 'bigUndo' : 'undo' }, session.role, session.turnStart)))
    setSharing(false)
  }
  return <>
    <section className="mail-panel" aria-label="By Mail game">
      <div className="mail-heading"><strong>By Mail · {session.role === 'jack' ? 'Jack' : 'Investigators'}</strong><time>{mailTimestamp(session.id)}</time><button className="text-button" onClick={() => {
        if (window.confirm('Leave this game to choose a new game?')) openMenu()
      }}>New game</button>
        <button type="button" onClick={() => {
          if (waiting) {
            setShowBoard(!showBoard)
            writeStorage(BOARD_VIEW_KEY, String(!showBoard))
          } else setSharing(!activeSharing)
        }}>{sharingVisible ? 'Show board' : 'Show sharing'}</button>
      </div>
      {(sharingVisible || !waiting) && <>
      {turnInProgress
        ? <h1>Turn {completedTurnNumber + 1} in progress</h1>
        : message && <h1>Turn {completedTurnNumber}, {mailTurnTimestamp(message.endedAt)}</h1>}
      <p>{waiting ? 'Your turn is complete. Send the game to your partner, then load their reply.' : state?.stage === 'gameOver' ? 'Game over. Send the final result to your partner.' : 'Your turn. Complete it to prepare the next message.'}</p>
      {session.outgoing && <details open={sharingVisible || state?.stage === 'gameOver'}>
        <summary>Share latest completed turn · {session.outgoing.length} characters</summary>
        {turnInProgress && message && <p>Completed turn {completedTurnNumber}, {mailTurnTimestamp(message.endedAt)}</p>}
        <p>This message opens the {otherPlayer(session.role) === 'jack' ? 'Jack' : 'investigator'} side, including on a new device.</p>
        <textarea aria-label="Outgoing game text" readOnly value={session.outgoing} rows={2} onFocus={event => event.target.select()} />
        <MailQrShare text={session.outgoing} feedback={shareFeedback && <p key={shareFeedback.sequence} role="status" className={`mail-share-feedback${shareFeedback.copied ? ' mail-copy-glow' : ''}`}>{shareFeedback.message}</p>}>
          <button onClick={() => void copy(session.outgoing, 'text')}>Copy text</button>
          <button onClick={() => void copy(mailUrl(session.outgoing), 'link')}>Copy link</button>
          <button onClick={() => void share(false)}>Share text</button>
          <button onClick={() => void share(true)}>Share link</button>
        </MailQrShare>
      </details>}
      {sharingVisible && <>
        <MailQrReader onRead={updateDraft}>
          <button type="button" disabled={session.history.cursor <= session.turnStart} onClick={() => undoFromSharing(false)}>Undo</button>
          <button type="button" disabled={session.history.cursor <= session.turnStart} onClick={() => undoFromSharing(true)}>Undo side</button>
        </MailQrReader>
        {importControls(false)}
      </>}
      </>}
      {correction && <section role="alertdialog" aria-label="Review partner correction" aria-describedby="correction-comparison">
        <h2>Review correction before replacing your game</h2>
        <div id="correction-comparison">
          <p>{correction.changedTurnNumbers.length} turns differ from the last received game text.
            {correction.changedTurnNumbers.length > 0 && ` Changed turn numbers: ${correction.changedTurnNumbers.join(', ')}.`}</p>
          <p>Game ID: {correction.gameIdChanged ? 'different' : 'same'}.
            {correction.gameIdChanged && ` Current: ${mailTimestamp(session.id)}. Incoming: ${mailTimestamp(correction.incoming.id)}.`}</p>
          <p>Last received: turn {correction.previousTurnCount}. Incoming: turn {correction.incomingTurnCount}.</p>
          <p>{correction.discardsLocalWork ? 'Accepting discards your local work based on the previous game text.' : 'Accepting replaces your current game history.'}</p>
        </div>
        <button type="button" onClick={() => loadIncoming(correction.incoming, 'Correction accepted. The incoming game has replaced your local history.')}>Accept correction</button>
        <button type="button" onClick={() => { setCorrection(null); setFeedback('Correction rejected. Your game is unchanged.') }}>Reject correction</button>
      </section>}
      <p role="status">{feedback}</p>
    </section>
    {sharingVisible ? <section className="mail-panel"><h2>{waiting ? `Waiting for ${otherPlayer(session.role) === 'jack' ? 'Jack' : 'the investigators'}` : state?.stage === 'gameOver' ? 'Game over' : 'Your turn is in progress'}</h2><ol>{state!.publicLog.map((line, i) => <li key={i}>{line}</li>)}</ol></section> : <App mail={{ history: session.history, role: session.role, turnStart: session.turnStart, waiting, onChange: update }} onNewGame={openMenu} />}
  </>
}
