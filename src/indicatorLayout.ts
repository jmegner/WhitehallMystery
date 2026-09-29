export interface IndicatorBox { x: number; y: number; width: number; height: number }
export type IndicatorAngle = 'top' | 'top-right' | 'right'
export type IndicatorKind = 'location' | 'crossingTurn' | 'crossingId'
export const INDICATOR_OBSTACLE_PRIORITIES = ['piece', 'text', 'outline', 'location', 'crossing'] as const
export type IndicatorObstaclePriority = typeof INDICATOR_OBSTACLE_PRIORITIES[number]
export type IndicatorObstacle = { priority: IndicatorObstaclePriority } & (
  | { kind: 'box'; box: IndicatorBox; border?: number }
  | { kind: 'circle'; box: IndicatorBox; x: number; y: number; radius: number; innerRadius: number }
  | { kind: 'line'; box: IndicatorBox; x1: number; y1: number; x2: number; y2: number; radius: number }
)

const OFFSETS = {
  location: { top: 24, diagonalX: 17, diagonalY: 13, right: 24 },
  crossingTurn: { top: 15, diagonalX: 12, diagonalY: 7, right: 16 },
  crossingId: { top: 9, diagonalX: 10, diagonalY: 6, right: 12 },
} as const

// React supplies the anchor; measured SVG layout supplies the final position.
export const indicatorTextAttributes = (x: number, y: number, kind: IndicatorKind) => ({
  x, y: y - OFFSETS[kind].top, textAnchor: 'middle' as const,
  'data-indicator-x': x, 'data-indicator-y': y, 'data-indicator-kind': kind,
})

const contains = (box: IndicatorBox, x: number, y: number) =>
  x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height

const intersects = (a: IndicatorBox, b: IndicatorBox) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

function covers(obstacle: IndicatorObstacle, x: number, y: number): boolean {
  if (!contains(obstacle.box, x, y)) return false
  if (obstacle.kind === 'box') {
    const inset = obstacle.border
    return inset === undefined || x < obstacle.box.x + inset || x > obstacle.box.x + obstacle.box.width - inset ||
      y < obstacle.box.y + inset || y > obstacle.box.y + obstacle.box.height - inset
  }
  if (obstacle.kind === 'circle') {
    const squared = (x - obstacle.x) ** 2 + (y - obstacle.y) ** 2
    return squared <= obstacle.radius ** 2 && squared >= obstacle.innerRadius ** 2
  }
  const dx = obstacle.x2 - obstacle.x1
  const dy = obstacle.y2 - obstacle.y1
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - obstacle.x1) * dx + (y - obstacle.y1) * dy) / lengthSquared))
  return (x - obstacle.x1 - t * dx) ** 2 + (y - obstacle.y1 - t * dy) ** 2 <= obstacle.radius ** 2
}

function indicatorOverlap(box: IndicatorBox, obstacles: IndicatorObstacle[], viewport: IndicatorBox) {
  const nearby = obstacles.filter(obstacle => intersects(box, obstacle.box))
  const costs = INDICATOR_OBSTACLE_PRIORITIES.map(() => 0)
  if (nearby.length === 0 && contains(viewport, box.x, box.y) && contains(viewport, box.x + box.width, box.y + box.height)) {
    return { obscuring: 0, costs }
  }
  const groups = INDICATOR_OBSTACLE_PRIORITIES.map(priority => nearby.filter(obstacle => obstacle.priority === priority))
  // Sample the union of visible marks, so stacked rings/pieces do not count the
  // same obscured area twice. Coordinates are SVG units, independent of zoom.
  const columns = Math.max(1, Math.ceil(box.width / 1.5))
  const rows = Math.max(1, Math.ceil(box.height / 1.5))
  let obscured = 0
  for (let row = 0; row < rows; row += 1) {
    const y = box.y + (row + 0.5) * box.height / rows
    for (let column = 0; column < columns; column += 1) {
      const x = box.x + (column + 0.5) * box.width / columns
      let covered = false
      for (const [priority, group] of groups.entries()) {
        // Clipped text is unreadable, just like text hidden behind a piece.
        if ((priority === 0 && !contains(viewport, x, y)) || group.some(obstacle => covers(obstacle, x, y))) {
          costs[priority]! += 1
          covered = true
        }
      }
      if (covered) obscured += 1
    }
  }
  return { obscuring: obscured / (columns * rows), costs: costs.map(cost => cost / (columns * rows)) }
}

export function indicatorObscuring(box: IndicatorBox, obstacles: IndicatorObstacle[], viewport: IndicatorBox): number {
  return indicatorOverlap(box, obstacles, viewport).obscuring
}

function compareCosts(a: number[], b: number[]): number {
  // Strict priorities: even a small piece overlap beats any amount of lower
  // priority clutter. A weighted sum could hide text to avoid a large outline.
  for (let priority = 0; priority < INDICATOR_OBSTACLE_PRIORITIES.length; priority++) {
    const difference = a[priority]! - b[priority]!
    if (difference) return difference
  }
  return 0
}

export function rankIndicatorPositions(
  anchor: { x: number; y: number; kind: IndicatorKind },
  text: { width: number; height: number; baselineOffset: number; padding: number },
  obstacles: IndicatorObstacle[],
  viewport: IndicatorBox,
) {
  const offsets = OFFSETS[anchor.kind]
  const candidates = [
    { angle: 'top' as IndicatorAngle, x: anchor.x, y: anchor.y - offsets.top, textAnchor: 'middle' as const },
    { angle: 'top-right' as IndicatorAngle, x: anchor.x + offsets.diagonalX, y: anchor.y - offsets.diagonalY, textAnchor: 'start' as const },
    { angle: 'right' as IndicatorAngle, x: anchor.x + offsets.right, y: anchor.y - text.baselineOffset - text.height / 2, textAnchor: 'start' as const },
  ]
  return candidates.map((position, preference) => {
    const box = {
      x: position.x - (position.textAnchor === 'middle' ? text.width / 2 : 0) - text.padding,
      y: position.y + text.baselineOffset - text.padding,
      width: text.width + 2 * text.padding,
      height: text.height + 2 * text.padding,
    }
    return { ...position, box, preference, ...indicatorOverlap(box, obstacles, viewport) }
  }).sort((a, b) => compareCosts(a.costs, b.costs) || a.preference - b.preference)
}

export function selectIndicatorPosition(ranked: ReturnType<typeof rankIndicatorPositions>, alternate: boolean) {
  const best = ranked[0]!
  const second = ranked[1]!
  // Alt can trade lower-priority clutter for another angle, but must not hide
  // more text behind pieces (or the board edge) than the safest position.
  return alternate && second.costs[0] === best.costs[0] ? second : best
}
