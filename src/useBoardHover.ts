import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

const LONG_PRESS_MS = 500
const PRESS_SLOP = 8 // Screen pixels, independent of the board's zoom.
type Target = { element: Element; key: string }
type Point = { x: number; y: number }
type Press = Target & Point & { pointerId: number; timer: ReturnType<typeof setTimeout> }

// Mouse hover and a pinned long-press share exactly the same preview state.
export function useBoardHover(board: RefObject<SVGSVGElement | null>, previewScope: string) {
  const [hover, setHover] = useState<{ target: string | null; moved: boolean }>({ target: null, moved: false })
  const synchronize = useRef<((scope: string) => void) | null>(null)

  useLayoutEffect(() => {
    const svg = board.current
    if (!svg) return
    let pointer: Point | null = null
    let press: Press | null = null
    let pinned: Target | null = null
    let scope: string | undefined
    let suppressClick = false

    const targetAt = (x: number, y: number): Target | null => {
      const element = document.elementFromPoint(x, y)?.closest('[data-board-hover]')
      const key = element?.getAttribute('data-board-hover')
      return element && key && svg.contains(element) ? { element, key } : null
    }
    const valid = (target: Target) => svg.contains(target.element) && target.element.getAttribute('data-board-hover') === target.key
    const show = (target: string | null, moving = false) => setHover(previous => {
      const moved = target !== null && (moving || (previous.target === target && previous.moved))
      return previous.target === target && previous.moved === moved ? previous : { target, moved }
    })
    const cancelPress = () => {
      if (press) clearTimeout(press.timer)
      press = null
    }
    const clear = () => {
      // If the board changes during a hold, its eventual release must not act
      // on the new state. A fresh pointer-down starts an independent gesture.
      if (press) suppressClick = true
      cancelPress()
      pinned = null
      pointer = null
      show(null)
    }
    const reconcile = (moving = false) => {
      if (pinned) {
        if (!valid(pinned)) clear()
        return
      }
      show(pointer ? targetAt(pointer.x, pointer.y)?.key ?? null : null, moving)
    }
    const down = (event: PointerEvent) => {
      if (!event.isPrimary) {
        clear() // A second finger cancels the hold and leaves pinch zoom free.
        return
      }
      const inside = event.target instanceof Node && svg.contains(event.target)
      const target = inside ? targetAt(event.clientX, event.clientY) : null
      const dismissOnly = pinned !== null && inside && !target
      cancelPress()
      pinned = null
      suppressClick = dismissOnly
      if (event.pointerType !== 'mouse' || !inside || dismissOnly) {
        pointer = null
        show(null)
      }
      if (!target || event.button !== 0) return
      const pending: Press = { ...target, x: event.clientX, y: event.clientY, pointerId: event.pointerId,
        timer: setTimeout(() => {
          if (press !== pending) return
          if (!valid(pending) || targetAt(pending.x, pending.y)?.key !== pending.key) {
            clear()
            return
          }
          pinned = pending
          pointer = null
          suppressClick = true
          // A deliberate hold also enables the yes/no clue-outcome preview.
          show(pending.key, true)
        }, LONG_PRESS_MS),
      }
      press = pending
    }
    const move = (event: PointerEvent) => {
      if (press) {
        if (event.pointerId === press.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > PRESS_SLOP) clear()
        return
      }
      if (event.pointerType !== 'mouse' || event.buttons !== 0) return
      // Real mouse movement resumes ordinary hover after click-and-hold.
      pinned = null
      pointer = { x: event.clientX, y: event.clientY }
      reconcile(true)
    }
    const over = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || press || pinned) return
      pointer = { x: event.clientX, y: event.clientY }
      reconcile()
    }
    const leave = (event: PointerEvent) => {
      // Touch release sends pointerleave too; it must not dismiss the preview.
      if (event.pointerType === 'mouse' && !pinned && !press) {
        pointer = null
        show(null)
      }
    }
    const up = (event: PointerEvent) => {
      if (!press || event.pointerId !== press.pointerId) return
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > PRESS_SLOP) clear()
      else cancelPress()
    }
    const click = (event: MouseEvent) => {
      if (suppressClick && event.detail > 0) {
        suppressClick = false
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    const contextMenu = (event: Event) => {
      if (press || pinned) event.preventDefault()
    }
    const dragStart = (event: Event) => event.preventDefault()
    const viewportChanged = () => {
      if (press) clear()
      else reconcile()
    }
    const hidden = () => { if (document.hidden) clear() }
    const keyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') clear() }
    synchronize.current = nextScope => {
      if (scope !== nextScope && (press || pinned)) clear()
      scope = nextScope
      if (press && !valid(press)) clear()
      reconcile()
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', clear, true)
    window.addEventListener('click', click, true)
    window.addEventListener('keydown', keyDown)
    window.addEventListener('scroll', viewportChanged, true)
    window.addEventListener('resize', viewportChanged)
    window.addEventListener('blur', clear)
    document.addEventListener('visibilitychange', hidden)
    svg.addEventListener('pointerover', over)
    svg.addEventListener('pointerleave', leave)
    svg.addEventListener('contextmenu', contextMenu)
    svg.addEventListener('dragstart', dragStart)
    return () => {
      cancelPress()
      synchronize.current = null
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', clear, true)
      window.removeEventListener('click', click, true)
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('scroll', viewportChanged, true)
      window.removeEventListener('resize', viewportChanged)
      window.removeEventListener('blur', clear)
      document.removeEventListener('visibilitychange', hidden)
      svg.removeEventListener('pointerover', over)
      svg.removeEventListener('pointerleave', leave)
      svg.removeEventListener('contextmenu', contextMenu)
      svg.removeEventListener('dragstart', dragStart)
    }
  }, [board])

  // Re-hit-test after React commits and layout changes, including pieces that
  // move/disappear under a stationary mouse. Pinned previews follow their node.
  useLayoutEffect(() => {
    synchronize.current?.(previewScope)
    const frame = requestAnimationFrame(() => synchronize.current?.(previewScope))
    return () => cancelAnimationFrame(frame)
  })
  return hover
}
