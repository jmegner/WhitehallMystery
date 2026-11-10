import { replayRoundTarget, type ReplayTurn } from './game/replay'

export interface ReplayNavigationProps {
  turns: ReplayTurn[]
  index: number
  onChange: (index: number | null) => void
}

export default function ReplayNavigation({ turns, index, onChange, compact = false }: ReplayNavigationProps & { compact?: boolean }) {
  const steps = [
    { label: 'Previous round', title: 'Jump to the first turn of the previous round', target: replayRoundTarget(turns, index, -1), direction: -1, round: true },
    { label: 'Previous turn', title: 'Show the result of the previous side’s turn', target: index > 0 ? index - 1 : null, direction: -1, round: false },
    { label: 'Next turn', title: 'Show the result of the next side’s turn', target: index < turns.length - 1 ? index + 1 : null, direction: 1, round: false },
    { label: 'Next round', title: 'Jump to the first turn of the next round', target: replayRoundTarget(turns, index, 1), direction: 1, round: true },
  ]
  return steps.map(({ label, title, target, direction, round }) => <button key={label} type="button"
    aria-label={label} title={title} disabled={target === null} onPointerDown={event => event.preventDefault()}
    onClick={() => { if (target !== null) onChange(target) }}>
    <svg className="replay-arrow" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={direction === -1 ? { transform: 'rotate(180deg)' } : undefined}>
      {round ? <><path d="m5 5 7 7-7 7" /><path d="m13 5 7 7-7 7" /></> : <path d="m8 5 7 7-7 7" />}
    </svg>
    {!compact && <> {label}</>}
  </button>)
}
