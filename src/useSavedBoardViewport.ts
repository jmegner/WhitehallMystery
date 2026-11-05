import { useLayoutEffect } from 'react'
import { restoreBoardViewport, type SavedBoardViewport } from './boardZoom'

const key = (gameId: string) => `whitehall-mystery.map-viewport.v1.${gameId}`
const restored = new Set<string>()

function load(gameId: string): SavedBoardViewport | null {
  try {
    const view = JSON.parse(localStorage.getItem(key(gameId)) ?? 'null') as SavedBoardViewport | null
    return view && Number.isFinite(view.scale) && view.scale >= 0.1 && view.scale <= 10 &&
      Number.isFinite(view.center?.x) && Number.isFinite(view.center?.y) ? view : null
  } catch { return null }
}

export function rememberBoardViewport(gameId: string) {
  const viewport = window.visualViewport
  if (!viewport) return
  try {
    localStorage.setItem(key(gameId), JSON.stringify({ scale: viewport.scale,
      center: { x: viewport.pageLeft + viewport.width / 2, y: viewport.pageTop + viewport.height / 2 } } satisfies SavedBoardViewport))
  } catch { /* View actions still work when browser storage is unavailable. */ }
}

// Only start remembering a view after the player uses Zoom. Then follow their
// own native panning and pinching too, rather than reframing on every refresh.
export function useSavedBoardViewport(panel: HTMLElement | null, gameId: string) {
  useLayoutEffect(() => {
    if (!panel) return
    let active = true
    let restoring = false
    let frame = 0
    if (!restored.has(gameId)) {
      const view = load(gameId)
      if (view) {
        restoring = true
        void restoreBoardViewport(panel, view).finally(() => {
          if (active) { restored.add(gameId); restoring = false }
        })
      } else restored.add(gameId)
    }
    const save = () => {
      if (frame || restoring) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (load(gameId)) rememberBoardViewport(gameId)
      })
    }
    window.addEventListener('scroll', save, true)
    window.addEventListener('resize', save)
    window.visualViewport?.addEventListener('scroll', save)
    window.visualViewport?.addEventListener('resize', save)
    return () => {
      active = false
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', save, true)
      window.removeEventListener('resize', save)
      window.visualViewport?.removeEventListener('scroll', save)
      window.visualViewport?.removeEventListener('resize', save)
    }
  }, [panel, gameId])
}
