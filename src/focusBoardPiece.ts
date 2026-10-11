export const MINIMUM_BOARD_VIEWPORT_WIDTH = 0.8

// Keep the panel covering the visual viewport so its floating controls remain.
// Native scrolling also handles pinch-zoom panning and Firefox's SVG shapes.
export function focusBoardPiece(panel: HTMLElement, piece: SVGElement) {
  const viewport = window.visualViewport
  const width = viewport?.width ?? document.documentElement.clientWidth
  const height = viewport?.height ?? window.innerHeight
  const board = panel.getBoundingClientRect()
  const target = piece.getBoundingClientRect()
  const x = target.left + target.width / 2
  const y = target.top + target.height / 2
  // Leave room for native scrolling's pixel rounding at the panel boundary.
  const overlap = Math.min(board.width, width * MINIMUM_BOARD_VIEWPORT_WIDTH + 2)
  const verticalOverlap = Math.min(board.height, height)
  const inset = Math.max(0, Math.min(2, (board.height - height) / 2))
  const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(value, maximum))
  const dx = clamp(x, board.left + overlap - width / 2, board.right - overlap + width / 2) - x
  const dy = clamp(y, board.top + verticalOverlap / 2 + inset, board.bottom - verticalOverlap / 2 - inset) - y
  const margin = piece.style.getPropertyValue('scroll-margin')
  const priority = piece.style.getPropertyPriority('scroll-margin')
  // Expanding one side of the scroll target shifts its center to the nearest
  // allowed position, without moving the piece or changing the zoom level.
  piece.style.setProperty('scroll-margin', `${Math.max(0, -2 * dy)}px ${Math.max(0, 2 * dx)}px ${Math.max(0, 2 * dy)}px ${Math.max(0, -2 * dx)}px`)
  try {
    piece.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  } finally {
    if (margin) piece.style.setProperty('scroll-margin', margin, priority)
    else piece.style.removeProperty('scroll-margin')
  }
}
