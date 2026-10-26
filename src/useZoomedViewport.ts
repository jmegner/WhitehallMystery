import { useLayoutEffect, useState } from 'react'

export interface ZoomedViewport {
  left: number
  top: number
  width: number
  height: number
  scale: number
}

export function useZoomedViewport(): ZoomedViewport | null {
  const [position, setPosition] = useState<ZoomedViewport | null>(null)
  useLayoutEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const measure = () => {
      const next = viewport.scale > 1 && viewport.width <= 768 ? {
        left: viewport.offsetLeft, top: viewport.offsetTop,
        width: viewport.width, height: viewport.height, scale: viewport.scale,
      } : null
      setPosition(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
    }
    measure()
    viewport.addEventListener('resize', measure)
    viewport.addEventListener('scroll', measure)
    window.addEventListener('resize', measure)
    return () => {
      viewport.removeEventListener('resize', measure)
      viewport.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [])
  return position
}
