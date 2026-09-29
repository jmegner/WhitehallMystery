import { useLayoutEffect, useState, type RefObject } from 'react'

interface MapViewport {
  left: number
  bottom: number
  width: number
  scale: number
}

// Browser zoom changes the layout viewport; pinch zoom changes the visual
// viewport. Follow both, including panning, without changing the map's layout.
export function useMapViewport(board: RefObject<HTMLDivElement | null>): MapViewport | null {
  const [position, setPosition] = useState<MapViewport | null>(null)
  useLayoutEffect(() => {
    const element = board.current
    if (!element) return
    let frame = 0
    const measure = () => {
      frame = 0
      const viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0
      const top = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? document.documentElement.clientWidth
      const height = viewport?.height ?? window.innerHeight
      const scale = viewport?.scale ?? 1
      const rect = element.getBoundingClientRect()
      const visibleWidth = Math.max(0, Math.min(rect.right, left + width) - Math.max(rect.left, left))
      const visibleHeight = Math.max(0, Math.min(rect.bottom, top + height) - Math.max(rect.top, top))
      // A narrow desktop window can show the entire map while it occupies over
      // 75% of the viewport. Keep the map-top controls in that case. Float only
      // when the map spans the viewport vertically (allow subpixel rounding).
      const next = visibleWidth >= width * 0.8 && visibleHeight >= height - 1
        ? { left: left + width / 2, bottom: Math.min(rect.bottom, top + height) - 12 / scale,
          width: width * scale - 24, scale }
        : null
      setPosition(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    const observer = new ResizeObserver(schedule)
    observer.observe(element)
    // Header/toolbar wrapping can move the map without resizing the map itself.
    observer.observe(document.body)
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', schedule)
    window.visualViewport?.addEventListener('resize', schedule)
    measure()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
    }
  }, [board])
  return position
}
