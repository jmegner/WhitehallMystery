import { useLayoutEffect, useState } from 'react'

interface BoardPanelViewport {
  left: number
  bottom: number
  width: number
  scale: number
  hasActivePiece: boolean
}

// Browser zoom changes the layout viewport; pinch zoom changes the visual
// viewport. Follow both, including panning, without changing the map's layout.
export function useBoardPanelViewport(panel: HTMLElement | null): BoardPanelViewport | null {
  const [position, setPosition] = useState<BoardPanelViewport | null>(null)
  useLayoutEffect(() => {
    if (!panel) return
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
      const visibleWidth = Math.max(0, Math.min(rect.right, left + width) - Math.max(rect.left, left))
      const visibleHeight = Math.max(0, Math.min(rect.bottom, top + height) - Math.max(rect.top, top))
      // Only inspect a rendered active piece; never infer a hidden Jack target.
      const piece = panel.querySelector('[data-active-playing-piece]')?.getBoundingClientRect()
      const hasActivePiece = !!piece && piece.width > 0 && piece.height > 0
      // Include the toolbar, map and legend: the panel can span the viewport
      // even while the map itself still fits. Allow subpixel edge rounding.
      const next = visibleWidth >= width * 0.8 && visibleHeight >= height - 1
        ? { left: left + width / 2, bottom: Math.min(rect.bottom, top + height) - 12 / scale,
          width: width * scale - 24, scale, hasActivePiece }
        : null
      setPosition(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    const observer = new ResizeObserver(schedule)
    observer.observe(panel)
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
  }, [panel])
  return position
}
