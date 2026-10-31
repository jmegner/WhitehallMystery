import { useLayoutEffect, useState } from 'react'

export interface ZoomedViewport {
  left: number
  top: number
  width: number
  height: number
  scale: number
}

const readZoomedViewport = (): ZoomedViewport | null => {
  const viewport = window.visualViewport
  return viewport && viewport.scale > 1 && viewport.width <= 768 ? {
    left: viewport.offsetLeft, top: viewport.offsetTop,
    width: viewport.width, height: viewport.height, scale: viewport.scale,
  } : null
}

export function useZoomedViewport(): ZoomedViewport | null {
  // Rendering the full handoff even briefly can resize the mobile viewport
  // before the compact screen mounts, permanently changing its scroll offset.
  const [position, setPosition] = useState(readZoomedViewport)
  useLayoutEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const measure = () => {
      const next = readZoomedViewport()
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
