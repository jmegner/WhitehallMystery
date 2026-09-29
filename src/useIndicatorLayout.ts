import { useLayoutEffect, type RefObject } from 'react'
import { rankIndicatorPositions, selectIndicatorPosition, type IndicatorKind, type IndicatorObstacle, type IndicatorObstaclePriority } from './indicatorLayout'

function visibleObstacles(svg: SVGSVGElement): IndicatorObstacle[] {
  const obstacles: IndicatorObstacle[] = []
  const inverse = svg.getCTM()?.inverse()
  if (!inverse) return obstacles
  for (const shape of svg.querySelectorAll<SVGGraphicsElement>('circle, rect, line, polyline')) {
    // Faint position guides and invisible mouse targets are not painted marks.
    // The targets do, however, tell us where the printed board nodes are.
    if (shape.classList.contains('edge-guide-line')) continue
    const matrix = shape.getCTM()
    if (!matrix) continue
    const transform = inverse.multiply(matrix)
    const point = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(transform)
    const value = (name: string) => Number(shape.getAttribute(name) ?? 0)
    const style = getComputedStyle(shape)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue
    const stroke = style.stroke === 'none' ? 0 : Number.parseFloat(style.strokeWidth)
    const fillAlpha = style.fill === 'none' ? 0 : Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(style.fill)?.[1] ?? 1)
    const solid = fillAlpha >= 0.5
    const hitTarget = shape.classList.contains('map-hit-target')
    const priority: IndicatorObstaclePriority = shape.closest('.investigator-piece, .jack-marker') ? 'piece'
      : shape.closest('.past-path-step') ? 'text'
      : hitTarget ? shape.getAttribute('aria-label')?.startsWith('Crossing ') ? 'crossing' : 'location'
      : 'outline'
    if (shape.tagName === 'circle') {
      const center = point(value('cx'), value('cy'))
      if (hitTarget && shape.getAttribute('aria-label')?.startsWith('Crossing ')) {
        obstacles.push({ kind: 'box', priority, box: { x: center.x - 3, y: center.y - 3, width: 6, height: 6 } })
        continue
      }
      const radius = value('r')
      const outer = radius + stroke / 2
      obstacles.push({ kind: 'circle', priority, x: center.x, y: center.y, radius: outer,
        innerRadius: solid || hitTarget ? 0 : Math.max(0, radius - stroke / 2),
        box: { x: center.x - outer, y: center.y - outer, width: 2 * outer, height: 2 * outer },
      })
    } else if (shape.tagName === 'rect') {
      const corner = point(value('x'), value('y'))
      obstacles.push({ kind: 'box', priority, border: solid ? undefined : stroke,
        box: { x: corner.x - stroke / 2, y: corner.y - stroke / 2, width: value('width') + stroke, height: value('height') + stroke },
      })
    } else {
      const coordinates = shape.tagName === 'line'
        ? [value('x1'), value('y1'), value('x2'), value('y2')]
        : (shape.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number)
      for (let index = 0; index + 3 < coordinates.length; index += 2) {
        const from = point(coordinates[index]!, coordinates[index + 1]!)
        const to = point(coordinates[index + 2]!, coordinates[index + 3]!)
        obstacles.push({ kind: 'line', priority, x1: from.x, y1: from.y, x2: to.x, y2: to.y, radius: stroke / 2,
          box: { x: Math.min(from.x, to.x) - stroke / 2, y: Math.min(from.y, to.y) - stroke / 2,
            width: Math.abs(to.x - from.x) + stroke, height: Math.abs(to.y - from.y) + stroke },
        })
      }
    }
  }
  return obstacles
}

function placeIndicators(svg: SVGSVGElement, alternate: boolean) {
  const labels = [...svg.querySelectorAll<SVGTextElement>('text[data-indicator-kind]')]
  if (labels.length === 0) return
  const obstacles = visibleObstacles(svg)
  // Read all font metrics before writing positions. Repeated layout never uses
  // the previous indicator positions as obstacles, so it cannot oscillate.
  // getBBox uses floats whose rounding depends on the current position. Keep
  // hundredths of an SVG unit so that measuring a relocated label is stable.
  const metric = (value: number) => Math.round(value * 100) / 100
  const measured = labels.map(element => {
    const bounds = element.getBBox()
    return { element, text: { width: metric(bounds.width), height: metric(bounds.height),
      baselineOffset: metric(bounds.y - Number(element.getAttribute('y'))),
      padding: Number.parseFloat(getComputedStyle(element).strokeWidth) / 2 + 0.5,
    } }
  })
  const positioned = measured.map(({ element, text }) => {
    const ranked = rankIndicatorPositions({
      x: Number(element.dataset.indicatorX), y: Number(element.dataset.indicatorY),
      kind: element.dataset.indicatorKind as IndicatorKind,
    }, text, obstacles, svg.viewBox.baseVal)
    const position = selectIndicatorPosition(ranked, alternate)
    // Earlier labels reserve space for later ones (search counts precede route
    // labels and crossing IDs), including two indicators on the same location.
    obstacles.push({ kind: 'box', priority: 'text', box: position.box })
    return { element, position }
  })
  for (const { element, position } of positioned) {
    element.setAttribute('x', String(position.x))
    element.setAttribute('y', String(position.y))
    element.setAttribute('text-anchor', position.textAnchor)
    element.dataset.indicatorAngle = position.angle
  }
}

export function useIndicatorLayout(board: RefObject<SVGSVGElement | null>, alternate: boolean) {
  // Synchronize text with actual SVG/font geometry after each board commit,
  // before paint. Browser font hinting can change glyph bounds slightly when
  // the SVG scales, so remeasure on resize as well as after fonts load.
  useLayoutEffect(() => {
    const svg = board.current
    if (!svg) return
    const update = () => placeIndicators(svg, alternate)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(svg)
    document.fonts.addEventListener('loadingdone', update)
    return () => {
      observer.disconnect()
      document.fonts.removeEventListener('loadingdone', update)
    }
  })
}
