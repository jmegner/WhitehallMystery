type IndicatorKind = 'clue' | 'locationDistance' | 'crossingTurn' | 'crossingId'

export function indicatorTextAttributes(
  x: number,
  y: number,
  kind: IndicatorKind,
  alternate: boolean,
  hasClue = false,
) {
  const angle = kind === 'clue' || kind === 'crossingId'
    ? alternate ? 'right' : 'top'
    : kind === 'locationDistance' && hasClue && !alternate ? 'top-right' : 'top'
  const topOffset = kind === 'crossingId' ? 6 : kind === 'crossingTurn' ? 11 : 19
  const rightOffset = kind === 'crossingId' ? 8 : 19
  return {
    x: x + (angle === 'right' ? rightOffset : angle === 'top-right' ? 13 : 0),
    y: y - (angle === 'top' ? topOffset : angle === 'top-right' ? 13 : 0),
    textAnchor: angle === 'top' ? 'middle' as const : 'start' as const,
    dominantBaseline: angle === 'right' ? 'central' as const : 'auto' as const,
    'data-indicator-x': x,
    'data-indicator-y': y,
    'data-indicator-kind': kind,
    'data-indicator-angle': angle,
  }
}
