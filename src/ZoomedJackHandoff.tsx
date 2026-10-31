import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ZoomedViewport } from './useZoomedViewport'

interface Props {
  viewport: ZoomedViewport
  canUndo: boolean
  onUndo: () => void
  onReveal: () => void
}

export default function ZoomedJackHandoff({ viewport, canUndo, onUndo, onReveal }: Props) {
  const dialog = useRef<HTMLDivElement>(null)
  const reveal = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const root = document.getElementById('root')!
    const wasInert = root.inert
    const previousFocus = document.activeElement
    root.inert = true
    // Native dialog autofocus and pointer focus can pan a pinch-zoomed page.
    // The handoff must stay under the finger until the tap is released.
    reveal.current!.focus({ preventScroll: true })
    return () => {
      root.inert = wasInert
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true })
      }
    }
  }, [])

  return createPortal(<div className="zoomed-jack-handoff-backdrop">
    <div ref={dialog} role="dialog" aria-modal="true" className="zoomed-jack-handoff" aria-labelledby="zoomed-handoff-title"
      onMouseDown={event => event.preventDefault()}
      onKeyDown={event => {
        if (event.key === 'Escape') event.preventDefault()
        if (event.key !== 'Tab') return
        const buttons = [...dialog.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        event.preventDefault()
        buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]!.focus({ preventScroll: true })
      }}
      style={{ left: viewport.left, top: viewport.top, width: viewport.width * viewport.scale,
        height: viewport.height * viewport.scale, transform: `scale(${1 / viewport.scale})` }}>
      <div className="zoomed-handoff-content">
        <h1 id="zoomed-handoff-title">Pass the device to Jack</h1>
        <button type="button" className="secondary-button" disabled={!canUndo}
          title="Undo the last action and return to the previous view" onClick={onUndo}>Undo</button>
        <button ref={reveal} type="button" className="reveal-button"
          title="Reveal Jack’s private board when Jack has the device" onClick={onReveal}>I am Jack, reveal my view</button>
      </div>
    </div>
  </div>, document.body)
}
