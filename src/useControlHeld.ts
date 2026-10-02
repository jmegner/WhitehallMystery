import { useEffect, useState } from 'react'

// Control temporarily inverts the saved worst-case indicator preference.
export function useControlHeld() {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const sync = (event: KeyboardEvent | PointerEvent) => setHeld(event.ctrlKey)
    const clear = () => setHeld(false)
    const hidden = () => { if (document.hidden) clear() }
    window.addEventListener('keydown', sync, true)
    window.addEventListener('keyup', sync, true)
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
