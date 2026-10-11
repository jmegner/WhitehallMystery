import { replayRoundTarget, type ReplayTurn } from './game/replay'

export default function ReplayControls({ turns, index, onChange }: {
  turns: ReplayTurn[]; index: number; onChange: (index: number | null) => void
}) {
  const turn = turns[index]!
  const previousRound = replayRoundTarget(turns, index, -1)
  const nextRound = replayRoundTarget(turns, index, 1)
  return <section className="replay-controls" aria-label="Replay controls">
    <strong role="status">Replay · Round {turn.state.round} · Move {turn.state.moveSlot} · {turn.side === 'jack' ? 'Jack' : 'Investigators'} · {index + 1}/{turns.length}</strong>
    <div className="button-row">
      <button type="button" title="Jump to the first turn of the previous round" disabled={previousRound === null} onClick={() => onChange(previousRound)}>Previous round</button>
      <button type="button" title="Show the result of the previous side’s turn" disabled={index === 0} onClick={() => onChange(index - 1)}>Previous turn</button>
      <button type="button" title="Show the result of the next side’s turn" disabled={index === turns.length - 1} onClick={() => onChange(index + 1)}>Next turn</button>
      <button type="button" title="Jump to the first turn of the next round" disabled={nextRound === null} onClick={() => onChange(nextRound)}>Next round</button>
      <button type="button" title="Return to the finished game" onClick={() => onChange(null)}>Exit replay</button>
    </div>
  </section>
}
