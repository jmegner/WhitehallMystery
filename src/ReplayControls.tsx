import type { ReplayTurn } from './game/replay'
import ReplayNavigation from './ReplayNavigation'

export default function ReplayControls({ turns, index, onChange }: {
  turns: ReplayTurn[]; index: number; onChange: (index: number | null) => void
}) {
  const turn = turns[index]!
  return <section className="replay-controls" aria-label="Replay controls">
    <strong role="status">Replay · Round {turn.state.round} · Move {turn.state.moveSlot} · {turn.side === 'jack' ? 'Jack' : 'Investigators'} · {index + 1}/{turns.length}</strong>
    <div className="button-row">
      <ReplayNavigation turns={turns} index={index} onChange={onChange} />
      <button type="button" title="Return to the finished game" onClick={() => onChange(null)}>Exit replay</button>
    </div>
  </section>
}
