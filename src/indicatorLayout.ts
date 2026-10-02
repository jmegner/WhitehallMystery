type IndicatorKind = 'clue' | 'locationDistance' | 'crossingTurn' | 'crossingId' | 'crossingWorst'

export function indicatorTextAttributes(
  x: number,
  y: number,
  kind: IndicatorKind,
  alternate: boolean,
  hasPrimaryCount = false,
) {
  const angle = kind === 'crossingWorst' ? 'center'
    : kind === 'clue' || kind === 'crossingId'
    ? alternate ? 'right' : 'top'
    : kind === 'locationDistance' && hasPrimaryCount && !alternate ? 'top-right' : 'top'
  const topOffset = kind === 'clue' ? 16 : kind === 'crossingId' ? hasPrimaryCount ? 11 : 6 : kind === 'crossingTurn' ? 11 : 19
  const rightOffset = kind === 'clue' ? 16 : kind === 'crossingId' ? hasPrimaryCount ? 18 : 8 : 19
  return {
    x: x + (angle === 'right' ? rightOffset : angle === 'top-right' ? 13 : 0),
    y: y - (angle === 'top' ? topOffset : angle === 'top-right' ? 13 : 0),
    textAnchor: angle === 'top' || angle === 'center' ? 'middle' as const : 'start' as const,
    dominantBaseline: angle === 'right' || angle === 'center' ? 'central' as const : 'auto' as const,
    'data-indicator-x': x,
    'data-indicator-y': y,
    'data-indicator-kind': kind,
    'data-indicator-angle': angle,
  }
}
