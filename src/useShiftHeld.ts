import { useEffect, useState } from 'react'

// Shift is a temporary modifier, separate from the saved Alt preference.
export function useShiftHeld() {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const sync = (event: KeyboardEvent | PointerEvent) => setHeld(event.shiftKey)
    const clear = () => setHeld(false)
    const hidden = () => { if (document.hidden) clear() }
    window.addEventListener('keydown', sync, true)
    window.addEventListener('keyup', sync, true)
    // Recover the modifier state if focus was lost before a key event arrived.
    window.addEventListener('pointermove', sync, true)
    window.addEventListener('pointerdown', sync, true)
    window.addEventListener('pointerup', sync, true)
    window.addEventListener('blur', clear)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      window.removeEventListener('keydown', sync, true)
      window.removeEventListener('keyup', sync, true)
      window.removeEventListener('pointermove', sync, true)
      window.removeEventListener('pointerdown', sync, true)
      window.removeEventListener('pointerup', sync, true)
      window.removeEventListener('blur', clear)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [])
  return held
}
