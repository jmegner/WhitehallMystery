import { useLayoutEffect, useRef, useState } from 'react'

interface Props {
  x: number
  y: number
  location: number
  rounds: string
  label: string
  description: string
  rightEdge: number
}

export default function PastPathMarker({ x, y, location, rounds, label, description, rightEdge }: Props) {
  const text = useRef<SVGTextElement>(null)
  const [bounds, setBounds] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  useLayoutEffect(() => {
    let active = true
    const measure = () => {
      if (!active || !text.current) return
      const { x, y, width, height } = text.current.getBBox()
      setBounds(previous => previous?.x === x && previous.y === y && previous.width === width && previous.height === height
        ? previous : { x, y, width, height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (text.current?.ownerSVGElement) observer.observe(text.current.ownerSVGElement)
    void document.fonts.ready.then(measure)
    document.fonts.addEventListener('loadingdone', measure)
    return () => { active = false; observer.disconnect(); document.fonts.removeEventListener('loadingdone', measure) }
  }, [label])

  const markerX = bounds && x + 13 + bounds.x + bounds.width + 2 > rightEdge - 2
    ? x - 13 - (bounds.x + bounds.width + 2) : x + 13
  return <g className="past-path-step" data-location={location} data-round={rounds}
    transform={`translate(${markerX} ${y - 15})`} aria-label={description}>
    {bounds && <rect x={bounds.x - 2} y={bounds.y - 1.5} width={bounds.width + 4} height={bounds.height + 3} />}
    <text ref={text} dominantBaseline="central">{label}</text>
  </g>
}
