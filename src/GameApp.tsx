import { useState, useSyncExternalStore } from 'react'
import App from './App'
import { MailQrShare, MailQrReader } from './MailQr'
import { acceptMail, decodeMail, encodeMail, mailTimestamp, mailUrl, otherPlayer, isMailBoundary, mailTurns, mailTurnTimestamp, reviewMailCorrection, mailHistoryReducer, normalizeMailHistory } from './game/byMail'
import { createGameHistory, currentHistoryState, playerViewForState, type GameHistory, type PlayerView } from './game/history'
import { createInitialGame } from './game/gameEngine'
import { SavedGameLibrary, normalizeLocalResume, type SavedGame, type MailSession, type MailView } from './game/savedGames'
import SavedGamesMenu from './SavedGamesMenu'
import OnlineGame from './online/OnlineGame'
import { confirmLeaveGame, leaveSavedGame } from './game/leaveGame'
import { MAX_GAME_NAME_LENGTH } from './game/gameName'
import {
  configuredOnlineApi,
  createOnlineGame,
  onlineSessionFromInvite,
  onlineSessionFromLocation,
  type OnlineSession,
} from './online/onlineSession'

const urlMessage = () => new URLSearchParams(window.location.hash.slice(1)).get('mail') ?? ''
type GameMenu = 'choose' | 'mail' | 'online' | 'resume' | null
const NAME_DRAFT_KEY = 'whitehall-mystery.new-online-name'

export default function GameApp() {
  const [library] = useState(() => {
    let storage: Storage | null = null
    try { storage = localStorage } catch { /* Report unavailable storage through the library. */ }
    const library = new SavedGameLibrary(storage)
    const invited = onlineSessionFromLocation()
    if (invited && !urlMessage()) {
      library.activate(library.saveOnline(invited).id)
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
    return library
  })
  const saved = useSyncExternalStore(library.subscribe, library.getSnapshot, library.getSnapshot)
  const game = saved.games.find(game => game.id === saved.activeId) ?? null
  // Navigation lives above the keyed workspace so leaving its active slot can
  // still open the new-game chooser, without resurrecting the removed game.
  const [menu, setMenu] = useState<GameMenu>(() => urlMessage() ? 'mail' : !game ? 'resume' : null)
  const [leaving, setLeaving] = useState(false)
  const [leaveError, setLeaveError] = useState('')
  const [leaveIds] = useState(() => new Map<string, string>())
  const leaveAndNew = async () => {
    if (!game || leaving || !confirmLeaveGame(game, true)) return
    setLeaving(true)
    setLeaveError('')
    let requestId = leaveIds.get(game.id)
    if (!requestId) { requestId = crypto.randomUUID(); leaveIds.set(game.id, requestId) }
    try {
      await leaveSavedGame(library, game, requestId)
      setMenu('choose')
    } catch (error) {
      setLeaveError(`${error instanceof Error ? error.message : 'Could not leave the game.'} Your saved game has been kept; retry Leave+New Game when connected.`)
    } finally { setLeaving(false) }
  }
  return <>
    {saved.error && <p className="storage-warning" role="alert">{saved.error}</p>}
    {leaving && <p className="storage-warning" role="status">Leaving the current game…</p>}
    {leaveError && <p className="storage-warning" role="alert">{leaveError}</p>}
    <div inert={leaving}>
      <GameWorkspace key={game?.id ?? 'no-game'} game={game} library={library} menu={menu} setMenu={next => { setLeaveError(''); setMenu(next) }} onLeaveNewGame={() => void leaveAndNew()} />
    </div>
  </>
}

function GameWorkspace({ game, library, menu, setMenu, onLeaveNewGame }: {
  game: SavedGame | null; library: SavedGameLibrary; menu: GameMenu; setMenu: (menu: GameMenu) => void; onLeaveNewGame: () => void
}) {
  const onlineSession = game?.mode === 'online' ? game.session : null
  const session = game?.mode === 'by-mail' ? game.session : null
  const [draft, setDraft] = useState(() => urlMessage() || (game?.mode === 'by-mail' ? game.view.draft : ''))
  const [onlineDraft, setOnlineDraft] = useState('')
  const [onlineBusy, setOnlineBusy] = useState(false)
  const [onlineName, setOnlineName] = useState(() => {
    try { return localStorage.getItem(NAME_DRAFT_KEY) ?? '' } catch { return '' }
  })
  const updateOnlineName = (name: string) => {
    setOnlineName(name)
    try { localStorage.setItem(NAME_DRAFT_KEY, name) } catch { setFeedback('Could not save the name draft in browser storage.') }
  }
  const [showBoard, setShowBoard] = useState(() => game?.mode === 'by-mail' && game.view.showBoard)
  const [activeSharing, setActiveSharing] = useState(() => game?.mode === 'by-mail' && game.view.activeSharing)
  const [correction, setCorrection] = useState<ReturnType<typeof reviewMailCorrection> | null>(null)
  const [feedback, setFeedback] = useState('')
  const [shareFeedback, setShareFeedback] = useState<{ message: string; copied: boolean; sequence: number } | null>(null)
  const saveOnline = (next: OnlineSession) => {
    library.activate(library.saveOnline(next).id)
  }
  const save = (next: MailSession) => {
    library.activate(library.saveMail(next).id)
  }
  const saveMailView = (patch: Partial<MailView>) => library.updateMailView(library.getSnapshot().activeId, patch)
  const setSharing = (value: boolean) => { setActiveSharing(value); saveMailView({ activeSharing: value }) }
  const updateDraft = (value: string) => { setCorrection(null); setDraft(value); saveMailView({ draft: value }); setFeedback(''); setShareFeedback(null) }
  const openMenu = () => { setMenu('choose'); setFeedback('') }
  const openResume = () => { setMenu('resume'); setFeedback('') }
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
      const decoded = decodeMail(draft)
      const existing = library.get(`by-mail-${decoded.id}-${decoded.role}`)
      const baseline = !joining ? session : existing?.mode === 'by-mail' ? existing.session : null
      const next = baseline ? acceptMail(draft, baseline) : decoded
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
  const startOnline = async (role: PlayerView) => {
    setOnlineBusy(true)
    setFeedback('')
    try {
      const next = await createOnlineGame({ role, name: onlineName.trim() })
      saveOnline(next)
      setMenu(null)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Could not create an online game.')
    } finally {
      setOnlineBusy(false)
    }
  }
  const joinOnline = () => {
    const next = onlineSessionFromInvite(onlineDraft)
    if (!next) {
      setFeedback('Paste a complete online player invitation link.')
      return
    }
    saveOnline(next)
    setOnlineDraft('')
    setFeedback('')
    setMenu(null)
  }
  const importControls = (joining: boolean) => <>
    {joining && <MailQrReader onRead={updateDraft} />}
    <label htmlFor="mail-input">Game text or link from your partner</label>
    <textarea id="mail-input" value={draft} onChange={event => updateDraft(event.target.value)} rows={3} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
    <button type="button" className="primary-button" disabled={!draft.trim() || (!joining && !waiting)} onClick={() => receive(joining)}>{joining ? 'Join existing game' : 'Load partner’s reply'}</button>
    {!joining && <button type="button" onClick={receiveCorrection}>Load partner’s correction</button>}
  </>
  if (menu === 'resume') return <SavedGamesMenu library={library} activeId={game?.id ?? ''}
    onResume={id => { library.activate(id); setMenu(null) }} onNewGame={openMenu} onCancel={() => setMenu(null)} />
  if (menu) return <main className="mail-menu">
    <h1>{menu === 'choose' ? 'New game' : menu === 'mail' ? 'By Mail' : 'Online'}</h1>
    {menu === 'choose' ? <>
      <p>Choose how to play this two-player game. {game && 'Your current game is saved; return to it with Resume game.'}</p>
      <button className="primary-button" onClick={() => { library.addSameDevice(); setMenu(null) }}>Same device</button>
      <button className="primary-button" onClick={() => setMenu('mail')}>By Mail</button>
      <button className="primary-button" onClick={() => { setFeedback(''); setMenu('online') }}>Online</button>
    </> : menu === 'mail' ? <>
      <p>Take turns on separate devices. Send the game text or a link through SMS, WhatsApp, or any messenger. Each message includes the history needed to rejoin on another device.</p>
      <button className="primary-button" onClick={() => {
        let id = Math.floor(Date.now() / 1000)
        while (library.getSnapshot().games.some(saved => saved.mode === 'by-mail' && saved.session.id === id)) id += 1
        save({ id, role: 'jack', history: createGameHistory(createInitialGame()), outgoing: '', turnStart: 0, baselineEndedAt: null })
        setMenu(null); setSharing(false); setFeedback(''); updateDraft('')
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
      }}>Start new game as Jack</button>
      <p>To play the investigators, ask Jack to start the game and send you the first message. To rejoin, paste the latest message addressed to your side.</p>
      {importControls(true)}
    </> : <>
      <p>Play on separate devices with live synchronization through the Cloudflare multiplayer service.</p>
      <label htmlFor="online-game-name">Game name (optional)</label>
      <input id="online-game-name" className="game-name-input" value={onlineName} maxLength={MAX_GAME_NAME_LENGTH} disabled={onlineBusy} onChange={event => updateOnlineName(event.target.value)} />
      <p className="game-name-hint">Shared with your partner. You can change it in Resume game.</p>
      <button className="primary-button" type="button" disabled={onlineBusy || !configuredOnlineApi()} onClick={() => void startOnline('jack')}>Start new game as Jack</button>
      <button className="primary-button" type="button" disabled={onlineBusy || !configuredOnlineApi()} onClick={() => void startOnline('investigators')}>Start new game as Investigators</button>
      {onlineBusy && <p role="status">Creating game…</p>}
      {!configuredOnlineApi() && <p>Online multiplayer is not configured for this deployment.</p>}
      <label htmlFor="online-invitation">Player invitation link</label>
      <textarea id="online-invitation" value={onlineDraft} onChange={event => setOnlineDraft(event.target.value)} rows={3} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      <button type="button" disabled={onlineBusy || !onlineDraft.trim()} onClick={joinOnline}>Join invited side</button>
    </>}
    <button className="text-button" disabled={onlineBusy} onClick={() => { setMenu(game ? null : 'resume'); setFeedback('') }}>Cancel</button>
    <p role="status">{feedback}</p>
  </main>
  if (onlineSession && game) return <OnlineGame
    session={onlineSession}
    onChooseNewGame={() => setMenu('choose')}
    onResumeGame={openResume}
    onLeaveNewGame={onLeaveNewGame}
    onProgress={(history, createdAt, seats, revision, name) => library.updateOnline(game.id, history, createdAt, seats, revision, name)}
    onInvitation={invitation => library.saveInvitation(game.id, invitation)}
  />
  if (game?.mode === 'same-device') return <App local={{ history: normalizeLocalResume(game.history), onChange: history => library.saveLocal(game.id, history) }} onNewGame={openMenu} onResumeGame={openResume} onLeaveNewGame={onLeaveNewGame} />
  if (!session) return null
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
      <div className="mail-heading"><strong>By Mail · {session.role === 'jack' ? 'Jack' : 'Investigators'}</strong><time>{mailTimestamp(session.id)}</time><button className="text-button" onClick={openMenu}>New game</button>
        <button className="text-button" onClick={openResume}>Resume game</button>
        <button className="text-button" onClick={onLeaveNewGame}>Leave+New Game</button>
        <button type="button" onClick={() => {
          if (waiting) {
            setShowBoard(!showBoard)
            saveMailView({ showBoard: !showBoard })
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
