export default function LeaveGameFailure({ error, online, disabled, onForget }: {
  error: string; online: boolean; disabled: boolean; onForget: () => void
}) {
  return <div className="storage-warning leave-game-failure" role="alert">
    <p>{error} Your saved game has been kept.</p>
    <p>Retry Leave, or forget the game to remove its saved progress from this browser.
      {online && ' Forgetting does not contact the online service: your partner may still see you in the game, and you will lose your saved invitation and access credentials.'}</p>
    <button type="button" disabled={disabled} onClick={onForget}>Forget game</button>
  </div>
}
