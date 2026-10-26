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
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])

  return createPortal(<dialog ref={dialog} className="zoomed-jack-handoff" aria-labelledby="zoomed-handoff-title"
    onCancel={event => event.preventDefault()}
    style={{ left: viewport.left, top: viewport.top, width: viewport.width * viewport.scale,
      height: viewport.height * viewport.scale, transform: `scale(${1 / viewport.scale})` }}>
    <div className="zoomed-handoff-content">
      <h1 id="zoomed-handoff-title">Pass the device to Jack</h1>
      <button type="button" className="secondary-button" disabled={!canUndo}
        title="Undo the last action and return to the previous view" onClick={onUndo}>Undo</button>
      <button type="button" className="reveal-button" autoFocus
        title="Reveal Jack’s private board when Jack has the device" onClick={onReveal}>I am Jack, reveal my view</button>
    </div>
  </dialog>, document.body)
}
