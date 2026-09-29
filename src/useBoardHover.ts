import { useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'

// A single physical target owns every hover preview. Re-hit-test after DOM
// changes too: pieces can move, or a Coach choice can stop being a legal target
// without the pointer moving or the old element receiving a leave event.
export function useBoardHover(board: RefObject<SVGSVGElement | null>) {
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const [hover, setHover] = useState<{ target: string | null; moved: boolean }>({ target: null, moved: false })
  const clear = () => {
    pointer.current = null
    setHover(previous => previous.target === null ? previous : { target: null, moved: false })
  }
  const reconcile = (moving = false) => {
    const point = pointer.current
    const element = point ? document.elementFromPoint(point.x, point.y)?.closest('[data-board-hover]') : null
    const target = element && board.current?.contains(element) ? element.getAttribute('data-board-hover') : null
    setHover(previous => {
      const moved = target !== null && (moving || (previous.target === target && previous.moved))
      return previous.target === target && previous.moved === moved ? previous : { target, moved }
    })
  }
  const track = (event: PointerEvent<SVGSVGElement>, moving: boolean) => {
    if (event.pointerType === 'touch') return
    pointer.current = { x: event.clientX, y: event.clientY }
    reconcile(moving)
  }
  // Synchronize with browser hit testing, including stationary-pointer DOM
  // changes and scrolling. Merely appearing under the pointer never initiates
  // an investigator's yes/no outcome preview; that requires actual movement.
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => reconcile())
    const update = () => reconcile()
    const hidden = () => { if (document.hidden) clear() }
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    window.addEventListener('blur', clear)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
      window.removeEventListener('blur', clear)
      document.removeEventListener('visibilitychange', hidden)
    }
  })
  return { ...hover, events: {
    onPointerOver: (event: PointerEvent<SVGSVGElement>) => track(event, false),
    onPointerMove: (event: PointerEvent<SVGSVGElement>) => track(event, true),
    onPointerLeave: clear,
    onPointerCancel: clear,
  } }
}
