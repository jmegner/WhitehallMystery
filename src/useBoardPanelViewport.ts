import { useLayoutEffect, useState } from 'react'
import { MINIMUM_BOARD_VIEWPORT_WIDTH } from './focusBoardPiece'

interface BoardPanelViewport {
  left: number
  top: number
  bottom: number
  width: number
  scale: number
  hasActivePiece: boolean
  touchOverview: boolean
}

// Browser zoom changes the layout viewport; pinch zoom changes the visual
// viewport. Follow both, including panning, without changing the map's layout.
export function useBoardPanelViewport(panel: HTMLElement | null, allowTouchZoom = false): BoardPanelViewport | null {
  const [position, setPosition] = useState<BoardPanelViewport | null>(null)
  useLayoutEffect(() => {
    if (!panel) return
    const moveTrack = panel.closest('.app-shell')?.querySelector('.move-track')
    let frame = 0
    const measure = () => {
      frame = 0
      const viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0
      const top = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? document.documentElement.clientWidth
      const height = viewport?.height ?? window.innerHeight
      const scale = viewport?.scale ?? 1
      const rect = panel.getBoundingClientRect()
      const regionTop = Math.min(rect.top, moveTrack?.getBoundingClientRect().top ?? rect.top)
      const visibleWidth = Math.max(0, Math.min(rect.right, left + width) - Math.max(rect.left, left))
      const visibleHeight = Math.max(0, Math.min(rect.bottom, top + height) - Math.max(regionTop, top))
      // Only inspect a rendered active piece; never infer a hidden Jack target.
      const piece = panel.querySelector('[data-active-playing-piece]')?.getBoundingClientRect()
      const hasActivePiece = !!piece && piece.width > 0 && piece.height > 0
      // Pinch zoom keeps controls reachable even after panning off the map.
      const zoomed = scale > 1
      const touchOverview = allowTouchZoom && navigator.maxTouchPoints > 0 && !zoomed
      // Include the move track, toolbar, map and legend, so controls stay
      // available while the track is visible. Allow subpixel edge rounding.
      const shouldFloat = zoomed || touchOverview || (visibleWidth >= width * MINIMUM_BOARD_VIEWPORT_WIDTH && visibleHeight >= height - 1)
      const next = shouldFloat
        ? { left: left + width / 2, top: top + 12 / scale, bottom: (zoomed || touchOverview ? top + height : Math.min(rect.bottom, top + height)) - 12 / scale,
          width: width * scale - 24, scale, hasActivePiece, touchOverview }
        : null
      setPosition(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    const observer = new ResizeObserver(schedule)
    observer.observe(panel)
    if (moveTrack) observer.observe(moveTrack)
    // Header wrapping can move the panel without resizing the panel itself.
    observer.observe(document.body)
    // Moves, phase changes and turn handoffs can change the active piece
    // without scrolling or resizing the board panel.
    const pieces = new MutationObserver(schedule)
    pieces.observe(panel, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['data-active-playing-piece', 'cx', 'cy', 'transform'] })
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', schedule)
    window.visualViewport?.addEventListener('resize', schedule)
    measure()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      pieces.disconnect()
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
    }
  }, [panel, allowTouchZoom])
  return position
}
